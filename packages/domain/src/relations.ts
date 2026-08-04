import type { PatchMemoRelationsInput } from "@flaremo/contracts";
import type { FlareMoDb, UserRow } from "@flaremo/db";
import { memoRelations, memos } from "@flaremo/db";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { NotFoundError } from "./errors";
import { parseResourceName } from "./ids";
import { getMemoById, getMemoByIdForViewer } from "./memos";
import { insertMemosSseEvent } from "./memos-sse";

export async function listMemoRelations(
  db: FlareMoDb,
  user: UserRow | null,
  memoId: string,
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  await getMemoByIdForViewer(db, user, normalizedMemoId);
  return db
    .select()
    .from(memoRelations)
    .where(eq(memoRelations.memoId, normalizedMemoId));
}

/**
 * List the complete relation set for a memo, including links where the memo
 * is the related target. Memos' ListMemoRelations RPC exposes both directions
 * while the legacy FlareMo relation helper historically returned only the
 * rows owned by `memoId`; keep the two contracts explicit.
 */
export async function listMemoRelationsForViewer(
  db: FlareMoDb,
  user: UserRow | null,
  memoId: string,
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  await getMemoByIdForViewer(db, user, normalizedMemoId);
  return db
    .select()
    .from(memoRelations)
    .where(
      or(
        eq(memoRelations.memoId, normalizedMemoId),
        eq(memoRelations.relatedMemoId, normalizedMemoId),
      ),
    )
    .orderBy(asc(memoRelations.createdAt), asc(memoRelations.memoId));
}

export async function replaceMemoRelations(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
  input: PatchMemoRelationsInput,
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  const memo = await getMemoById(db, user, normalizedMemoId);

  const rows: Array<{
    memoId: string;
    relatedMemoId: string;
    type: "reference" | "comment";
    createdAt: string;
  }> = [];
  const seen = new Set<string>();
  const now = new Date().toISOString();

  for (const relation of input.relations) {
    const relatedMemoId = parseResourceName(relation.related_memo, "memos");
    const key = `${normalizedMemoId}:${relatedMemoId}:${relation.type}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    rows.push({
      memoId: normalizedMemoId,
      relatedMemoId,
      type: relation.type,
      createdAt: now,
    });
  }

  if (rows.length > 0) {
    const relatedIds = [...new Set(rows.map((row) => row.relatedMemoId))];
    const relatedRows = await db
      .select({ id: memos.id })
      .from(memos)
      .where(and(eq(memos.userId, user.id), inArray(memos.id, relatedIds)));
    if (relatedRows.length !== relatedIds.length) {
      throw new NotFoundError("One or more related memos were not found");
    }
  }

  const deleteStatement = db
    .delete(memoRelations)
    .where(eq(memoRelations.memoId, normalizedMemoId));
  const eventStatement = insertMemosSseEvent(db, {
    type: "memo.updated",
    name: memo.id,
    visibility: memo.visibility,
    creatorId: memo.userId,
    createdAt: now,
  });
  if (rows.length > 0) {
    await db.batch([
      deleteStatement,
      db.insert(memoRelations).values(rows),
      eventStatement,
    ]);
  } else {
    await db.batch([deleteStatement, eventStatement]);
  }

  return listMemoRelations(db, user, normalizedMemoId);
}

export async function listMemoRelationContext(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  await getMemoById(db, user, normalizedMemoId, { includeDeleted: true });
  const relations = await db
    .select()
    .from(memoRelations)
    .where(eq(memoRelations.memoId, normalizedMemoId));
  const related = await getRelatedMemos(
    db,
    user,
    relations.map((relation) => relation.relatedMemoId),
  );
  return relations.flatMap((relation) => {
    const memo = related.get(relation.relatedMemoId);
    return memo ? [{ relation, memo }] : [];
  });
}

export async function listMemoBacklinkContext(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  await getMemoById(db, user, normalizedMemoId, { includeDeleted: true });
  const relations = await db
    .select()
    .from(memoRelations)
    .where(eq(memoRelations.relatedMemoId, normalizedMemoId));
  const related = await getRelatedMemos(
    db,
    user,
    relations.map((relation) => relation.memoId),
  );
  return relations.flatMap((relation) => {
    const memo = related.get(relation.memoId);
    return memo ? [{ relation, memo }] : [];
  });
}

export async function deleteMemoRelationsForMemo(
  db: FlareMoDb,
  memoId: string,
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  await db
    .delete(memoRelations)
    .where(
      or(
        eq(memoRelations.memoId, normalizedMemoId),
        eq(memoRelations.relatedMemoId, normalizedMemoId),
      ),
    );
}

async function getRelatedMemos(db: FlareMoDb, user: UserRow, ids: string[]) {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(memos)
    .where(and(eq(memos.userId, user.id), inArray(memos.id, ids)));
  return new Map(rows.map((memo) => [memo.id, memo] as const));
}
