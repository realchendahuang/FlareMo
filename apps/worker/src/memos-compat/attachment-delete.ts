/**
 * Attachment deletion flow shared by the Memos compatibility surfaces
 * (routes/memos-api.ts, routes/memos-current-api.ts,
 * routes/memos-connect-api.ts): soft-delete the row, drop the R2 object,
 * then finalize the row removal. All three surfaces previously carried
 * identical copies of this sequence; the surrounding error envelope stays
 * the caller's business.
 */
import { thumbnailKeyFor } from "@flaremo/contracts/constants";
import type { FlareMoDb, UserRow } from "@flaremo/db";
import {
  finalizeAttachmentDelete,
  markAttachmentDeleting,
} from "@flaremo/domain";
import type { FlareMoEnv } from "../env";

export async function deleteMemosAttachment(
  env: FlareMoEnv,
  db: FlareMoDb,
  user: UserRow,
  attachmentId: string,
) {
  const attachment = await markAttachmentDeleting(db, user, attachmentId);
  await env.ATTACHMENTS.delete(
    attachment.payload?.thumbnail === true
      ? [attachment.r2Key, thumbnailKeyFor(attachment.r2Key)]
      : attachment.r2Key,
  );
  await finalizeAttachmentDelete(db, user, attachment.id);
  return attachment;
}
