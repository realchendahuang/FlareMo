import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTencentProvider, signTencentAsrUrl } from "./tencent";

const credentials = {
  appId: "1234567890",
  secretId: "test-secret-id",
  secretKey: "test-secret-key",
};
class Socket extends EventTarget {
  bufferedAmount = 0;
  sent: (string | ArrayBuffer)[] = [];
  accept = vi.fn();
  close = vi.fn(() => this.dispatchEvent(new Event("close")));
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  event(value: unknown) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(value) }),
    );
  }
}
function setup() {
  vi.useFakeTimers();
  const socket = new Socket();
  const fetcher = vi.fn().mockResolvedValue({ webSocket: socket });
  vi.stubGlobal("fetch", fetcher);
  const abort = new AbortController();
  const sentence = vi.fn();
  const error = vi.fn();
  const provider = createTencentProvider(credentials);
  const connecting = provider.connect(
    { sampleRate: 16000 },
    sentence,
    error,
    abort.signal,
  );
  return {
    socket,
    abort,
    sentence,
    error,
    connecting,
    fetcher,
    provider,
    accepted: () =>
      vi.waitFor(() => expect(socket.accept).toHaveBeenCalledOnce()),
    event(value: Record<string, unknown> = {}) {
      const url = new URL(fetcher.mock.calls[0][0]);
      socket.event({
        code: 0,
        voice_id: url.searchParams.get("voice_id"),
        ...value,
      });
    },
  };
}
const result = (slice_type: number, text: string) => ({
  slice_type,
  index: 0,
  start_time: 60,
  end_time: 1240,
  voice_text_str: text,
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Tencent streaming protocol", () => {
  it("signs the canonical request using HMAC-SHA1 and URL-encodes the base64 signature", async () => {
    const url = new URL(
      await signTencentAsrUrl(credentials, {
        model: "16k_zh_en",
        voiceId: "test-voice",
        timestamp: 1700000000,
        nonce: 1234,
      }),
    );
    const canonical =
      "asr.cloud.tencent.com/asr/v2/1234567890?engine_model_type=16k_zh_en&expired=1700000300&needvad=1&nonce=1234&secretid=test-secret-id&timestamp=1700000000&voice_format=1&voice_id=test-voice";
    const expected = createHmac("sha1", credentials.secretKey)
      .update(canonical)
      .digest("base64");
    expect(url.searchParams.get("signature")).toBe(expected);
    expect(url.href).toContain(`signature=${encodeURIComponent(expected)}`);
    expect(url.href).not.toContain(credentials.secretKey);
    expect(url.protocol).toBe("https:");
    expect(url.host).toBe("asr.cloud.tencent.com");
  });

  it("keeps server-side hotwords in the signed upstream request", async () => {
    const url = new URL(
      await signTencentAsrUrl(credentials, {
        model: "16k_zh_en",
        voiceId: "hotword-test",
        timestamp: 1700000000,
        nonce: 4321,
        hotwordList: "FlareMo|11,语音记录|7",
      }),
    );
    const canonical =
      "asr.cloud.tencent.com/asr/v2/1234567890?engine_model_type=16k_zh_en&expired=1700000300&hotword_list=FlareMo|11,语音记录|7&needvad=1&nonce=4321&secretid=test-secret-id&timestamp=1700000000&voice_format=1&voice_id=hotword-test";
    const expected = createHmac("sha1", credentials.secretKey)
      .update(canonical)
      .digest("base64");
    expect(url.searchParams.get("hotword_list")).toBe("FlareMo|11,语音记录|7");
    expect(url.searchParams.get("signature")).toBe(expected);
    expect(url.href).not.toContain(credentials.secretKey);
  });

  it("waits for the acknowledgement and drains the final sentence before finish resolves", async () => {
    const s = setup();
    const ready = vi.fn();
    void s.connecting.then(ready);
    await s.accepted();
    expect(s.fetcher.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    expect(ready).not.toHaveBeenCalled();
    expect(s.socket.sent).toEqual([]);
    s.event();
    const connection = await s.connecting;
    const frame = new ArrayBuffer(3200);
    connection.sendAudio(frame);
    expect(s.socket.sent).toEqual([]);
    s.event({ result: result(0, "这是") });
    s.event({ result: result(1, "这是末") });
    expect(s.sentence.mock.calls.map(([sentence]) => sentence.final)).toEqual([
      false,
      false,
    ]);
    const finished = vi.fn();
    const ending = connection.finish();
    expect(connection.finish()).toBe(ending);
    void ending.then(finished);
    expect(s.socket.sent).toHaveLength(2);
    expect((s.socket.sent[0] as ArrayBuffer).byteLength).toBe(3200);
    expect(s.socket.sent[1]).toBe('{"type":"end"}');
    s.event({ result: result(2, "这是末句。") });
    expect(finished).not.toHaveBeenCalled();
    expect(s.sentence.mock.calls[0][0].id).toBe(s.sentence.mock.calls[2][0].id);
    expect(s.sentence.mock.calls[2][0]).toMatchObject({
      text: "这是末句。",
      final: true,
      startedAt: 60,
    });
    s.event({ final: 1 });
    await ending;
    expect(finished).toHaveBeenCalledOnce();
    expect(s.socket.close).toHaveBeenCalledOnce();
    expect(s.error).not.toHaveBeenCalled();
    s.event({ result: result(2, "late result") });
    expect(s.sentence).toHaveBeenCalledTimes(3);
  });

  it("does not apply the handshake timeout to an upgraded recording", async () => {
    vi.useFakeTimers();
    const socket = new Socket();
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      init.signal?.addEventListener("abort", () =>
        socket.dispatchEvent(new Event("close")),
      );
      return { webSocket: socket };
    });
    vi.stubGlobal("fetch", fetcher);
    const error = vi.fn();
    const connecting = createTencentProvider(credentials).connect(
      { sampleRate: 16000 },
      vi.fn(),
      error,
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(socket.accept).toHaveBeenCalledOnce());
    const url = new URL(fetcher.mock.calls[0][0]);
    socket.event({ code: 0, voice_id: url.searchParams.get("voice_id") });
    const connection = await connecting;

    await vi.advanceTimersByTimeAsync(20_000);

    expect(error).not.toHaveBeenCalled();
    expect(socket.close).not.toHaveBeenCalled();
    connection.close();
  });

  it("coalesces browser frames into Tencent's recommended 200 ms packets", async () => {
    const s = setup();
    await s.accepted();
    s.event();
    const connection = await s.connecting;
    connection.sendAudio(new Uint8Array(3200).fill(1).buffer);
    expect(s.socket.sent).toEqual([]);
    connection.sendAudio(new Uint8Array(3200).fill(2).buffer);
    expect(s.socket.sent).toHaveLength(1);
    const packet = new Uint8Array(s.socket.sent[0] as ArrayBuffer);
    expect(packet).toHaveLength(6400);
    expect(packet[0]).toBe(1);
    expect(packet[3199]).toBe(1);
    expect(packet[3200]).toBe(2);
    expect(packet[6399]).toBe(2);
    const ending = connection.finish();
    expect(s.socket.sent).toHaveLength(2);
    expect(s.socket.sent[1]).toBe('{"type":"end"}');
    s.event({ final: 1 });
    await ending;
  });

  it("rejects a completed audio packet when the upstream send queue is full", async () => {
    const s = setup();
    await s.accepted();
    s.event();
    const connection = await s.connecting;
    s.socket.bufferedAmount = 58_000;
    expect(() => connection.sendAudio(new ArrayBuffer(6400))).toThrow(
      "ASR connection failed",
    );
    expect(s.socket.sent).toEqual([]);
  });

  it("processes a result included with final=1 before resolving finish", async () => {
    const s = setup();
    await s.accepted();
    s.event();
    const connection = await s.connecting;
    const ending = connection
      .finish()
      .then(() => expect(s.sentence).toHaveBeenCalledOnce());
    s.event({ final: 1, result: result(2, "最后一句") });
    await ending;
  });

  it.each([
    { code: 4002, message: "private upstream diagnostic" },
    { voice_id: "another-session" },
    { result: result(2, "premature result") },
  ])(
    "rejects invalid or failed handshakes without exposing upstream details: %j",
    async (event) => {
      const s = setup();
      const rejected = expect(s.connecting).rejects.toThrow(
        /^ASR connection failed$/,
      );
      await s.accepted();
      s.event(event);
      await rejected;
      expect(s.socket.close).toHaveBeenCalledOnce();
      expect(s.sentence).not.toHaveBeenCalled();
    },
  );

  it("marks rejected credentials as permanent without exposing provider details", async () => {
    const s = setup();
    const rejected = s.connecting.catch((error: unknown) => error);
    await s.accepted();
    s.event({ code: 4002, message: "private upstream diagnostic" });
    await expect(rejected).resolves.toMatchObject({
      name: "AsrProviderError",
      message: "ASR connection failed",
      reason: "authentication",
      retryable: false,
    });
  });

  it("cancels a pending handshake without reporting an unexpected interruption", async () => {
    const s = setup();
    const rejected = expect(s.connecting).rejects.toThrow("cancelled");
    await s.accepted();
    s.abort.abort();
    await rejected;
    s.event();
    expect(s.socket.close).toHaveBeenCalledOnce();
    expect(s.error).not.toHaveBeenCalled();
  });

  it("closes a late upgrade after cancellation", async () => {
    const socket = new Socket();
    let upgrade: (value: unknown) => void = () => {};
    const fetcher = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        upgrade = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const abort = new AbortController();
    const connecting = createTencentProvider(credentials).connect(
      { sampleRate: 16000 },
      vi.fn(),
      vi.fn(),
      abort.signal,
    );
    const rejected = expect(connecting).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    abort.abort();
    upgrade({ webSocket: socket });
    await rejected;
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("times out a missing handshake and a missing final acknowledgement", async () => {
    const first = setup();
    const rejected = expect(first.connecting).rejects.toThrow("failed");
    await first.accepted();
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    const s = setup();
    await s.accepted();
    s.event();
    const connection = await s.connecting;
    const ending = expect(connection.finish()).rejects.toThrow("failed");
    await vi.advanceTimersByTimeAsync(10_000);
    await ending;
    expect(s.socket.close).toHaveBeenCalledOnce();
  });

  it("reports an upstream disconnect once and creates a fresh voice ID on reconnect", async () => {
    const s = setup();
    await s.accepted();
    s.event();
    await s.connecting;
    s.socket.dispatchEvent(new Event("close"));
    s.socket.dispatchEvent(new Event("error"));
    expect(s.error).toHaveBeenCalledOnce();
    const nextSocket = new Socket();
    s.fetcher.mockResolvedValueOnce({ webSocket: nextSocket });
    const next = s.provider.connect(
      { sampleRate: 16000 },
      s.sentence,
      s.error,
      s.abort.signal,
    );
    await vi.waitFor(() => expect(nextSocket.accept).toHaveBeenCalledOnce());
    const ids = s.fetcher.mock.calls.map(([url]) =>
      new URL(url).searchParams.get("voice_id"),
    );
    expect(ids[0]).not.toBe(ids[1]);
    nextSocket.event({ code: 0, voice_id: ids[1] });
    (await next).close();
  });

  it("redacts fetch errors that include the signed URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        throw new Error(`Cannot fetch ${url}`);
      }),
    );
    await expect(
      createTencentProvider(credentials).connect(
        { sampleRate: 16000 },
        vi.fn(),
        vi.fn(),
        new AbortController().signal,
      ),
    ).rejects.toThrow(/^ASR connection failed$/);
  });
});
