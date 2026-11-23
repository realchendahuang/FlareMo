import type { FlareMoDb, MemoRow } from "@flaremo/db";
import { attachments, memoRelations, memos } from "@flaremo/db";
import { and, eq, inArray, lt } from "drizzle-orm";
import { chunkForD1, d1IdsPerStatement } from "./d1-limits";
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

/**
 * Comment memos are ordinary `memos` rows; the only thing that marks them as
 * comments is their `memo_relations` row, which cascades with either side.
 * Hard-deleting a parent therefore used to leave its replies behind as normal
 * records on the timeline. Walk the reply tree (comments can themselves be
 * replied to through the Connect API) so the same delete removes it.
 */
async function listCommentDescendantIds(
  db: FlareMoDb,
  rootId: string,
): Promise<string[]> {
  const seen = new Set([rootId]);
  const descendants: string[] = [];
  let frontier = [rootId];
  // A hard cap keeps a pathological reply chain from turning one delete into
  // an unbounded batch; any remainder is still deleted by the caller's root
  // statement only when it is a direct reply, so keep the cap generous.
  while (frontier.length > 0 && descendants.length < 2000) {
    const next: string[] = [];
    for (const chunk of chunkForD1(frontier, d1IdsPerStatement())) {
      const rows = await db
        .select({ memoId: memoRelations.memoId })
        .from(memoRelations)
        .where(
          and(
            inArray(memoRelations.relatedMemoId, chunk),
            eq(memoRelations.type, "comment"),
          ),
        );
      for (const row of rows) {
        if (seen.has(row.memoId)) continue;
        seen.add(row.memoId);
        next.push(row.memoId);
      }
    }
    descendants.push(...next);
    frontier = next;
  }
  return descendants;
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
  const commentIds = await listCommentDescendantIds(db, existing.id);
  const attachmentTargets = [existing.id, ...commentIds];
  const attachmentChunks = chunkForD1(attachmentTargets, d1IdsPerStatement());
  const firstAttachmentTargets = attachmentChunks[0] ?? [existing.id];
  const restAttachmentTargets = attachmentChunks.slice(1);
  // Attachment rows are only marked `deleting`, never dropped here: the daily
  // GC removes the binary from R2 and then deletes the rows. This way even a
  // hard-delete path that skips `markMemoAttachmentsDeleting` cannot orphan
  // the object — the rows let the cron predicate find it forever.
  await db.batch([
    db
      .update(attachments)
      .set({ state: "deleting", updatedAt: now })
      .where(inArray(attachments.memoId, firstAttachmentTargets)),
    ...restAttachmentTargets.map((chunk) =>
      db
        .update(attachments)
        .set({ state: "deleting", updatedAt: now })
        .where(inArray(attachments.memoId, chunk)),
    ),
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
    // Replies belong to the parent's lifecycle, not to their authors' own
    // timelines, so they go in the same batch without a user filter.
    ...chunkForD1(commentIds, d1IdsPerStatement()).map((chunk) =>
      db.delete(memos).where(inArray(memos.id, chunk)),
    ),
    db
      .delete(memos)
      .where(and(eq(memos.id, id), eq(memos.userId, existing.userId))),
  ]);
}
