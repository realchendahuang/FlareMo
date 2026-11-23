import { thumbnailKeyFor } from "@flaremo/contracts/constants";
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
  // Each attachment owns two objects: the original and, when one was
  // generated at upload, a derived `.thumb.webp` neighbour. Deleting only the
  // original would leak the preview forever.
  const objectKeys = attachments
    .filter((attachment) => attachment.state !== "missing")
    .flatMap((attachment) =>
      attachment.payload?.thumbnail === true
        ? [attachment.r2Key, thumbnailKeyFor(attachment.r2Key)]
        : [attachment.r2Key],
    );
  if (objectKeys.length > 0) {
    await env.ATTACHMENTS.delete(objectKeys);
  }
  await hardDeleteMemo(db, user, memoId);
}
