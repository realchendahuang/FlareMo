import type { PatchMemoRelationsInput } from "@flaremo/contracts";
import type { FlareMoDb, UserRow } from "@flaremo/db";
import { memoRelations, memos } from "@flaremo/db";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import {
  chunkForD1,
  d1IdsPerRepeatedBinding,
  d1IdsPerStatement,
  d1RowsPerStatement,
} from "./d1-limits";
import { NotFoundError, ValidationError } from "./errors";
import { parseResourceName } from "./ids";
import { getMemoById, getMemoByIdForViewer } from "./memos";
import { insertMemosSseEvent } from "./memos-sse";
import { assertCanEditMemo, memoReadScope } from "./team-permissions";

export async function listMemoRelations(
  db: FlareMoDb,
  user: UserRow | null,
  memoId: string,
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  await getMemoByIdForViewer(db, user, normalizedMemoId);
  const rows = await db
    .select()
    .from(memoRelations)
    .where(eq(memoRelations.memoId, normalizedMemoId));
  return filterReadableRelations(db, user, normalizedMemoId, rows);
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
  const rows = await db
    .select()
    .from(memoRelations)
    .where(
      or(
        eq(memoRelations.memoId, normalizedMemoId),
        eq(memoRelations.relatedMemoId, normalizedMemoId),
      ),
    )
    .orderBy(asc(memoRelations.createdAt), asc(memoRelations.memoId));
  return filterReadableRelations(db, user, normalizedMemoId, rows);
}

/**
 * Batched sibling of {@link listMemoRelationsForViewer} for comment/list
 * hydration: one relation query and one readability probe for a whole page
 * instead of two round trips per memo. Each requested memo receives exactly
 * the rows the single-id helper would have returned for it — including rows
 * shared between two requested memos, which appear in both buckets.
 */
