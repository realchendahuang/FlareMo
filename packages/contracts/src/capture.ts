import { z } from "zod";
import { CAPTURE_MAX_TEXT, CAPTURE_SAMPLE_RATE } from "./constants";

// Re-exported so existing `@flaremo/contracts` imports keep working. Code
// that only needs a constant should import `@flaremo/contracts/constants`
// instead: importing this module pulls zod in with it.
export {
  CAPTURE_BATCH_MAX_BYTES,
  CAPTURE_BATCH_SLICE_MS,
  CAPTURE_MAX_DURATION_MS,
  CAPTURE_MAX_FRAME_BYTES,
  CAPTURE_MAX_TEXT,
  CAPTURE_SAMPLE_RATE,
} from "./constants";

export const captureUtteranceSchema = z.object({
  startMs: z.number().nonnegative().finite(),
  endMs: z.number().nonnegative().finite(),
  text: z.string().min(1).max(16_000),
  speaker: z.string().max(64).optional(),
});
export type CaptureUtterance = z.infer<typeof captureUtteranceSchema>;
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
