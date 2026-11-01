import type { FlareMoDb, UserRow } from "@flaremo/db";
import { attachments } from "@flaremo/db";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { listMemoAttachments } from "./attachments-list";
import {
  assertCanManageAttachment,
  getAttachmentById,
} from "./attachments-metadata";
import { chunkForD1, d1IdsPerStatement } from "./d1-limits";
import { NotFoundError } from "./errors";
import { parseResourceName } from "./ids";
import { getMemoById } from "./memos";
import { insertMemosSseEvent } from "./memos-sse";
import { assertCanEditMemo } from "./team-permissions";

export async function bindMemoAttachments(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
  attachmentNames: string[],
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  const memo = await getMemoById(db, user, normalizedMemoId);
  assertCanEditMemo(user, memo);
  const ids = attachmentNames.map((name) =>
    parseResourceName(name, "attachments"),
  );
  const now = new Date().toISOString();
  // The contract allows 100 attachment names; that plus the user/state
  // predicates is already past D1's 100-parameter cap, and Connect callers
  // can send an unvalidated list. Every statement below therefore binds one
  // chunk at a time.
  const idChunks = chunkForD1(ids, d1IdsPerStatement(6));

  if (ids.length > 0) {
    const existing: Array<typeof attachments.$inferSelect> = [];
    for (const idChunk of idChunks) {
      existing.push(
        ...(await db
          .select()
          .from(attachments)
          .where(
            and(
              eq(attachments.userId, user.id),
              inArray(attachments.id, idChunk),
              isNull(attachments.deletedAt),
              eq(attachments.state, "ready"),
            ),
          )),
      );
    }
    const existingIds = new Set(existing.map((attachment) => attachment.id));
    const missing = ids.find((id) => !existingIds.has(id));
    if (missing) {
      throw new NotFoundError(`Attachment not found: ${missing}`);
    }
  }

  const clearExisting = db
    .update(attachments)
    .set({ memoId: null, updatedAt: now })
    .where(and(eq(attachments.memoId, normalizedMemoId)));

  // Attachment binding is a memo mutation in upstream Memos. Keep the
  // durable outbox write in the same D1 batch so reconnecting SSE clients do
  // not observe a successful update without its refresh event.
  await db.batch([
    clearExisting,
    ...idChunks.map((idChunk) =>
      db
        .update(attachments)
        .set({ memoId: normalizedMemoId, updatedAt: now })
        .where(
          and(
            eq(attachments.userId, user.id),
            inArray(attachments.id, idChunk),
          ),
        ),
    ),
    insertMemosSseEvent(db, {
      type: "memo.updated",
      name: memo.id,
      visibility: memo.visibility,
      teamId: memo.teamId,
      creatorId: memo.userId,
      createdAt: now,
    }),
  ]);

  return listMemoAttachments(db, user, normalizedMemoId);
}

export async function updateAttachmentMemo(
  db: FlareMoDb,
  user: UserRow,
  id: string,
  memoId: string | null,
) {
  const attachment = await getAttachmentById(db, user, id);
  await assertCanManageAttachment(db, user, attachment);
  const normalizedMemoId = memoId ? parseResourceName(memoId, "memos") : null;
  if (normalizedMemoId) {
    const memo = await getMemoById(db, user, normalizedMemoId);
    assertCanEditMemo(user, memo);
  }
  await db
    .update(attachments)
    .set({ memoId: normalizedMemoId, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(attachments.id, attachment.id),
        eq(attachments.userId, attachment.userId),
      ),
    );
  return getAttachmentById(db, user, attachment.id);
}

export async function softDeleteAttachment(
  db: FlareMoDb,
  user: UserRow,
  id: string,
) {
  const attachment = await getAttachmentById(db, user, id);
  await assertCanManageAttachment(db, user, attachment);
  const now = new Date().toISOString();
  await db
    .update(attachments)
    .set({ deletedAt: now, updatedAt: now, memoId: null, state: "deleting" })
    .where(
      and(
        eq(attachments.id, attachment.id),
        eq(attachments.userId, attachment.userId),
      ),
    );
  return attachment;
}

export async function markAttachmentDeleting(
  db: FlareMoDb,
  user: UserRow,
  id: string,
) {
  const attachment = await getAttachmentById(db, user, id, {
    includeUnavailable: true,
  });
  await assertCanManageAttachment(db, user, attachment);
  const now = new Date().toISOString();
  await db
    .update(attachments)
    .set({ state: "deleting", updatedAt: now })
    .where(
      and(
        eq(attachments.id, attachment.id),
        eq(attachments.userId, attachment.userId),
      ),
    );
  return { ...attachment, state: "deleting" as const, updatedAt: now };
}

export async function finalizeAttachmentDelete(
  db: FlareMoDb,
  user: UserRow,
  id: string,
) {
  const attachment = await getAttachmentById(db, user, id, {
    includeUnavailable: true,
  });
  await assertCanManageAttachment(db, user, attachment);
  // Called after the R2 binary is already deleted, so the row can go too.
  await db
    .delete(attachments)
    .where(
      and(
        eq(attachments.id, attachment.id),
        eq(attachments.userId, attachment.userId),
      ),
    );
  return attachment;
}

export async function listAttachmentCleanupCandidates(
  db: FlareMoDb,
  cutoff: string,
) {
  return db
    .select()
    .from(attachments)
    .where(
      or(
        // Rows awaiting R2 cleanup carry `deleting` regardless of `deletedAt`
        // (both pre-deletion markers and finalize survivors), so a hard-delete
        // path that forgot the immediate marker is still caught by the cron.
        eq(attachments.state, "deleting"),
        and(
          isNull(attachments.memoId),
          isNull(attachments.articleId),
          lt(attachments.createdAt, cutoff),
        ),
      ),
    )
    .limit(100);
}

export async function finalizeAttachmentCleanup(db: FlareMoDb, id: string) {
  // The binary is already gone when we finalize, so the row is dead weight:
  // delete it instead of parking `deletedAt` on it forever (D1 accumulation).
  await db
    .delete(attachments)
    .where(eq(attachments.id, parseResourceName(id, "attachments")));
}

/** Batch form of finalizeAttachmentCleanup for the daily cron sweep. */
export async function finalizeAttachmentCleanupForIds(
  db: FlareMoDb,
  ids: string[],
) {
  if (ids.length === 0) return;
  await db.delete(attachments).where(inArray(attachments.id, ids));
}
