import type { PatchMemoRelationsInput } from "@flaremo/contracts";
import type { FlareMoDb, UserRow } from "@flaremo/db";
import { memoRelations } from "@flaremo/db";
import { eq, or } from "drizzle-orm";
import { parseResourceName } from "./ids";
import { getMemoById } from "./memos";

export async function listMemoRelations(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  await getMemoById(db, user, normalizedMemoId);
  return db
    .select()
    .from(memoRelations)
    .where(eq(memoRelations.memoId, normalizedMemoId));
}

export async function replaceMemoRelations(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
  input: PatchMemoRelationsInput,
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  await getMemoById(db, user, normalizedMemoId);

  const rows = [];
  const seen = new Set<string>();
  const now = new Date().toISOString();

  for (const relation of input.relations) {
    const relatedMemoId = parseResourceName(relation.related_memo, "memos");
    await getMemoById(db, user, relatedMemoId);
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

  await db
    .delete(memoRelations)
    .where(eq(memoRelations.memoId, normalizedMemoId));
  if (rows.length > 0) {
    await db.insert(memoRelations).values(rows);
  }

  return listMemoRelations(db, user, normalizedMemoId);
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
