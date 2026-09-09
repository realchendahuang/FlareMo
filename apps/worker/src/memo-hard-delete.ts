import type { FlareMoDb, UserRow } from "@flaremo/db";
import { hardDeleteMemo, markMemoAttachmentsDeleting } from "@flaremo/domain";
import type { FlareMoEnv } from "./env";

/**
 * Hard-delete a memo together with its attachment artifacts. Every
 * hard-delete surface must go through this helper: `hardDeleteMemo` removes
 * the attachment rows in the same batch as the memo, so afterwards nothing
 * references the R2 objects — skipping this step leaks the binaries forever.
 */
export async function hardDeleteMemoWithAttachments(
  env: Pick<FlareMoEnv, "ATTACHMENTS">,
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
) {
  const attachments = await markMemoAttachmentsDeleting(db, user, memoId);
  const objectKeys = attachments
    .filter((attachment) => attachment.state !== "missing")
    .map((attachment) => attachment.r2Key);
  if (objectKeys.length > 0) {
    await env.ATTACHMENTS.delete(objectKeys);
  }
  await hardDeleteMemo(db, user, memoId);
}
