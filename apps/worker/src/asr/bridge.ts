import {
  CAPTURE_MAX_DURATION_MS,
  CAPTURE_MAX_FRAME_BYTES,
  type CaptureServerMessage,
  captureClientMessageSchema,
} from "@flaremo/contracts";
import {
  ASR_MAX_BUFFERED_BYTES,
  type AsrConnection,
  AsrProviderError,
  type StreamingAsrProvider,
} from "./types";

function normalizeTranscript(text: string) {
  return text.replace(
    /\b(?:flaremo|flaremore)\b|(?<![A-Za-z0-9_])(?:fla尔莫|flair莫)(?![A-Za-z0-9_])/gi,
    "FlareMo",
  );
}

/** Owns both sockets. No audio buffering: clients must wait for ready. */
export function bridgeCapture(
  server: WebSocket,
  provider: StreamingAsrProvider,
  authenticate: () => Promise<unknown>,
) {
  let state: "waiting" | "connecting" | "ready" | "stopping" | "closed" =
    "waiting";
  const abort = new AbortController();
  let connection: AsrConnection | undefined;
  let lastAudio = Date.now();
  let credit = 64_000;
  let creditedAt = Date.now();
  let authPending = false;
  const watchdog = setInterval(() => {
    if (state === "ready" && Date.now() - lastAudio > 15_000) fail("TIMEOUT");
  }, 5_000);
  const authTimer = setInterval(() => {
    if (authPending) return;
    authPending = true;
    void authenticate()
      .catch(() => fail("SESSION_EXPIRED"))
      .finally(() => {
        authPending = false;
      });
  }, 60_000);
  const maxTimer = setTimeout(
    () => fail("LIMIT_REACHED"),
    CAPTURE_MAX_DURATION_MS,
  );
  let deadline = setTimeout(() => fail("TIMEOUT"), 10_000);
  function send(message: CaptureServerMessage) {
    if (state === "closed") return false;
    const payload = JSON.stringify(message);
    // Three bytes per UTF-16 code unit safely bounds typical UTF-8 transcript text.
    if (server.bufferedAmount + payload.length * 3 > ASR_MAX_BUFFERED_BYTES) {
      console.warn("[capture] delivery failed", {
        reason: "downstream_backpressure",
      });
      cleanup();
      return false;
    }
    try {
      server.send(payload);
      return true;
    } catch {
      console.warn("[capture] delivery failed", {
        reason: "downstream_send",
      });
      cleanup();
      return false;
    }
  }
  function cleanup() {
    if (state === "closed") return;
    state = "closed";
    clearInterval(watchdog);
    clearInterval(authTimer);
    clearTimeout(deadline);
    clearTimeout(maxTimer);
    abort.abort();
    connection?.close();
    server.removeEventListener("message", message);
    server.removeEventListener("close", browserDisconnected);
    server.removeEventListener("error", browserDisconnected);
    try {
      server.close(1000, "Capture ended");
    } catch {
      /* Already closed. */
    }
  }
  function fail(
    code: Extract<CaptureServerMessage, { type: "error" }>["code"],
    retryable?: boolean,
  ) {
    if (state === "closed") return;
    console.warn("[capture] session failed", {
      code,
      retryable: retryable ?? false,
    });
    try {
      send({
        type: "error",
        code,
        message: "Capture interrupted",
        ...(retryable === undefined ? {} : { retryable }),
      });
    } catch {
      /* The peer may have disconnected. */
    } finally {
      cleanup();
    }
  }
  function providerFailed(error: unknown) {
    if (state === "closed") return;
    const failure =
      error instanceof AsrProviderError
        ? error
        : new AsrProviderError("provider", true);
    console.warn("[capture] ASR provider failed", {
      reason: failure.reason,
      retryable: failure.retryable,
    });
    fail("ASR_UPSTREAM_FAILED", failure.retryable);
  }
  function browserDisconnected() {
    console.warn("[capture] browser disconnected");
    cleanup();
  }
  async function start(
    options: Parameters<StreamingAsrProvider["connect"]>[0],
  ) {
    try {
      const value = await provider.connect(
        options,
        (sentence) => {
          if (state === "ready" || state === "stopping") {
            send({
              type: "sentence",
              ...sentence,
              text: normalizeTranscript(sentence.text),
              receivedAt: Date.now(),
            });
          }
        },
        providerFailed,
        abort.signal,
      );
      if (state !== "connecting") {
        value.close();
        return;
      }
      connection = value;
      state = "ready";
      lastAudio = Date.now();
      clearTimeout(deadline);
      send({ type: "ready" });
    } catch (error) {
      providerFailed(error);
    }
  }
  async function stop() {
    state = "stopping";
    clearTimeout(deadline);
    try {
      await connection?.finish();
      send({ type: "finished" });
      cleanup();
    } catch (error) {
      providerFailed(error);
    }
  }
  function message(event: MessageEvent) {
    if (state === "closed") return;
    try {
      if (typeof event.data !== "string") {
        const data = event.data;
        if (
          state !== "ready" ||
          !(data instanceof ArrayBuffer) ||
          !data.byteLength ||
          data.byteLength % 2 ||
          data.byteLength > CAPTURE_MAX_FRAME_BYTES
        )
          return fail("INVALID_MESSAGE");
        const now = Date.now();
        credit = Math.min(64_000, credit + (now - creditedAt) * 32);
        creditedAt = now;
        if (data.byteLength > credit) return fail("LIMIT_REACHED");
        credit -= data.byteLength;
        lastAudio = now;
        try {
          connection?.sendAudio(data);
        } catch (error) {
          providerFailed(
            error instanceof AsrProviderError
              ? error
              : new AsrProviderError("network", true),
          );
        }
        return;
      }
      if (event.data.length > 1024) return fail("INVALID_MESSAGE");
      const parsed = captureClientMessageSchema.safeParse(
        JSON.parse(event.data),
      );
      if (!parsed.success) return fail("INVALID_MESSAGE");
      const data = parsed.data;
      if (data.type === "ping") {
        send({ type: "pong" });
        return;
      }
      if (data.type === "start") {
        if (state !== "waiting") return fail("INVALID_MESSAGE");
        state = "connecting";
        clearTimeout(deadline);
        deadline = setTimeout(() => fail("TIMEOUT"), 30_000);
        void start({
          sampleRate: data.sampleRate,
          ...(data.language ? { language: data.language } : {}),
        });
      } else if (state === "ready") void stop();
      else if (state !== "stopping") {
        send({ type: "finished" });
        cleanup();
      }
    } catch {
      fail("INVALID_MESSAGE");
    }
  }
  server.binaryType = "arraybuffer";
  server.addEventListener("message", message);
  server.addEventListener("close", browserDisconnected);
  server.addEventListener("error", browserDisconnected);
  return cleanup;
}
