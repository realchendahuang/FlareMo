import type { FlareMoDb, UserRow } from "@flaremo/db";
import {
  attachments,
  memoRelations,
  memoRevisions,
  memos,
  shares,
} from "@flaremo/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { NotFoundError } from "./errors";
import { parseResourceName } from "./ids";

export async function getMemoContextData(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
) {
  const id = parseResourceName(memoId, "memos");
  const [memoRows, attachmentRows, shareRows, relations, backlinks, revisions] =
    await db.batch([
      db
        .select()
        .from(memos)
        .where(and(eq(memos.id, id), eq(memos.userId, user.id)))
        .limit(1),
      db
        .select()
        .from(attachments)
        .where(
          and(
            eq(attachments.memoId, id),
            eq(attachments.userId, user.id),
            isNull(attachments.deletedAt),
            eq(attachments.state, "ready"),
          ),
        ),
      db
        .select()
        .from(shares)
        .where(
          and(
            eq(shares.memoId, id),
            eq(shares.userId, user.id),
            isNull(shares.revokedAt),
          ),
        ),
      db.select().from(memoRelations).where(eq(memoRelations.memoId, id)),
      db
        .select()
        .from(memoRelations)
        .where(eq(memoRelations.relatedMemoId, id)),
      db
        .select()
        .from(memoRevisions)
        .where(
          and(eq(memoRevisions.memoId, id), eq(memoRevisions.userId, user.id)),
        ),
    ]);
  const memo = memoRows[0];
  if (!memo) throw new NotFoundError("Memo not found");

  const relatedMemoIds = [
    ...relations.map((relation) => relation.relatedMemoId),
    ...backlinks.map((relation) => relation.memoId),
  ];
  const relatedMemos =
    relatedMemoIds.length > 0
      ? await db
          .select()
          .from(memos)
          .where(
            and(
              eq(memos.userId, user.id),
              inArray(memos.id, [...new Set(relatedMemoIds)]),
            ),
          )
      : [];
  const memoById = new Map(relatedMemos.map((item) => [item.id, item]));
  const now = Date.now();

  return {
    memo,
    attachments: attachmentRows,
    shares: shareRows.filter(
      (share) => !share.expiresAt || new Date(share.expiresAt).getTime() > now,
    ),
    relations: relations.flatMap((relation) => {
      const relatedMemo = memoById.get(relation.relatedMemoId);
      return relatedMemo ? [{ relation, memo: relatedMemo }] : [];
    }),
    backlinks: backlinks.flatMap((relation) => {
      const relatedMemo = memoById.get(relation.memoId);
      return relatedMemo ? [{ relation, memo: relatedMemo }] : [];
    }),
    revisions: [...revisions].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
  };
}
