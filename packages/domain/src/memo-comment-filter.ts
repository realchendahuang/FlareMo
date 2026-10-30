import type { FlareMoDb } from "@flaremo/db";
import { memoRelations, memos } from "@flaremo/db";
import { and, eq, type SQL, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

/**
 * True for memos that are not comments. A comment is a memo row linked to
 * its parent by a `comment` relation; it belongs under that parent, so the
 * timeline, search, stats, tag counts, calendar and review all leave it out
 * (upstream Memos does the same for its lists). Uses the relation primary
 * key, which starts with `memo_id`.
 */
export function notComment(memoId: SQLiteColumn | SQL = memos.id): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM ${memoRelations} WHERE ${memoRelations.memoId} = ${memoId} AND ${memoRelations.type} = 'comment')`;
}

/** Raw-SQL form for hand-written statements that alias `memos` as `m`. */
export const NOT_COMMENT_SQL_FOR = (alias: string) =>
  `NOT EXISTS (SELECT 1 FROM memo_relations mr WHERE mr.memo_id = ${alias}.id AND mr.type = 'comment')`;

/** Whether a memo row is a comment (it has a `comment` relation upward). */
export async function isCommentMemo(db: FlareMoDb, memoId: string) {
  const row = await db
    .select({ memoId: memoRelations.memoId })
    .from(memoRelations)
    .where(
      and(eq(memoRelations.memoId, memoId), eq(memoRelations.type, "comment")),
    )
    .get();
  return Boolean(row);
}