export async function listMemoRelationsForMemosForViewer(
  db: FlareMoDb,
  user: UserRow | null,
  memoIds: string[],
): Promise<Map<string, Array<typeof memoRelations.$inferSelect>>> {
  const requested = [
    ...new Set(memoIds.map((id) => parseResourceName(id, "memos"))),
  ];
  const grouped = new Map<string, Array<typeof memoRelations.$inferSelect>>(
    requested.map((id) => [id, []]),
  );
  if (requested.length === 0) return grouped;

  const requestedIds = new Set(requested);
  // Two bindings per id (one for each side of the relation), so the page's
  // memory ids have to be chunked before they reach D1's 100-parameter cap.
  const rows: Array<typeof memoRelations.$inferSelect> = [];
  for (const idChunk of chunkForD1(requested, d1IdsPerRepeatedBinding(2))) {
    rows.push(
      ...(await db
        .select()
        .from(memoRelations)
        .where(
          or(
            inArray(memoRelations.memoId, idChunk),
            inArray(memoRelations.relatedMemoId, idChunk),
          ),
        )
        .orderBy(asc(memoRelations.createdAt), asc(memoRelations.memoId))),
    );
  }
  // A relation whose two endpoints fall into different chunks matches the
  // `OR` in both chunk queries, so chunking can return the same row twice.
  const seen = new Set<string>();
  const uniqueRows = rows.filter((row) => {
    const key = `${row.memoId}\u0000${row.relatedMemoId}\u0000${row.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  uniqueRows.sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      a.memoId.localeCompare(b.memoId),
  );
  if (uniqueRows.length === 0) return grouped;

  // Every id that can appear on the far side of a relation for a requested
  // memo; one probe answers readability for all of them.
  const farIds = new Set<string>();
  for (const row of uniqueRows) {
    if (requestedIds.has(row.memoId)) farIds.add(row.relatedMemoId);
    if (requestedIds.has(row.relatedMemoId)) farIds.add(row.memoId);
  }
  const readableIds = new Set<string>();
  if (farIds.size > 0) {
    const readable: Array<{ id: string }> = [];
    for (const idChunk of chunkForD1([...farIds], d1IdsPerStatement())) {
      readable.push(
        ...(await db
          .select({ id: memos.id })
          .from(memos)
          .where(and(memoReadScope(user), inArray(memos.id, idChunk)))),
      );
    }
    for (const row of readable) readableIds.add(row.id);
  }

  for (const row of uniqueRows) {
    if (requestedIds.has(row.memoId) && readableIds.has(row.relatedMemoId)) {
      grouped.get(row.memoId)?.push(row);
    }
    if (requestedIds.has(row.relatedMemoId) && readableIds.has(row.memoId)) {
      grouped.get(row.relatedMemoId)?.push(row);
    }
  }
  return grouped;
}

export async function replaceMemoRelations(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
  input: PatchMemoRelationsInput,
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  const memo = await getMemoById(db, user, normalizedMemoId);
  assertCanEditMemo(user, memo);

  // A relation patch expresses the references the client wants; it never
  // touches comment relations, whose rows are keyed by the comment memo
  // itself and are managed by the comment lifecycle.
  const MAX_MEMO_RELATIONS = 200;
  const rows: Array<{
    memoId: string;
    relatedMemoId: string;
    type: "reference" | "comment";
    createdAt: string;
  }> = [];
  const seen = new Set<string>();
  const now = new Date().toISOString();

  for (const relation of input.relations) {
    if (relation.type !== "reference") continue;
    if (rows.length >= MAX_MEMO_RELATIONS) {
      throw new ValidationError(
        `A memo may carry at most ${MAX_MEMO_RELATIONS} relations`,
      );
    }
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
    // `memoReadScope` adds its own bindings, and 200 relations would otherwise
    // blow the 100-parameter cap before the write is even attempted.
    const foundIds = new Set<string>();
    for (const idChunk of chunkForD1(relatedIds, d1IdsPerStatement())) {
      const relatedRows = await db
        .select({ id: memos.id })
        .from(memos)
        .where(and(memoReadScope(user), inArray(memos.id, idChunk)));
      for (const row of relatedRows) foundIds.add(row.id);
    }
    if (foundIds.size !== relatedIds.length) {
      throw new NotFoundError("One or more related memos were not found");
    }
  }

  const deleteStatement = db
    .delete(memoRelations)
    .where(
      and(
        eq(memoRelations.memoId, normalizedMemoId),
        eq(memoRelations.type, "reference"),
      ),
    );
  const eventStatement = insertMemosSseEvent(db, {
    type: "memo.updated",
    name: memo.id,
    visibility: memo.visibility,
    teamId: memo.teamId,
    creatorId: memo.userId,
    createdAt: now,
  });
  if (rows.length > 0) {
    // Four columns per relation row: 25 rows is the D1 ceiling. The delete and
    // the event stay in the same batch as the first insert slice so the write
    // remains one transaction.
    const insertSlices = chunkForD1(rows, d1RowsPerStatement(4));
    await db.batch([
      deleteStatement,
      ...insertSlices.map((slice) => db.insert(memoRelations).values(slice)),
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
  // A popular memo can accumulate more relations than D1 will bind at once.
  const result = new Map<string, typeof memos.$inferSelect>();
  for (const idChunk of chunkForD1(ids, d1IdsPerStatement())) {
    const rows = await db
      .select()
      .from(memos)
      .where(and(memoReadScope(user), inArray(memos.id, idChunk)));
    for (const memo of rows) result.set(memo.id, memo);
  }
  return result;
}

async function filterReadableRelations(
  db: FlareMoDb,
  user: UserRow | null,
  memoId: string,
  rows: Array<typeof memoRelations.$inferSelect>,
) {
  const relatedIds = [
    ...new Set(
      rows.map((row) =>
        row.memoId === memoId ? row.relatedMemoId : row.memoId,
      ),
    ),
  ];
  if (relatedIds.length === 0) return [];
  // Comments are relations, so a popular thread puts every comment id here.
  const readableIds = new Set<string>();
  for (const idChunk of chunkForD1(relatedIds, d1IdsPerStatement())) {
    const readable = await db
      .select({ id: memos.id })
      .from(memos)
      .where(and(memoReadScope(user), inArray(memos.id, idChunk)));
    for (const row of readable) readableIds.add(row.id);
  }
  return rows.filter((row) =>
    readableIds.has(row.memoId === memoId ? row.relatedMemoId : row.memoId),
  );
}
