import type { FlareMoDb, UserRow } from "@flaremo/db";
import { memoRevisions } from "@flaremo/db";
import { and, desc, eq } from "drizzle-orm";
import { NotFoundError } from "./errors";
import { parseResourceName } from "./ids";
import { getMemoById, updateMemo } from "./memos";

export async function listMemoRevisions(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
  limit = 50,
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  await getMemoById(db, user, normalizedMemoId, { includeDeleted: true });
  return db
    .select()
    .from(memoRevisions)
    .where(
      and(
        eq(memoRevisions.memoId, normalizedMemoId),
        eq(memoRevisions.userId, user.id),
      ),
    )
    .orderBy(desc(memoRevisions.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export async function getMemoRevision(
  db: FlareMoDb,
  user: UserRow,
  revisionId: string,
) {
  const id = parseResourceName(revisionId, "revisions");
  const revision = await db
    .select()
    .from(memoRevisions)
    .where(and(eq(memoRevisions.id, id), eq(memoRevisions.userId, user.id)))
    .get();
  if (!revision) throw new NotFoundError("Memo revision not found");
  return revision;
}

export async function restoreMemoRevision(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
  revisionId: string,
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  const revision = await getMemoRevision(db, user, revisionId);
  if (revision.memoId !== normalizedMemoId) {
    throw new NotFoundError("Memo revision not found");
  }
  return updateMemo(db, user, normalizedMemoId, {
    content: revision.content,
    visibility: revision.visibility,
    payload: revision.payload,
  });
}
