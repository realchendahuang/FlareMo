import { CAPTURE_BATCH_MAX_BYTES } from "@flaremo/contracts/constants";
import { incrementUsageCounter } from "@flaremo/domain";
import { Hono } from "hono";
import { z } from "zod";
import { bridgeCapture } from "../asr/bridge";
import { resolveVoiceService } from "../asr/configuration";
import { sniffAudioMimeType } from "../asr/minimax";
import { AsrProviderError } from "../asr/types";
import { getTrustedOrigins } from "../auth-env";
import {
  getBrowserRequestContext,
  getClientRequestContext,
  type HonoBindings,
} from "../context";
import { jsonError } from "../http";
import { rateLimitGuard } from "../rate-limit";

export const captureApi = new Hono<HonoBindings>();
captureApi.get("/status", async (c) => {
  try {
    const { db } = await getClientRequestContext(c);
    const configured = await resolveVoiceService(c.env, db);
    const available = Boolean(configured);
    return c.json(
      {
        available,
        provider: configured?.id ?? null,
        // Streaming kept as the compatibility flag: true only when a
        // live-streaming provider is configured. Batch (MiniMax)
        // deployments expose the mode through `kind` (rollout §3.3).
        streaming: configured?.kind === "streaming",
        kind: configured?.kind ?? null,
      },
      200,
      { "Cache-Control": "no-store" },
    );
  } catch (error) {
    return jsonError(c, error);
  }
});
captureApi.get("/ws", async (c) => {
  try {
    // Streaming capture: browser-only. It requires the deployment's own Origin
    // for the socket handshake, which an embedded client cannot supply, so a
    // bearer here would only widen the surface without ever working.
    const { user, db } = await getBrowserRequestContext(c);
    const origin = c.req.header("origin");
    if (!origin || !getTrustedOrigins(c.env).includes(origin))
      return c.text("Forbidden", 403);
    const configured = await resolveVoiceService(c.env, db);
    if (!configured) return c.text("ASR unavailable", 503);
    // The WebSocket bridge speaks the streaming contract only; a batch-only
    // deployment is unavailable for it (clients fall back to record-then-
    // transcribe through /transcribe).
    if (configured.kind !== "streaming") return c.text("ASR unavailable", 503);
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket")
      return c.text("Expected WebSocket upgrade", 426);
    const throttled = await rateLimitGuard(c, "capture", user.id);
    if (throttled) return throttled;
    const pair = new WebSocketPair();
    pair[1].accept();
    bridgeCapture(pair[1], configured.provider, async () => {
      const context = await getBrowserRequestContext(c);
      const service = await resolveVoiceService(c.env, context.db);
      if (service?.kind !== "streaming")
        throw new Error("Voice service disabled");
      return context;
    });
    return new Response(null, { status: 101, webSocket: pair[0] });
  } catch (error) {
    return jsonError(c, error);
  }
});

// BCP-47 language hint ("auto" disables the hint); the adapter forwards it
// as the provider `language` header.
const transcribeQuerySchema = z.object({
  startMs: z.coerce.number().int().nonnegative().max(3_600_000).default(0),
  language: z
    .string()
    .regex(/^(?:auto|[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)$/)
    .default("zh"),
  // Container declared by the client (encoder output); drives the multipart
  // file name/content type (opus → .ogg, wav → .wav). Unsniffable bodies fall
  // back to container sniffing for older clients.
  format: z.enum(["opus", "wav"]).optional(),
});

// Batch ASR proxy (rollout §3.2): the browser posts one raw audio slice as
// application/octet-stream, the Worker buffers it in memory and re-uploads
// it to MiniMax as multipart so the API key never reaches the browser. One
// slice per request; the client slices long sessions and stitches the
// returned timeline offsets.
captureApi.post("/transcribe", async (c) => {
  try {
    // Paid provider call: browser-only on purpose, so a `notes` PAT cannot spend
    // the deployment's transcription budget. Read-only /status above accepts a
    // bearer because an embedded client needs to know whether a mic button
    // should appear at all.
    const { user, db } = await getBrowserRequestContext(c);
    const configured = await resolveVoiceService(c.env, db);
    if (configured?.kind !== "batch")
      return c.json(
        { error: { message: "Batch transcription is not configured" } },
        503,
      );
    const throttled = await rateLimitGuard(c, "capture", user.id);
    if (throttled) return throttled;
    const query = transcribeQuerySchema.parse(
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    const contentType = c.req.header("content-type")?.split(";")[0];
    if (contentType !== "application/octet-stream")
      return c.json(
        { error: { message: "Expected application/octet-stream audio" } },
        400,
      );
    const audio = await c.req.arrayBuffer();
    if (!audio.byteLength)
      return c.json({ error: { message: "Empty audio chunk" } }, 400);
    // Memory bound: one slice buffered for the multipart reassembly (risk R2).
    if (audio.byteLength > CAPTURE_BATCH_MAX_BYTES)
      return c.json(
        { error: { message: "Audio chunk exceeds the size limit" } },
        413,
      );
    const mimeType =
      query.format === "opus"
        ? "audio/ogg"
        : query.format === "wav"
          ? "audio/wav"
          : (sniffAudioMimeType(new Uint8Array(audio)) ?? "audio/wav");
    const transcription = await configured.provider.transcribe(audio, {
      startMs: query.startMs,
      language: query.language,
      mimeType,
      signal: c.req.raw.signal,
    });
    const seconds = Math.max(0, Math.round(transcription.durationMs / 1000));
    // Fire-and-forget per-user metering (same pattern as the search paths):
    // usage tracking must never fail the transcription response.
    c.executionCtx.waitUntil(
      incrementUsageCounter(db, user, "asr_seconds", seconds).catch(
        () => undefined,
      ),
    );
    return c.json(
      {
        utterances: transcription.utterances,
        durationMs: transcription.durationMs,
      },
      200,
      { "Cache-Control": "no-store" },
    );
  } catch (error) {
    if (error instanceof AsrProviderError)
      // Upstream details (including the key) are never echoed; the generic
      // message maps onto the client's transcribeFailed state.
      return c.json(
        { error: { message: "Transcription failed. Retry the capture." } },
        502,
      );
    return jsonError(c, error);
  }
});
