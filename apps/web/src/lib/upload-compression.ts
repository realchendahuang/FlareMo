/**
 * Best-effort client-side transcode before upload
 * (docs/image-compression-design.md, docs/audio-compression-research.md).
 * Compression is decoration, never a contract: every failure path returns
 * the original file untouched, and a transcode that does not actually shrink
 * the payload is discarded. Audio additionally refuses to transcode when the
 * browser cannot play Ogg Opus back, or when the decoded PCM would exceed the
 * memory budget — an unplayable or tab-killing attachment is worse than a
 * large one.
 *
 * This module is the single hook-in for uploads; the two pipelines behind it
 * live in ./upload/{image-compression,audio-compression}, with the container
 * parsing in ./upload/audio-format and the engine probes in
 * ./upload/capabilities. Everything they export is re-exported here under the
 * same name, so importers keep seeing one module.
 */

import { compressAudio, shouldCompressAudio } from "./upload/audio-compression";
import { supportsWebpEncode } from "./upload/capabilities";
import {
  compressImage,
  MAX_COMPRESSION_INPUT_BYTES,
  shouldCompressImage,
} from "./upload/image-compression";
import {
  getAudioCompressionEnabled,
  getImageCompressionEnabled,
} from "./upload-settings";

export { compressAudio, shouldCompressAudio } from "./upload/audio-compression";
export {
  compressImage,
  type ImageCompressionOptions,
  MAX_COMPRESSION_INPUT_BYTES,
  MAX_UPLOAD_BYTES,
  prepareAvatarFile,
  shouldCompressImage,
} from "./upload/image-compression";

/**
 * Whether an upload would actually be handed to a transcoder, judging by the
 * user's switches and the engine's capabilities. Callers use it to decide if a
 * file above the server's cap still deserves a chance: the pipeline may bring
 * it under.
 *
 * The image branch checks the WebP encoder because that check is synchronous
 * and cheap — claiming compressibility on a browser that cannot encode WebP
 * (Safari, verified against real WebKit) would send the user through a long
 * upload the server then refuses. The audio capability proof is async and
 * costs a wasm instantiation, so it is not repeated here; the server's own cap
 * remains the backstop for the narrow case it cannot cover (a browser too old
 * to play back the Ogg it would produce, holding a >25 MiB lossless file).
 */
export function willCompressOnUpload(file: File): boolean {
  if (file.size > MAX_COMPRESSION_INPUT_BYTES) return false;
  if (getImageCompressionEnabled() && shouldCompressImage(file)) {
    return supportsWebpEncode();
  }
  return getAudioCompressionEnabled() && shouldCompressAudio(file);
}

/**
 * The single hook-in for uploadAttachment: consults the settings switches
 * and returns the file to actually upload. Never throws; every branch
 * degrades to the input file.
 */
export async function prepareUploadFile(file: File): Promise<File> {
  let current = file;
  if (getImageCompressionEnabled()) {
    current = (await compressImage(current)) ?? current;
  }
  if (getAudioCompressionEnabled()) {
    current = (await compressAudio(current)) ?? current;
  }
  return current;
}
