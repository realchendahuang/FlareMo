import { z } from "zod";

export const CAPTURE_SAMPLE_RATE = 16_000;
export const CAPTURE_MAX_FRAME_BYTES = 6_400;
export const CAPTURE_MAX_TEXT = 90_000;
export const CAPTURE_MAX_DURATION_MS = 60 * 60_000;
export const captureStartSchema = z
  .object({
    type: z.literal("start"),
    sampleRate: z.literal(CAPTURE_SAMPLE_RATE),
    encoding: z.literal("pcm_s16le"),
    language: z.enum(["auto", "zh", "en"]).optional(),
  })
  .strict();
export const captureStopSchema = z.object({ type: z.literal("stop") }).strict();
export const captureClientMessageSchema = z.discriminatedUnion("type", [
  captureStartSchema,
  captureStopSchema,
  z.object({ type: z.literal("ping") }).strict(),
]);
export const captureSentenceSchema = z.object({
  type: z.literal("sentence"),
  id: z.string().min(1).max(160),
  text: z.string().min(1).max(16_000),
  final: z.boolean(),
  startedAt: z.number().nonnegative().finite().optional(),
  endedAt: z.number().nonnegative().finite().optional(),
  receivedAt: z.number().int().nonnegative(),
});
export const captureServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  captureSentenceSchema,
  z.object({ type: z.literal("pong") }),
  z.object({
    type: z.literal("error"),
    code: z.enum([
      "INVALID_MESSAGE",
      "ASR_UPSTREAM_FAILED",
      "TIMEOUT",
      "SESSION_EXPIRED",
      "LIMIT_REACHED",
    ]),
    message: z.string().max(160),
    retryable: z.boolean().optional(),
  }),
  z.object({ type: z.literal("finished") }),
]);
export type CaptureStart = z.infer<typeof captureStartSchema>;
export type CaptureSentenceEvent = z.infer<typeof captureSentenceSchema>;
export type CaptureServerMessage = z.infer<typeof captureServerMessageSchema>;

export const localCaptureSchema = z.object({
  version: z.literal(1),
  clientId: z.string().uuid(),
  text: z.string().max(CAPTURE_MAX_TEXT),
  startedAt: z.number().nonnegative(),
  duration: z.number().nonnegative().max(86400),
  tags: z.array(z.string().max(64)).max(20),
  visibility: z.enum(["private", "public"]),
  gap: z.boolean(),
});
export type LocalCapture = z.infer<typeof localCaptureSchema>;
