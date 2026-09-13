import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptureController, type CaptureDependencies } from "./controller";

class Socket {
  readyState = 1;
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  message(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}
function setup() {
  vi.useFakeTimers();
  let frame!: (data: ArrayBuffer) => void;
  const mic = { stop: vi.fn(async () => {}), dispose: vi.fn() };
  const sockets: Socket[] = [];
  const deps: CaptureDependencies = {
    microphone: vi.fn(async (onFrame) => {
      frame = onFrame;
      return mic;
    }),
    status: vi.fn(async () => ({ available: true })),
    socket: () => {
      const socket = new Socket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  };
  const controller = new CaptureController(deps);
  return {
    controller,
    deps,
    sockets,
    mic,
    frame: () => frame(new ArrayBuffer(3200)),
  };
}
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const sentence = (text: string, final = true) => ({
  type: "sentence",
  id: "sentence-1",
  text,
  final,
  receivedAt: 1000,
});
describe("voice capture controller", () => {
  it.each([
    ["NotAllowedError", "permissionDenied"],
    ["NotFoundError", "noMicrophone"],
    ["NotReadableError", "microphoneBusy"],
  ] as const)("maps %s without opening a socket", async (name, expected) => {
    const s = setup();
    s.deps.microphone = vi.fn(async () => {
      throw new DOMException("microphone failed", name);
    });
    await s.controller.start();
    expect(s.controller.getSnapshot()).toMatchObject({
      state: "error",
      error: expected,
      microphoneActive: false,
    });
    expect(s.sockets).toHaveLength(0);
  });
  it("releases the microphone when ASR configuration is unavailable", async () => {
    const s = setup();
    s.deps.status = vi.fn(async () => ({ available: false }));
    await s.controller.start();
    expect(s.controller.getSnapshot()).toMatchObject({
      state: "error",
      error: "unavailable",
      microphoneActive: false,
    });
    expect(s.mic.dispose).toHaveBeenCalledOnce();
    expect(s.sockets).toHaveLength(0);
  });
  it("waits for ASR ready, deduplicates finals and receives the last sentence after stop", async () => {
    const s = setup();
    await s.controller.start();
    const socket = s.sockets[0];
    socket.onopen?.();
    s.frame();
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(s.controller.getSnapshot().state).toBe("connecting");
    expect(s.controller.getSnapshot().startedAt).toBeNull();
    socket.message({ type: "ready" });
    expect(s.controller.getSnapshot().startedAt).not.toBeNull();
    s.frame();
    expect(socket.send).toHaveBeenCalledTimes(2);
    socket.message(sentence("part", false));
    expect(s.controller.getSnapshot().partial).toBe("part");
    expect(s.controller.getSnapshot().sentenceVersion).toBe(0);
    await s.controller.stop();
    expect(s.mic.stop).toHaveBeenCalledOnce();
    expect(s.controller.getSnapshot().state).toBe("stopping");
    socket.message(sentence("final"));
    socket.message(sentence("final"));
    socket.message({ type: "finished" });
    expect(s.controller.getSnapshot()).toMatchObject({
      state: "review",
      microphoneActive: false,
      partial: "",
      sentenceVersion: 1,
      sentences: [expect.objectContaining({ text: "final" })],
    });
    expect(socket.close).toHaveBeenCalledOnce();
  });
  it("cancels pending microphone permission and disposes a late result", async () => {
    const s = setup();
    let grant!: () => void;
    s.deps.microphone = vi.fn(
      (_frame, signal) =>
        new Promise<typeof s.mic>((resolve) => {
          grant = () => {
            expect(signal.aborted).toBe(true);
            resolve(s.mic);
          };
        }),
    );
    const starting = s.controller.start();
    await s.controller.stop();
    grant();
    await starting;
    expect(s.mic.dispose).toHaveBeenCalledOnce();
    expect(s.sockets).toHaveLength(0);
  });
  it("stops while reconnecting and never opens a second microphone", async () => {
    const s = setup();
    await s.controller.start();
    s.sockets[0].message({ type: "ready" });
    s.sockets[0].onclose?.();
    expect(s.controller.getSnapshot()).toMatchObject({
      state: "reconnecting",
      microphoneActive: true,
      gap: true,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.sockets).toHaveLength(2);
    await s.controller.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.sockets).toHaveLength(2);
    expect(s.deps.microphone).toHaveBeenCalledOnce();
    expect(s.mic.stop).toHaveBeenCalledOnce();
  });
  it("times out final drain without throwing away captured text", async () => {
    const s = setup();
    await s.controller.start();
    s.sockets[0].message({ type: "ready" });
    s.sockets[0].message(sentence("keep me"));
    await s.controller.stop();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(s.controller.getSnapshot()).toMatchObject({
      state: "review",
      error: "finishFailed",
      sentences: [expect.objectContaining({ text: "keep me" })],
    });
  });
  it("closes on unmount and provider authorization errors", async () => {
    const s = setup();
    await s.controller.start();
    s.sockets[0].message({
      type: "error",
      code: "SESSION_EXPIRED",
      message: "ended",
    });
    expect(s.mic.dispose).toHaveBeenCalledOnce();
    expect(s.controller.getSnapshot().microphoneActive).toBe(false);
    const next = setup();
    await next.controller.start();
    next.controller.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(next.mic.dispose).toHaveBeenCalledOnce();
    expect(next.sockets).toHaveLength(1);
  });
  it("bounds buffered audio and reconnect attempts", async () => {
    const s = setup();
    await s.controller.start();
    s.sockets[0].message({ type: "ready" });
    s.sockets[0].bufferedAmount = 61_000;
    s.frame();
    expect(s.controller.getSnapshot().state).toBe("reconnecting");
    for (const delay of [1000, 2000, 4000, 8000, 15000, 15000]) {
      await vi.advanceTimersByTimeAsync(delay);
      s.sockets.at(-1)?.onclose?.();
    }
    expect(s.controller.getSnapshot()).toMatchObject({
      state: "review",
      error: "connectionFailed",
      microphoneActive: false,
    });
  });

  it("stops immediately for a permanent provider failure", async () => {
    const s = setup();
    await s.controller.start();
    s.sockets[0].message({
      type: "error",
      code: "ASR_UPSTREAM_FAILED",
      message: "Capture interrupted",
      retryable: false,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.controller.getSnapshot()).toMatchObject({
      state: "error",
      error: "connectionFailed",
      microphoneActive: false,
      gap: false,
    });
    expect(s.sockets).toHaveLength(1);
  });
  it("keeps a long transcript ordered, deduplicated, and bounded", async () => {
    const s = setup();
    await s.controller.start();
    const socket = s.sockets[0];
    socket.message({ type: "ready" });
    const sentenceList = s.controller.getSnapshot().sentences;

    for (let index = 0; index < 4000; index += 1) {
      const event = {
        type: "sentence",
        id: `sentence-${index}`,
        text: "x",
        receivedAt: index * 1000,
      };
      socket.message({ ...event, text: `partial-${index}`, final: false });
      socket.message({ ...event, final: true });
      expect(s.controller.getSnapshot().sentences).toBe(sentenceList);
      socket.message({ ...event, final: true });
    }

    const transcript = s.controller.getSnapshot().sentences;
    expect(transcript).toHaveLength(4000);
    expect(transcript[0]?.id).toBe("sentence-0");
    expect(transcript.at(-1)?.id).toBe("sentence-3999");
    expect(s.controller.getSnapshot().partial).toBe("");
    expect(s.controller.getSnapshot().sentenceVersion).toBe(4000);

    socket.message({
      type: "sentence",
      id: "sentence-overflow",
      text: "x",
      final: true,
      receivedAt: 4_000_000,
    });
    await Promise.resolve();
    expect(s.controller.getSnapshot()).toMatchObject({
      state: "stopping",
      error: "limitReached",
      microphoneActive: false,
    });
    expect(s.controller.getSnapshot().sentences).toHaveLength(4000);
  });
});
