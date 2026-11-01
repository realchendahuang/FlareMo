/**
 * Zero-dependency numeric/string constants shared by both runtimes.
 *
 * This module must stay free of zod and of every other contracts module:
 * the web client and the Worker both import it, and pulling the schema
 * barrel in for a single number drags the whole OpenAPI document (plus
 * zod) into the browser entry chunk and into every Worker isolate's
 * startup graph.
 */

export const FLAREMO_API_VERSION = "0.25.0";

// Streaming capture (16 kHz mono s16le).
export const CAPTURE_SAMPLE_RATE = 16_000;
export const CAPTURE_MAX_FRAME_BYTES = 6_400;
export const CAPTURE_MAX_TEXT = 90_000;
export const CAPTURE_MAX_DURATION_MS = 60 * 60_000;

// Batch (MiniMax) transcription. The provider's hard limit is 500 s / 50 MB
// per request; clients slice below both, and the Worker proxy buffers at most
// one slice.
export const CAPTURE_BATCH_SLICE_MS = 480_000;
export const CAPTURE_BATCH_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Timeline thumbnail contract.
 *
 * The client renders a `THUMBNAIL_LONG_EDGE`-pixel WebP next to the original
 * upload and sends it in the same multipart request. The Worker stores it
 * beside the original under a deterministic key, so serving and deleting it
 * needs no extra column:
 *
 *   original: attachments/<user>/<random>.<ext>
 *   thumbnail: attachments/<user>/<random>.<ext>.thumb.webp
 *
 * A suffix rather than a sibling directory keeps existing key-generation,
 * quota accounting and every R2 delete path working unchanged (they all
 * operate on `r2Key`, and `.thumb.webp` is derived from it).
 */
export const THUMBNAIL_LONG_EDGE = 640;
export const THUMBNAIL_CONTENT_TYPE = "image/webp";
export const THUMBNAIL_KEY_SUFFIX = ".thumb.webp";

/** Derives the thumbnail object key from an attachment's original key. */
export function thumbnailKeyFor(r2Key: string): string {
  return `${r2Key}${THUMBNAIL_KEY_SUFFIX}`;
}
