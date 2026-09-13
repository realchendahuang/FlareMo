import { afterEach, describe, expect, it, vi } from "vitest";
import { bridgeCapture } from "./bridge";
import {
  type AsrConnection,
  AsrProviderError,
  type AsrSentence,
  type StreamingAsrProvider,
} from "./types";

class Socket extends EventTarget {
  binaryType = "";
  bufferedAmount = 0;
  failSend = false;
  sent: { type: string; code?: string; text?: string }[] = [];
  send(data: string) {
    if (this.failSend) throw new Error("browser disconnected");
    this.sent.push(JSON.parse(data));
  }
  close = vi.fn(() => this.dispatchEvent(new Event("close")));
  message(data: object | ArrayBuffer) {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: data instanceof ArrayBuffer ? data : JSON.stringify(data),
      }),
    );
  }
}
function setup() {
  vi.useFakeTimers();
  const socket = new Socket();
  let resolveConnect!: (connection: AsrConnection) => void;
  let emit!: (sentence: AsrSentence) => void;
  let fail!: (error: AsrProviderError) => void;
  let signal!: AbortSignal;
  let finish!: () => void;
  const connection = {
    sendAudio: vi.fn(),
    close: vi.fn(),
    finish: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ),
  };
  const provider: StreamingAsrProvider = {
    connect: vi.fn((_options, sentence, error, abort) => {
      emit = sentence;
      fail = error;
      signal = abort;
      return new Promise((resolve) => {
        resolveConnect = resolve;
      });
    }),
  };
  const auth = vi.fn().mockResolvedValue({});
  const cleanup = bridgeCapture(socket as unknown as WebSocket, provider, auth);
  const start = () =>
    socket.message({ type: "start", sampleRate: 16000, encoding: "pcm_s16le" });
  return {
    socket,
    connection,
    provider,
    auth,
    cleanup,
    start,
    ready: () => resolveConnect(connection),
    emit: (s: AsrSentence) => emit(s),
    fail: (error = new AsrProviderError("network", true)) => fail(error),
    signal: () => signal,
    finish: () => finish(),
  };
}
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe("Capture bridge ownership", () => {
  it("does not announce ready until provider ready and finished until final drain", async () => {
    const s = setup();
    s.start();
    expect(s.socket.sent).toEqual([]);
    s.ready();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.socket.sent).toEqual([{ type: "ready" }]);
    s.socket.message(new ArrayBuffer(3200));
    expect(s.connection.sendAudio).toHaveBeenCalledOnce();
    s.socket.message({ type: "stop" });
    expect(s.socket.sent).toHaveLength(1);
    s.emit({ id: "1", text: "last", final: true });
    s.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.socket.sent.map((e) => e.type)).toEqual([
      "ready",
      "sentence",
      "finished",
    ]);
    expect(s.connection.close).toHaveBeenCalledOnce();
  });
  it("normalizes only standalone FlareMo brand mentions", async () => {
    const s = setup();
    s.start();
    s.ready();
    await vi.advanceTimersByTimeAsync(0);
    s.emit({
      id: "brand",
      text: "这是flaremo、FLAREMO、flaremore、Fla尔莫和flair莫，不改flaremorex、flair莫x和xflair莫。",
      final: true,
    });
    expect(s.socket.sent.at(-1)?.text).toBe(
      "这是FlareMo、FlareMo、FlareMo、FlareMo和FlareMo，不改flaremorex、flair莫x和xflair莫。",
    );
  });
  it("closes a provider that resolves after browser cancellation", async () => {
    const s = setup();
    s.start();
    s.socket.dispatchEvent(new Event("close"));
    expect(s.signal().aborted).toBe(true);
    s.ready();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.connection.close).toHaveBeenCalledOnce();
    expect(s.socket.sent).toHaveLength(0);
  });
  it.each([
    new ArrayBuffer(2),
    { type: "start", sampleRate: 48000, encoding: "pcm_s16le" },
    { header: { action: "run-task" } },
  ])("rejects invalid or early audio without connecting", (data) => {
    const s = setup();
    s.socket.message(data);
    expect(s.socket.sent[0].code).toBe("INVALID_MESSAGE");
    expect(s.provider.connect).not.toHaveBeenCalled();
  });
  it("enforces frame size, idle timeout, and session revocation", async () => {
    const s = setup();
    s.start();
    s.ready();
    await vi.advanceTimersByTimeAsync(0);
    s.socket.message(new ArrayBuffer(6402));
    expect(s.socket.sent.at(-1)?.code).toBe("INVALID_MESSAGE");
    const idle = setup();
    idle.start();
    idle.ready();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(idle.socket.sent.at(-1)?.code).toBe("TIMEOUT");
    const auth = setup();
    auth.auth.mockRejectedValue(new Error("revoked"));
    auth.start();
    await vi.advanceTimersByTimeAsync(60_000); // Connecting deadline closes before auth; test revocation with audio below.
    const live = setup();
    live.auth.mockRejectedValue(new Error("revoked"));
    live.start();
    live.ready();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 12; i++) {
      live.socket.message(new ArrayBuffer(3200));
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(live.socket.sent.at(-1)?.code).toBe("SESSION_EXPIRED");
    expect(live.signal().aborted).toBe(true);
  });
  it("exposes only the provider retry decision and safe generic message", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = setup();
    s.start();
    s.fail(new AsrProviderError("authentication", false));
    expect(s.socket.sent.at(-1)).toEqual({
      type: "error",
      code: "ASR_UPSTREAM_FAILED",
      message: "Capture interrupted",
      retryable: false,
    });
    expect(warning).toHaveBeenCalledWith("[capture] ASR provider failed", {
      reason: "authentication",
      retryable: false,
    });
  });
  it("preserves a retryable upstream backpressure failure", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = setup();
    s.start();
    s.ready();
    await vi.advanceTimersByTimeAsync(0);
    s.connection.sendAudio.mockImplementationOnce(() => {
      throw new AsrProviderError("capacity", true);
    });
    s.socket.message(new ArrayBuffer(3200));
    expect(s.socket.sent.at(-1)).toEqual({
      type: "error",
      code: "ASR_UPSTREAM_FAILED",
      message: "Capture interrupted",
      retryable: true,
    });
    expect(warning).toHaveBeenCalledWith("[capture] ASR provider failed", {
      reason: "capacity",
      retryable: true,
    });
    expect(s.connection.close).toHaveBeenCalledOnce();
  });
  it("bounds transcript delivery queued for a slow browser", async () => {
    const s = setup();
    s.start();
    s.ready();
    await vi.advanceTimersByTimeAsync(0);
    s.socket.bufferedAmount = 63_990;
    s.emit({ id: "queued", text: "queued result", final: true });
    expect(s.signal().aborted).toBe(true);
    expect(s.connection.close).toHaveBeenCalledOnce();
    expect(s.socket.sent).toEqual([{ type: "ready" }]);
  });
  it("cleans up both sides when sending to the browser fails", async () => {
    const s = setup();
    s.start();
    s.ready();
    await vi.advanceTimersByTimeAsync(0);
    s.socket.failSend = true;
    s.emit({ id: "late", text: "late result", final: true });
    expect(s.signal().aborted).toBe(true);
    expect(s.connection.close).toHaveBeenCalledOnce();
  });
});
