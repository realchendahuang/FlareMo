import type { FlareMoDb, UserRow } from "@flaremo/db";
import { memoRevisions } from "@flaremo/db";
import { desc, eq } from "drizzle-orm";
import { NotFoundError } from "./errors";
import { parseResourceName } from "./ids";
import { getMemoById, updateMemo } from "./memos";
import { assertCanEditMemo } from "./team-permissions";

export async function listMemoRevisions(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
  limit = 50,
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  const memo = await getMemoById(db, user, normalizedMemoId, {
    includeDeleted: true,
  });
  assertCanEditMemo(user, memo);
  const rows = await db
    .select()
    .from(memoRevisions)
    .where(eq(memoRevisions.memoId, normalizedMemoId))
    .orderBy(desc(memoRevisions.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return memo.userId === user.id
    ? rows
    : rows.filter((revision) => revision.visibility !== "private");
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
    .where(eq(memoRevisions.id, id))
    .get();
  if (!revision) throw new NotFoundError("Memo revision not found");
  const memo = await getMemoById(db, user, revision.memoId, {
    includeDeleted: true,
  });
  assertCanEditMemo(user, memo);
  if (memo.userId !== user.id && revision.visibility === "private") {
    throw new NotFoundError("Memo revision not found");
  }
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
