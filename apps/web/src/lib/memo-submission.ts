import { ApiError, createMemo, uploadAttachment } from "@/api";
import type { TranslationKey } from "@/i18n";
import type { MemoCaptureInput } from "@/lib/local-memo-capture";

export async function createMemoWithAttachments(input: MemoCaptureInput) {
  const memo = await createMemo({
    content: input.content,
    visibility: input.visibility,
    payload: { tags: input.tags, client_id: input.clientId },
    source: "web",
  });

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
  if (input.files.some((file) => file.size > 25 * 1024 * 1024)) {
    return new Error(t("toast.attachmentTooLarge"));
  }
  return undefined;
}
