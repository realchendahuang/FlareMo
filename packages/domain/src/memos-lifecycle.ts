import type { FlareMoDb, MemoRow } from "@flaremo/db";
import { attachments, memos } from "@flaremo/db";
import { and, eq, lt } from "drizzle-orm";
import { insertEmbeddingTask } from "./embedding-outbox";
import { isCommentMemo } from "./memo-comment-filter";
import {
  adjustmentForMemoTransition,
  hourlyCountStatements,
} from "./memo-hourly-counts";
import { getMemoById } from "./memos-read";
import { insertMemosSseEvent } from "./memos-sse";
import { insertMemosWebhookEvent } from "./memos-webhooks";
import { updateMemo } from "./memos-write";
import { assertCanDeleteMemo, type TeamViewer } from "./team-permissions";

/**
 * Recycle-bin TTL sweep candidates: trashed memos whose `deletedAt` fell
 * behind the retention cutoff. Trash purging hard-deletes these together
 * with their attachment binaries (see the worker's scheduled maintenance).
 */
export async function listExpiredTrashedMemos(
  db: FlareMoDb,
  cutoff: string,
  limit = 200,
) {
  return db
    .select({ id: memos.id, userId: memos.userId })
    .from(memos)
    .where(and(eq(memos.status, "trashed"), lt(memos.deletedAt, cutoff)))
    .limit(limit);
}

export async function moveMemoToTrash(
  db: FlareMoDb,
  user: TeamViewer,
  id: string,
): Promise<MemoRow> {
  return updateMemo(db, user, id, { status: "trashed" });
}

export async function hardDeleteMemo(
  db: FlareMoDb,
  user: TeamViewer,
  id: string,
): Promise<void> {
  const existing = await getMemoById(db, user, id, { includeDeleted: true });
  assertCanDeleteMemo(user, existing);
  const existingIsComment = await isCommentMemo(db, existing.id);
  const now = new Date().toISOString();
  const eventStatement = insertMemosSseEvent(db, {
    type: "memo.deleted",
    name: existing.id,
    visibility: existing.visibility,
    teamId: existing.teamId,
    creatorId: existing.userId,
    createdAt: now,
  });
  const webhookEventStatement = insertMemosWebhookEvent(db, {
    receiverId: existing.userId,
    activityType: "memos.memo.deleted",
    creator: user,
    memo: existing,
    createdAt: now,
  });
  const embeddingTaskStatement = insertEmbeddingTask(db, {
    userId: existing.userId,
    resourceType: "memo",
    resourceId: existing.id,
    operation: "delete",
    createdAt: now,
  });
  // Attachment rows are only marked `deleting`, never dropped here: the daily
  // GC removes the binary from R2 and then deletes the rows. This way even a
  // hard-delete path that skips `markMemoAttachmentsDeleting` cannot orphan
  // the object — the rows let the cron predicate find it forever.
  await db.batch([
    db
      .update(attachments)
      .set({ state: "deleting", updatedAt: now })
      .where(eq(attachments.memoId, id)),
    eventStatement,
    webhookEventStatement,
    embeddingTaskStatement,
    // Debit the activity counter in the same batch: a memo that is gone must
    // stop being counted, and `existing` is the only record of which UTC hour
    // and status bucket it occupied. The "deleted" state is terminal and has
    // no counter column, so this debits without crediting a new bucket.
    // Comments were never counted (see createMemoComment).
    ...(existingIsComment
      ? []
      : hourlyCountStatements(
          db,
          adjustmentForMemoTransition(existing, {
            userId: existing.userId,
            createdAt: existing.createdAt,
            status: "deleted",
          }),
          now,
        )),
    db
      .delete(memos)
      .where(and(eq(memos.id, id), eq(memos.userId, existing.userId))),
  ]);
}
