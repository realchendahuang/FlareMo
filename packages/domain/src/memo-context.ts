import type { FlareMoDb, UserRow } from "@flaremo/db";
import {
  attachments,
  memoRelations,
  memoRevisions,
  memos,
  shares,
} from "@flaremo/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { parseResourceName } from "./ids";
import { listMemoriesForMemo } from "./memory";
import { getMemoById } from "./memos";
import { canEditMemo, isTeamAdmin, memoReadScope } from "./team-permissions";

export async function getMemoContextData(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
) {
  const id = parseResourceName(memoId, "memos");
  const memo = await getMemoById(db, user, id, { includeDeleted: true });
  const canManage = canEditMemo(user, memo);

  const [attachmentRows, shareRows, relations, backlinks, revisionRows] =
    await db.batch([
      db
        .select()
        .from(attachments)
        .where(
          and(
            eq(attachments.memoId, id),
            isNull(attachments.deletedAt),
            eq(attachments.state, "ready"),
          ),
        ),
      db
        .select()
        .from(shares)
        .where(and(eq(shares.memoId, id), isNull(shares.revokedAt))),
      db.select().from(memoRelations).where(eq(memoRelations.memoId, id)),
      db
        .select()
        .from(memoRelations)
        .where(eq(memoRelations.relatedMemoId, id)),
      db.select().from(memoRevisions).where(eq(memoRevisions.memoId, id)),
    ]);

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
              memoReadScope(user),
              inArray(memos.id, [...new Set(relatedMemoIds)]),
            ),
          )
      : [];
  const memoById = new Map(relatedMemos.map((item) => [item.id, item]));
  const now = Date.now();
  const memories = await listMemoriesForMemo(db, user, id);
  const revisions =
    memo.userId === user.id
      ? revisionRows
      : isTeamAdmin(user)
        ? revisionRows.filter((revision) => revision.visibility !== "private")
        : [];

  return {
    memo,
    canManage,
    attachments: attachmentRows,
    shares: canManage
      ? shareRows.filter(
          (share) =>
            !share.expiresAt || new Date(share.expiresAt).getTime() > now,
        )
      : [],
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
    memories,
  };
}
