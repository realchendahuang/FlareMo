import type { FlareMoDb, UserRow } from "@flaremo/db";
import {
  attachments,
  memoRelations,
  memoRevisions,
  memos,
  shares,
} from "@flaremo/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { chunkForD1, d1IdsPerStatement } from "./d1-limits";
import { parseResourceName } from "./ids";
import { getMemoById } from "./memos";
import {
  canEditMemo,
  canGovernMemo,
  isTeamAdmin,
  memoReadScope,
} from "./team-permissions";

export async function getMemoContextData(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
) {
  const id = parseResourceName(memoId, "memos");
  const memo = await getMemoById(db, user, id, { includeDeleted: true });
  const canManage = canEditMemo(user, memo);
  const canGovern = canGovernMemo(user, memo);

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
        )
        // Match the list endpoints' ordering so the reading view picks the
        // same main track everywhere.
        .orderBy(desc(attachments.createdAt)),
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

  const uniqueRelatedIds = [
    ...new Set([
      ...relations.map((relation) => relation.relatedMemoId),
      ...backlinks.map((relation) => relation.memoId),
    ]),
  ];
  const relatedMemos: (typeof memos.$inferSelect)[] = [];
  // memoReadScope binds up to ~6 viewer/team parameters; reserve 12 so hub
  // memos with >100 relations + backlinks stay safely under D1's 100-param cap.
  for (const chunk of chunkForD1(uniqueRelatedIds, d1IdsPerStatement(12))) {
    const rows = await db
      .select()
      .from(memos)
      .where(and(memoReadScope(user), inArray(memos.id, chunk)));
    relatedMemos.push(...rows);
  }
  const memoById = new Map(relatedMemos.map((item) => [item.id, item]));
  const now = Date.now();
  const revisions =
    memo.userId === user.id
      ? revisionRows
      : isTeamAdmin(user)
        ? revisionRows.filter((revision) => revision.visibility !== "private")
        : [];

  return {
    memo,
    canManage,
    canGovern,
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
  };
}
