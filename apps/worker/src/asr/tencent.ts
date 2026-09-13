import { z } from "zod";
import {
  type AsrConnection,
  AsrProviderError,
  type AsrSentence,
  type StreamingAsrProvider,
  sendAsrAudio,
} from "./types";

type TencentCredentials = {
  appId: string;
  secretId: string;
  secretKey: string;
};
type TencentRecognitionHints = {
  hotwordId?: string;
  hotwordList?: string;
};
const resultSchema = z.object({
  slice_type: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  index: z.number().int().nonnegative(),
  start_time: z.number().int().nonnegative(),
  end_time: z.number().int().nonnegative(),
  voice_text_str: z.string().max(16_000),
});
const eventSchema = z.object({
  code: z.number().int(),
  voice_id: z.string().max(128),
  result: resultSchema.optional(),
  final: z.union([z.literal(0), z.literal(1)]).optional(),
});

function httpFailure(status?: number) {
  if (status === 401 || status === 403)
    return new AsrProviderError("authentication", false);
  if (status === 429) return new AsrProviderError("capacity", true);
  if (status && status >= 400 && status < 500)
    return new AsrProviderError("configuration", false);
  return new AsrProviderError("network", true);
}

function tencentFailure(code: number) {
  switch (code) {
    case 4002:
      return new AsrProviderError("authentication", false);
    case 4004:
    case 4005:
      return new AsrProviderError("quota", false);
    case 4001:
    case 4003:
    case 4007:
    case 6001:
      return new AsrProviderError("configuration", false);
    case 4006:
      return new AsrProviderError("capacity", true);
    default:
      return new AsrProviderError("provider", true);
  }
}

// Tencent's realtime protocol signs the unescaped host/path/query with HMAC-SHA1.
// Only the Worker uses this URL; never return or log it, including on fetch errors.
export async function signTencentAsrUrl(
  credentials: TencentCredentials,
  session: {
    model: string;
    voiceId: string;
    timestamp: number;
    nonce: number;
    hotwordId?: string;
    hotwordList?: string;
  },
): Promise<string> {
  const params: Record<string, string> = {
    engine_model_type: session.model,
    expired: String(session.timestamp + 300),
    needvad: "1",
    nonce: String(session.nonce),
    secretid: credentials.secretId,
    timestamp: String(session.timestamp),
    voice_format: "1",
    voice_id: session.voiceId,
  };
  if (session.hotwordId) params.hotword_id = session.hotwordId;
  if (session.hotwordList) params.hotword_list = session.hotwordList;
  const entries = Object.entries(params).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const path = `asr.cloud.tencent.com/asr/v2/${credentials.appId}`;
  const query = entries.map(([key, value]) => `${key}=${value}`).join("&");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(credentials.secretKey),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${path}?${query}`),
  );
  const encoded = new URLSearchParams(entries.map(([k, v]) => [k, v]));
  encoded.set(
    "signature",
    btoa(String.fromCharCode(...new Uint8Array(signature))),
  );
  // Workers use fetch + Upgrade over HTTPS for an outbound secure WebSocket.
  return `https://${path}?${encoded}`;
}

