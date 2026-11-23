import {
  ApiError,
  bindMemoAttachments,
  createMemo,
  uploadAttachment,
} from "@/api";
import type { TranslationKey } from "@/i18n";
import type { MemoCaptureInput } from "@/lib/local-memo-capture";
import {
  MAX_UPLOAD_BYTES,
  willCompressOnUpload,
} from "@/lib/upload-compression";

/**
 * A memo is a short note, not a photo album: nine images at most, laid out
 * as a grid under the text. More pictures belong in an article.
 */
export const MAX_MEMO_IMAGES = 9;

/** Images a capture will attach: picked image files plus pasted ones. */
export function countMemoImages(input: MemoCaptureInput) {
  return (
    input.files.filter((file) => file.type.startsWith("image/")).length +
    (input.preuploadedAttachmentNames?.length ?? 0)
  );
}

export async function createMemoWithAttachments(input: MemoCaptureInput) {
  const memo = await createMemo({
    content: input.content,
    visibility: input.visibility,
    payload: { tags: input.tags, client_id: input.clientId },
    source: "web",
  });

  // Inline-pasted images were uploaded before the memo existed; claim them
  // first — the bind replaces the (still empty) list, so it must run before
  // the per-file uploads below append to it.
  if (input.preuploadedAttachmentNames?.length) {
    await bindMemoAttachments(memo.name, input.preuploadedAttachmentNames);
  }

  // A mobile queue can hold many large files. Upload them in order so a
  // transient failure stops early, and each retry only replays stable ids.
  for (const [index, file] of input.files.entries()) {
    await uploadAttachment({
      file,
      memo: memo.name,
      clientId: getAttachmentCaptureClientId(input.clientId, index),
    });
  }

  return memo;
}

function getAttachmentCaptureClientId(
  memoClientId: string | undefined,
  index: number,
) {
  if (!memoClientId) return undefined;
  const clientId = `${memoClientId}:attachment:${index}`;
  return clientId.length <= 128 ? clientId : undefined;
}

export function shouldQueueAfterFailure(error: unknown) {
  // Queue only when the request never received a meaningful answer (network
  // failure, timeout, rate limit). A server error response is surfaced to
  // the user instead, with the draft kept intact for an explicit retry.
  if (!(error instanceof ApiError)) return true;
  return error.status === 408 || error.status === 429;
}

export function shouldContinueQueuedSubmissionAfterFailure(error: unknown) {
  return (
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  );
}

export function validateMemoCaptureSubmission(
  input: MemoCaptureInput,
  t: (key: TranslationKey) => string,
) {
  if (input.content.length > 100_000) {
    return new Error(t("toast.memoTooLong"));
  }
  if (input.files.length > 100) {
    return new Error(t("toast.tooManyAttachments"));
  }
  if (countMemoImages(input) > MAX_MEMO_IMAGES) {
    return new Error(t("toast.tooManyMemoImages"));
  }
  // A file over the cap is only rejected when nothing downstream can shrink it:
  // transcode-before-upload exists precisely for oversized photos and
  // recordings, so sending those back with "too large" would refuse the case
  // the feature was built for. Anything the pipeline will not touch (an
  // already-compressed video, a huge PDF) still fails here, before the user
  // waits through an upload the server is going to reject.
  const oversized = input.files.some(
    (file) => file.size > MAX_UPLOAD_BYTES && !willCompressOnUpload(file),
  );
  if (oversized) {
    return new Error(t("toast.attachmentTooLarge"));
  }
  return undefined;
}
