import type { TranslationKey } from "@/i18n";
import { MAX_MEMO_IMAGES } from "@/lib/memo-submission";
import {
  MAX_UPLOAD_BYTES,
  willCompressOnUpload,
} from "@/lib/upload-compression";

export const MAX_MEMO_ATTACHMENTS = 100;

export function isImageFile(file: Pick<File, "type">): boolean {
  return file.type.toLowerCase().startsWith("image/");
}

export function isImageContentType(contentType?: string | null): boolean {
  return Boolean(contentType?.toLowerCase().startsWith("image/"));
}

/** Keeps non-image files from a paste or drop payload (PDF, audio, archives…). */
export function extractNonImageFiles(files: ArrayLike<File>): File[] {
  return Array.from(files).filter((file) => !isImageFile(file));
}

/** True when a drag event carries OS files rather than a text selection. */
export function hasFileTransfer(
  dataTransfer: Pick<DataTransfer, "types"> | null | undefined,
): boolean {
  if (!dataTransfer?.types) return false;
  return Array.from(dataTransfer.types).includes("Files");
}

export type FilterComposerFilesOptions = {
  incoming: readonly File[];
  existingFileCount: number;
  existingImageCount: number;
};

export type FilterComposerFilesResult = {
  accepted: File[];
  errorKeys: TranslationKey[];
};

/**
 * Shared gate for files picked, pasted or dropped into any memo surface
 * (timeline composer, fullscreen canvas, inline card editor). Enforces the
 * 25 MiB per-file ceiling (exempting formats the client compresses before
 * upload), the 100-attachment ceiling, and the 9-image ceiling up front so
 * invalid files fail immediately rather than on submit.
 */
export function filterAcceptedComposerFiles({
  incoming,
  existingFileCount,
  existingImageCount,
}: FilterComposerFilesOptions): FilterComposerFilesResult {
  const accepted: File[] = [];
  const errors = new Set<TranslationKey>();
  let totalFiles = existingFileCount;
  let totalImages = existingImageCount;

  for (const file of incoming) {
    if (file.size > MAX_UPLOAD_BYTES && !willCompressOnUpload(file)) {
      errors.add("toast.attachmentTooLarge");
      continue;
    }
    if (totalFiles >= MAX_MEMO_ATTACHMENTS) {
      errors.add("toast.tooManyAttachments");
      continue;
    }
    const image = isImageFile(file);
    if (image && totalImages >= MAX_MEMO_IMAGES) {
      errors.add("toast.tooManyMemoImages");
      continue;
    }
    accepted.push(file);
    totalFiles += 1;
    if (image) totalImages += 1;
  }

  return {
    accepted,
    errorKeys: [...errors],
  };
}
