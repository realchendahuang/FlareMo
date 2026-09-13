import { z } from "zod";
import {
  type AsrConnection,
  AsrProviderError,
  type AsrSentence,
  type StreamingAsrProvider,
  sendAsrAudio,
} from "./types";

// Beijing endpoint; provider protocols/credentials never reach the browser.
const TOKEN_URL =
  "https://dashscope.aliyuncs.com/api/v1/tokens?expire_in_seconds=1800";
const WS_URL = "https://dashscope.aliyuncs.com/api-ws/v1/inference";
const sentenceSchema = z.object({
  text: z.string().max(16_000),
  begin_time: z.number().nonnegative(),
  end_time: z.number().nonnegative().nullable().optional(),
  sentence_id: z.number().int().nonnegative().optional(),
  sentence_end: z.boolean(),
  heartbeat: z.boolean().optional(),
});
const eventSchema = z.object({
  header: z.object({ event: z.string(), task_id: z.string().optional() }),
  payload: z
    .object({
      output: z.object({ sentence: z.unknown().optional() }).optional(),
    })
    .optional(),
});

function httpFailure(status?: number) {
  if (status === 401 || status === 403)
    return new AsrProviderError("authentication", false);
  if (status === 402) return new AsrProviderError("quota", false);
  if (status === 429) return new AsrProviderError("capacity", true);
  if (status && status >= 400 && status < 500)
    return new AsrProviderError("configuration", false);
  return new AsrProviderError("network", true);
}
export function normalizeDashscopeSentence(
  message: unknown,
  sessionId: string,
): AsrSentence | null {
  const event = eventSchema.safeParse(message);
  if (!event.success || event.data.header.event !== "result-generated")
    return null;
  const sentence = sentenceSchema.safeParse(
    event.data.payload?.output?.sentence,
  );
  if (
    !sentence.success ||
    sentence.data.heartbeat ||
    !sentence.data.text.trim()
  )
    return null;
  const s = sentence.data;
  if (s.sentence_end && (s.end_time == null || s.end_time < s.begin_time))
    return null;
  return {
    id: `${sessionId}:${s.sentence_id ?? s.begin_time}`,
    text: s.text,
    final: s.sentence_end,
    startedAt: s.begin_time,
    ...(s.end_time == null ? {} : { endedAt: s.end_time }),
  };
}

