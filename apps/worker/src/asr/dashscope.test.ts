import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDashscopeProvider,
  normalizeDashscopeSentence,
} from "./dashscope";

class Socket extends EventTarget {
  readyState = 1;
  bufferedAmount = 0;
  sent: (string | ArrayBuffer)[] = [];
  accept() {}
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  close = vi.fn(() => {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  });
  event(event: string, sentence?: unknown, taskId?: string) {
    const task_id = taskId ?? JSON.parse(this.sent[0] as string).header.task_id;
    this.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          header: { event, task_id },
          payload: sentence ? { output: { sentence } } : {},
        }),
      }),
    );
  }
}
function setup() {
  vi.useFakeTimers();
  const socket = new Socket();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "test-temporary",
          expires_at: Date.now() / 1000 + 60,
        }),
      })
      .mockResolvedValueOnce({ webSocket: socket }),
  );
  const abort = new AbortController();
  const sentence = vi.fn();
  const error = vi.fn();
  const connecting = createDashscopeProvider("test-permanent").connect(
    { sampleRate: 16000 },
    sentence,
    error,
    abort.signal,
  );
  return { socket, abort, sentence, error, connecting };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("DashScope streaming lifecycle", () => {
  it("waits for task-started and drains the final sentence before finish resolves", async () => {
    const s = setup();
    const ready = vi.fn();
    void s.connecting.then(ready);
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).not.toHaveBeenCalled();
    s.socket.event("task-started");
    const connection = await s.connecting;
    connection.sendAudio(new ArrayBuffer(3200));
    const finished = vi.fn();
    const ending = connection.finish().then(finished);
    expect(finished).not.toHaveBeenCalled();
    s.socket.event("result-generated", {
      text: "最后一句",
      begin_time: 0,
      end_time: 500,
      sentence_end: true,
      sentence_id: 0,
    });
    expect(s.sentence).toHaveBeenCalledWith(
      expect.objectContaining({ text: "最后一句", final: true }),
    );
    s.socket.event("task-finished");
    await ending;
    expect(finished).toHaveBeenCalledOnce();
    expect(s.error).not.toHaveBeenCalled();
    const run = JSON.parse(s.socket.sent[0] as string);
    const finish = JSON.parse(s.socket.sent[2] as string);
    expect(finish.header.task_id).toBe(run.header.task_id);
    expect(s.socket.close).toHaveBeenCalledOnce();
  });
  it("cancels a pending start and times out a missing finish", async () => {
    const s = setup();
    const rejected = expect(s.connecting).rejects.toThrow("cancelled");
    await vi.advanceTimersByTimeAsync(0);
    s.abort.abort();
    await rejected;
    expect(s.socket.close).toHaveBeenCalledOnce();
    const next = setup();
    await vi.advanceTimersByTimeAsync(0);
    next.socket.event("task-started");
    const connection = await next.connecting;
    const ending = expect(connection.finish()).rejects.toThrow("failed");
    await vi.advanceTimersByTimeAsync(10_000);
    await ending;
    expect(next.socket.close).toHaveBeenCalledOnce();
  });
  it("does not apply the handshake timeout to an upgraded recording", async () => {
    vi.useFakeTimers();
    const socket = new Socket();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "test-temporary",
          expires_at: Date.now() / 1000 + 60,
        }),
      })
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        init.signal?.addEventListener("abort", () =>
          socket.dispatchEvent(new Event("close")),
        );
        return { webSocket: socket };
      });
    vi.stubGlobal("fetch", fetcher);
    const error = vi.fn();
    const connecting = createDashscopeProvider("test-permanent").connect(
      { sampleRate: 16000 },
      vi.fn(),
      error,
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    socket.event("task-started");
    const connection = await connecting;

    await vi.advanceTimersByTimeAsync(20_000);

    expect(error).not.toHaveBeenCalled();
    expect(socket.close).not.toHaveBeenCalled();
    connection.close();
  });
  it("propagates upstream close and rejects responses for another task", async () => {
    const s = setup();
    await vi.advanceTimersByTimeAsync(0);
    s.socket.event("task-started");
    await s.connecting;
    s.socket.dispatchEvent(new Event("close"));
    expect(s.error).toHaveBeenCalledOnce();
    const next = setup();
    const rejected = expect(next.connecting).rejects.toThrow("failed");
    await vi.advanceTimersByTimeAsync(0);
    next.socket.event("task-started", undefined, "wrong-task");
    await rejected;
  });
  it("marks token rejection and start-task failure as permanent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );
    const unauthorized = createDashscopeProvider("invalid").connect(
      { sampleRate: 16000 },
      vi.fn(),
      vi.fn(),
      new AbortController().signal,
    );
    await expect(unauthorized).rejects.toMatchObject({
      reason: "authentication",
      retryable: false,
    });

    const s = setup();
    const failed = s.connecting.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    s.socket.event("task-failed");
    await expect(failed).resolves.toMatchObject({
      reason: "configuration",
      retryable: false,
    });
  });
  it("preserves partial identity, requires sentence_end and ignores heartbeat packets", () => {
    const event = (sentence: unknown) => ({
      header: { event: "result-generated" },
      payload: { output: { sentence } },
    });
    const partial = {
      text: "你好",
      begin_time: 0,
      end_time: 500,
      sentence_id: 0,
      sentence_end: false,
    };
    const p = normalizeDashscopeSentence(event(partial), "task");
    const f = normalizeDashscopeSentence(
      event({ ...partial, sentence_end: true, end_time: 900 }),
      "task",
    );
    expect(p?.final).toBe(false);
    expect(f?.final).toBe(true);
    expect(p?.id).toBe(f?.id);
    expect(
      normalizeDashscopeSentence(
        event({ ...partial, heartbeat: true }),
        "task",
      ),
    ).toBeNull();
    expect(
      normalizeDashscopeSentence(event({ text: "bad" }), "task"),
    ).toBeNull();
  });
  it("rejects audio when the upstream send queue is full", async () => {
    const s = setup();
    await vi.advanceTimersByTimeAsync(0);
    s.socket.event("task-started");
    const connection = await s.connecting;
    s.socket.bufferedAmount = 61_000;
    expect(() => connection.sendAudio(new ArrayBuffer(3200))).toThrow(
      "ASR connection failed",
    );
    expect(s.socket.sent).toHaveLength(1);
  });
});
