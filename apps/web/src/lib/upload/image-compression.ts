/**
 * Image half of the best-effort client-side transcode before upload
 * (docs/image-compression-design.md): decode → halving scale steps → canvas →
 * WebP. Compression is decoration, never a contract: every failure path returns
 * null and the caller uploads the original file, and an encode that does not
 * actually shrink the payload is discarded.
 */
import {
  THUMBNAIL_CONTENT_TYPE,
  THUMBNAIL_LONG_EDGE,
} from "@flaremo/contracts/constants";
import { supportsWebpEncode } from "./capabilities";

const MIN_COMPRESSIBLE_IMAGE_BYTES = 100 * 1024;
const MAX_LONG_EDGE = 2560;
// iOS Safari silently fails (blank canvas) above this area; stay below it.
const MAX_CANVAS_AREA = 16_000_000;
const WEBP_QUALITY = 0.82;
/** Thumbnails are card-sized previews; 0.7 is indistinguishable at that size. */
const THUMBNAIL_QUALITY = 0.7;
// A 2560px encode is normally well under a second even on a slow phone; this
// only exists so a missing toBlob callback cannot stall the upload forever.
const WEBP_ENCODE_TIMEOUT_MS = 10_000;

/**
 * The Worker's own attachment cap (apps/worker/src/attachment-http.ts
 * MAX_ATTACHMENT_BYTES). Duplicated rather than imported: this module is
 * client code and the Worker constant drags the whole server module in.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Largest input we will try to transcode. The cap is about memory, not
 * policy: the pipeline holds the whole source (and, for audio, its decoded
 * PCM) at once, and a file admitted here can be several times its own size in
 * decoded pixels or samples. Past this the original is uploaded untouched and
 * the server's own cap produces the error. 64 MiB comfortably covers a
 * one-hour 16 kHz WAV (~115 MB decoded, under the audio budget) and any phone
 * photo, while refusing to buffer a multi-hundred-megabyte file on a mobile
 * tab.
 */
export const MAX_COMPRESSION_INPUT_BYTES = 64 * 1024 * 1024;

const SKIP_IMAGE_TYPES = new Set([
  "image/gif", // canvas drops animation frames
  "image/svg+xml", // rasterizing destroys the vector
  "image/webp", // already the target format
  "image/avif", // already more efficient than WebP
]);

/**
 * Swaps a file name's extension. Shared with the audio pipeline, which renames
 * its own output the same way.
 */