export function createDashscopeProvider(
  apiKey: string,
  model = "qwen-audio-3.0-asr-flash-streaming",
): StreamingAsrProvider {
  return {
    async connect(
      options,
      onSentence,
      onError,
      signal,
    ): Promise<AsrConnection> {
      // A credential per connection avoids sharing rotated keys across environments.
      const handshakeTimeout = new AbortController();
      const connectSignal = AbortSignal.any([signal, handshakeTimeout.signal]);
      const handshakeTimer = setTimeout(() => handshakeTimeout.abort(), 20_000);
      const socket = await (async () => {
        try {
          let response: Response;
          try {
            response = await fetch(TOKEN_URL, {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}` },
              signal: connectSignal,
            });
          } catch {
            if (signal.aborted) throw new Error("Capture cancelled");
            throw new AsrProviderError(
              connectSignal.aborted ? "timeout" : "network",
              true,
            );
          }
          if (!response.ok) throw httpFailure(response.status);
          let token: { token: string; expires_at: number };
          try {
            token = z
              .object({
                token: z.string().min(1),
                expires_at: z.number().positive(),
              })
              .parse(await response.json());
          } catch {
            throw new AsrProviderError("protocol", false);
          }
          if (token.expires_at * 1000 <= Date.now())
            throw new AsrProviderError("authentication", false);
          let upstream: Response;
          try {
            upstream = await fetch(WS_URL, {
              headers: {
                Upgrade: "websocket",
                Authorization: `Bearer ${token.token}`,
              },
              signal: connectSignal,
            });
          } catch {
            if (signal.aborted) throw new Error("Capture cancelled");
            throw new AsrProviderError(
              connectSignal.aborted ? "timeout" : "network",
              true,
            );
          }
          if (!upstream.webSocket) throw httpFailure(upstream.status);
          return upstream.webSocket;
        } finally {
          // An upgrade fetch retains its signal in Workers. Do not let the
          // handshake timeout terminate a healthy long-running session.
          clearTimeout(handshakeTimer);
        }
      })();
      socket.accept();
      if (signal.aborted || connectSignal.aborted) {
        socket.close();
        throw new Error("Capture cancelled");
      }
      return new Promise<AsrConnection>((resolve, reject) => {
        const taskId = crypto.randomUUID();
        let state: "starting" | "running" | "finishing" | "closed" = "starting";
        let finishPromise: Promise<void> | undefined;
        let resolveFinish: (() => void) | undefined;
        let rejectFinish: ((error: Error) => void) | undefined;
        let timer = setTimeout(
          () => fail(new AsrProviderError("timeout", true)),
          10_000,
        );
        function cleanup() {
          clearTimeout(timer);
          signal.removeEventListener("abort", cancel);
          socket.removeEventListener("message", message);
          socket.removeEventListener("error", socketFailure);
          socket.removeEventListener("close", socketFailure);
          try {
            socket.close(1000, "Capture ended");
          } catch {
            /* Already closed. */
          }
        }
        function fail(error = new AsrProviderError("network", true)) {
          if (state === "closed") return;
          const previous = state;
          state = "closed";
          cleanup();
          if (previous === "starting") reject(error);
          else if (previous === "finishing") rejectFinish?.(error);
          else onError(error);
        }
        function socketFailure() {
          fail(new AsrProviderError("network", true));
        }
        function cancel() {
          if (state === "closed") return;
          const previous = state;
          state = "closed";
          cleanup();
          if (previous === "starting") reject(new Error("Capture cancelled"));
          if (previous === "finishing")
            rejectFinish?.(new Error("Capture cancelled"));
        }
        const connection: AsrConnection = {
          sendAudio(data) {
            if (state !== "running") throw new Error("ASR is not ready");
            sendAsrAudio(socket, data);
          },
          finish() {
            if (finishPromise) return finishPromise;
            if (state !== "running")
              return Promise.reject(new Error("ASR is not ready"));
            state = "finishing";
            finishPromise = new Promise<void>((done, error) => {
              resolveFinish = done;
              rejectFinish = error;
            });
            timer = setTimeout(
              () => fail(new AsrProviderError("timeout", true)),
              10_000,
            );
            try {
              socket.send(
                JSON.stringify({
                  header: {
                    action: "finish-task",
                    task_id: taskId,
                    streaming: "duplex",
                  },
                  payload: { input: {} },
                }),
              );
            } catch {
              fail();
            }
            return finishPromise;
          },
          close: cancel,
        };
        function message(event: MessageEvent) {
          if (state === "closed") return;
          try {
            if (typeof event.data !== "string" || event.data.length > 128_000)
              return fail(new AsrProviderError("protocol", false));
            const raw: unknown = JSON.parse(event.data);
            const parsed = eventSchema.parse(raw);
            if (parsed.header.task_id !== taskId)
              return fail(new AsrProviderError("protocol", false));
            switch (parsed.header.event) {
              case "task-started":
                if (state !== "starting")
                  return fail(new AsrProviderError("protocol", false));
                state = "running";
                clearTimeout(timer);
                resolve(connection);
                break;
              case "task-failed":
                fail(
                  new AsrProviderError(
                    state === "starting" ? "configuration" : "provider",
                    state !== "starting",
                  ),
                );
                break;
              case "task-finished":
                if (state !== "finishing")
                  return fail(new AsrProviderError("protocol", false));
                state = "closed";
                cleanup();
                resolveFinish?.();
                break;
              case "result-generated": {
                if (state === "starting")
                  return fail(new AsrProviderError("protocol", false));
                const sentence = normalizeDashscopeSentence(raw, taskId);
                if (sentence) onSentence(sentence);
                break;
              }
            }
          } catch (error) {
            fail(
              error instanceof AsrProviderError
                ? error
                : new AsrProviderError("protocol", false),
            );
          }
        }
        socket.addEventListener("message", message);
        socket.addEventListener("error", socketFailure);
        socket.addEventListener("close", socketFailure);
        signal.addEventListener("abort", cancel, { once: true });
        try {
          socket.send(
            JSON.stringify({
              header: {
                action: "run-task",
                task_id: taskId,
                streaming: "duplex",
              },
              payload: {
                task_group: "audio",
                task: "asr",
                function: "recognition",
                model,
                parameters: {
                  format: "pcm",
                  sample_rate: options.sampleRate,
                  heartbeat: true,
                  ...(options.language && options.language !== "auto"
                    ? { language_hints: [options.language] }
                    : {}),
                },
                input: {},
              },
            }),
          );
        } catch {
          fail(new AsrProviderError("network", true));
        }
      });
    },
  };
}