export function createTencentProvider(
  credentials: TencentCredentials,
  model?: string,
  hints: TencentRecognitionHints = {},
): StreamingAsrProvider {
  return {
    async connect(
      options,
      onSentence,
      onError,
      signal,
    ): Promise<AsrConnection> {
      if (signal.aborted) throw new Error("Capture cancelled");
      const voiceId = crypto.randomUUID();
      const handshakeTimeout = new AbortController();
      const connectSignal = AbortSignal.any([signal, handshakeTimeout.signal]);
      const handshakeTimer = setTimeout(() => handshakeTimeout.abort(), 20_000);
      let upstream: Response;
      try {
        const url = await signTencentAsrUrl(credentials, {
          model:
            model ?? (options.language === "en" ? "16k_en_large" : "16k_zh_en"),
          voiceId,
          timestamp: Math.floor(Date.now() / 1000),
          nonce:
            ((crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) %
              999_999_999) +
            1,
          hotwordId: hints.hotwordId,
          hotwordList: hints.hotwordList,
        });
        if (connectSignal.aborted) throw new Error("Capture cancelled");
        upstream = await fetch(url, {
          headers: { Upgrade: "websocket" },
          signal: connectSignal,
          // Workers does not implement redirect="error". Manual mode also
          // keeps the signed credential URL from following another origin.
          redirect: "manual",
        });
      } catch {
        // A runtime's fetch error can contain the signed URL.
        if (signal.aborted) throw new Error("Capture cancelled");
        throw new AsrProviderError(
          connectSignal.aborted ? "timeout" : "network",
          true,
        );
      } finally {
        // AbortSignal.timeout would stay attached to the upgraded socket and
        // terminate a healthy recording 20 seconds after connect began.
        clearTimeout(handshakeTimer);
      }
      if (!upstream.webSocket) throw httpFailure(upstream.status);
      const socket = upstream.webSocket;
      return new Promise<AsrConnection>((resolve, reject) => {
        let state: "starting" | "running" | "finishing" | "closed" = "starting";
        let audioBuffer = new Uint8Array(6_400);
        let bufferedAudioBytes = 0;
        let finishPromise: Promise<void> | undefined;
        let resolveFinish: (() => void) | undefined;
        let rejectFinish: ((error: Error) => void) | undefined;
        let timer = setTimeout(
          () => fail(new AsrProviderError("timeout", true)),
          10_000,
        );
        function cleanup() {
          clearTimeout(timer);
          audioBuffer = new Uint8Array(0);
          bufferedAudioBytes = 0;
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
            const bytes = new Uint8Array(data);
            let offset = 0;
            while (offset < bytes.byteLength) {
              const size = Math.min(
                audioBuffer.byteLength - bufferedAudioBytes,
                bytes.byteLength - offset,
              );
              audioBuffer.set(
                bytes.subarray(offset, offset + size),
                bufferedAudioBytes,
              );
              bufferedAudioBytes += size;
              offset += size;
              if (bufferedAudioBytes === audioBuffer.byteLength) {
                sendAsrAudio(socket, audioBuffer.buffer);
                audioBuffer = new Uint8Array(6_400);
                bufferedAudioBytes = 0;
              }
            }
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
              if (bufferedAudioBytes) {
                sendAsrAudio(
                  socket,
                  audioBuffer.buffer.slice(0, bufferedAudioBytes),
                );
                audioBuffer = new Uint8Array(0);
                bufferedAudioBytes = 0;
              }
              socket.send(JSON.stringify({ type: "end" }));
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
            const parsed = eventSchema.parse(JSON.parse(event.data));
            if (parsed.code !== 0) return fail(tencentFailure(parsed.code));
            if (parsed.voice_id !== voiceId)
              return fail(new AsrProviderError("protocol", false));
            if (state === "starting") {
              if (parsed.result || parsed.final === 1)
                return fail(new AsrProviderError("protocol", false));
              state = "running";
              clearTimeout(timer);
              resolve(connection);
              return;
            }
            const r = parsed.result;
            if (r) {
              if (r.end_time < r.start_time)
                return fail(new AsrProviderError("protocol", false));
              if (r.voice_text_str.trim()) {
                const sentence: AsrSentence = {
                  id: `${voiceId}:${r.index}`,
                  text: r.voice_text_str,
                  final: r.slice_type === 2,
                  startedAt: r.start_time,
                  endedAt: r.end_time,
                };
                onSentence(sentence);
              }
            }
            if (parsed.final === 1) {
              if (state !== "finishing")
                return fail(new AsrProviderError("protocol", false));
              state = "closed";
              cleanup();
              resolveFinish?.();
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
          socket.accept();
          if (signal.aborted) cancel();
          else if (connectSignal.aborted)
            fail(new AsrProviderError("timeout", true));
        } catch {
          fail(new AsrProviderError("network", true));
        }
      });
    },
  };
}