export function withExtension(name: string, extension: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${extension}`;
}

export function shouldCompressImage(
  file: File,
  minBytes = MIN_COMPRESSIBLE_IMAGE_BYTES,
): boolean {
  const type = file.type.toLowerCase();
  if (!type.startsWith("image/")) return false;
  if (SKIP_IMAGE_TYPES.has(type)) return false;
  if (file.size < minBytes) return false;
  return true;
}

type DrawableSource = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

/**
 * Releases what a decoded source holds: bitmaps are closed, and the object URL
 * behind an <img> is revoked only here — revoking it at decode time would pull
 * the bytes out from under a later drawImage on engines that drop decoded
 * image data under memory pressure.
 */
function releaseSource(source: DrawableSource): void {
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    source.close();
    return;
  }
  const src = (source as HTMLImageElement).src;
  if (typeof src === "string" && src.startsWith("blob:")) {
    URL.revokeObjectURL(src);
  }
}

async function decodeOriented(file: File): Promise<DrawableSource> {
  const url = URL.createObjectURL(file);
  try {
    // <img> is the EXIF-safe decode path: every modern browser bakes the
    // orientation in when an <img> is drawn to canvas.
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } catch {
    URL.revokeObjectURL(url);
    // decode() can fail where createImageBitmap still succeeds (e.g. some
    // Workers/legacy contexts); orientation support there is best-effort.
    return createImageBitmap(file, { imageOrientation: "from-image" });
  }
}

function sourceDimensions(source: DrawableSource): {
  width: number;
  height: number;
} {
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    return { width: source.width, height: source.height };
  }
  const image = source as HTMLImageElement;
  return {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  };
}

function drawScaled(
  source: DrawableSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): HTMLCanvasElement | null {
  let current: DrawableSource = source;
  let currentWidth = sourceWidth;
  let currentHeight = sourceHeight;

  // Step down by halves for quality. Every intermediate canvas must stay
  // under the iOS area limit; past that, jump straight to the final size —
  // the source (bitmap/img) itself has no canvas limit.
  while (currentWidth > targetWidth * 2 && currentHeight > targetHeight * 2) {
    const nextWidth = Math.max(targetWidth, Math.floor(currentWidth / 2));
    const nextHeight = Math.max(targetHeight, Math.floor(currentHeight / 2));
    if (nextWidth * nextHeight > MAX_CANVAS_AREA) break;
    const canvas = document.createElement("canvas");
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.drawImage(
      current,
      0,
      0,
      currentWidth,
      currentHeight,
      0,
      0,
      nextWidth,
      nextHeight,
    );
    current = canvas;
    currentWidth = nextWidth;
    currentHeight = nextHeight;
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.drawImage(
    current,
    0,
    0,
    currentWidth,
    currentHeight,
    0,
    0,
    targetWidth,
    targetHeight,
  );
  return canvas;
}

function canvasToWebpBlob(
  canvas: HTMLCanvasElement,
  quality = WEBP_QUALITY,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      resolve(blob);
    };
    // Safari can drop the callback entirely (tainted canvas, context loss).
    // Without this timer the awaited upload would never start at all.
    const timer = setTimeout(() => settle(null), WEBP_ENCODE_TIMEOUT_MS);
    try {
      canvas.toBlob(
        (blob) => {
          clearTimeout(timer);
          settle(blob);
        },
        "image/webp",
        quality,
      );
    } catch {
      clearTimeout(timer);
      settle(null);
    }
  });
}

export type ImageCompressionOptions = {
  maxLongEdge?: number;
  quality?: number;
  minBytes?: number;
};

/**
 * Returns a WebP File, or null when the input should be uploaded as-is
 * (skip rules, unsupported browser, encode failure, or no size win).
 */
export async function compressImage(
  file: File,
  options: ImageCompressionOptions = {},
): Promise<File | null> {
  const minBytes = options.minBytes ?? MIN_COMPRESSIBLE_IMAGE_BYTES;
  const maxLongEdge = options.maxLongEdge ?? MAX_LONG_EDGE;
  const quality = options.quality ?? WEBP_QUALITY;

  if (!shouldCompressImage(file, minBytes)) return null;
  if (file.size > MAX_COMPRESSION_INPUT_BYTES) return null;
  if (!supportsWebpEncode()) return null;
  const source = await decodeOriented(file).catch(() => null);
  if (!source) return null;
  try {
    const { width, height } = sourceDimensions(source);
    if (!width || !height) return null;
    const scale = Math.min(1, maxLongEdge / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = drawScaled(source, width, height, targetWidth, targetHeight);
    if (!canvas) return null;
    const blob = await canvasToWebpBlob(canvas, quality);
    if (!blob || (minBytes > 0 && blob.size >= file.size)) return null;
    return new File([blob], withExtension(file.name, "webp"), {
      type: "image/webp",
    });
  } catch {
    return null;
  } finally {
    releaseSource(source);
  }
}

/**
 * Avatar compression helper. Resizes to 512px max long edge and encodes as
 * WebP at high quality (0.85), returning the compressed File or the original
 * file as fallback.
 */
export async function prepareAvatarFile(file: File): Promise<File> {
  const compressed = await compressImage(file, {
    maxLongEdge: 512,
    quality: 0.85,
    minBytes: 0,
  });
  return compressed ?? file;
}

/**
 * Timeline thumbnail for an image upload.
 *
 * The timeline used to render the full-resolution upload in every card: a
 * phone photo at 2560px is several hundred KB, and a page of twenty of them
 * pulled tens of megabytes for images shown a few hundred pixels wide. This
 * produces a `THUMBNAIL_LONG_EDGE`-pixel WebP that the Worker stores next to
 * the original, so the card fetches a few KB while the lightbox still opens
 * the untouched original.
 *
 * Returns null whenever a thumbnail is pointless or impossible — the caller
 * then omits the part and cards fall back to the original. Same contract as
 * the compression pipeline: decoration, never a contract.
 */
export async function createThumbnail(file: File): Promise<File | null> {
  const type = file.type.toLowerCase();
  if (!type.startsWith("image/")) return null;
  if (SKIP_IMAGE_TYPES.has(type)) return null;
  if (file.size > MAX_COMPRESSION_INPUT_BYTES) return null;
  if (!supportsWebpEncode()) return null;

  const source = await decodeOriented(file).catch(() => null);
  if (!source) return null;
  try {
    const { width, height } = sourceDimensions(source);
    if (!width || !height) return null;
    // Already small enough to serve as its own preview.
    if (Math.max(width, height) <= THUMBNAIL_LONG_EDGE) return null;
    const scale = THUMBNAIL_LONG_EDGE / Math.max(width, height);
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = drawScaled(source, width, height, targetWidth, targetHeight);
    if (!canvas) return null;
    const blob = await canvasToWebpBlob(canvas, THUMBNAIL_QUALITY);
    if (!blob || blob.size === 0) return null;
    return new File([blob], withExtension(file.name, "webp"), {
      type: THUMBNAIL_CONTENT_TYPE,
    });
  } catch {
    return null;
  } finally {
    releaseSource(source);
  }
}
