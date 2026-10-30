import type { FlareMoDb, MemoPayload, MemoRow, UserRow } from "@flaremo/db";
import { memoRelations, memos, memoTags } from "@flaremo/db";
import { and, asc, count, desc, eq, gt, inArray, lt, or } from "drizzle-orm";
import { chunkForD1, d1IdsPerStatement } from "./d1-limits";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { createResourceId, parseResourceName } from "./ids";
import {
  assertMemoContentSize,
  getMemoById,
  getMemoByIdForViewer,
  normalizeMemoClientId,
  normalizeMemoPayload,
} from "./memos";
import {
  decodeSocialPageToken,
  encodeSocialPageToken,
  normalizePageSize,
} from "./memos-social-shared";
import { insertMemosSseEvent } from "./memos-sse";
import { findMentionedUsers, insertMemoNotification } from "./memos-user";
import { insertMemosWebhookEvent } from "./memos-webhooks";
import { assertMemoCountQuota, type QuotaScope } from "./quotas";
import { extractTags, normalizeMemoTags } from "./tags";
import { isActiveTeamMember, memoReadScope } from "./team-permissions";

export type CreateMemoCommentInput = {
  parentMemoName?: string;
  content?: string;
  comment?: {
    content: string;
    payload?: MemoPayload;
    source?: string;
  };
  payload?: MemoPayload;
  source?: string;
  commentId?: string;
  visibility?: "private" | "protected" | "public";
};

export type ListMemoCommentsInput = {
  memoName?: string;
  pageSize?: number;
  pageToken?: string;
  orderBy?: string;
};

export type MemoCommentsResult = {
  memos: MemoRow[];
  nextPageToken?: string;
  totalSize: number;
};

/**
 * Creates a Memos comment as an ordinary memo, then links it to its parent
 * with the existing COMMENT relation. The relation direction matches Memos:
 * `memo_id` is the comment and `related_memo_id` is the parent.
 */
export function createMemoComment(
  db: FlareMoDb,
  user: UserRow,
  parentMemoId: string,
  input: CreateMemoCommentInput,
  scope?: QuotaScope,
): Promise<MemoRow>;
export function createMemoComment(
  db: FlareMoDb,
  user: UserRow,
  input: CreateMemoCommentInput & { parentMemoName: string },
): Promise<{ memo: MemoRow; parentName: string }>;
export async function createMemoComment(
  db: FlareMoDb,
  user: UserRow,
  parentMemoOrInput:
    | string
    | (CreateMemoCommentInput & { parentMemoName: string }),
  input?: CreateMemoCommentInput,
  scope?: QuotaScope,
): Promise<MemoRow | { memo: MemoRow; parentName: string }> {
  const routeInput =
    typeof parentMemoOrInput === "string" ? undefined : parentMemoOrInput;
  const effectiveInput = input ?? routeInput;
  if (!effectiveInput) throw new ValidationError("Comment input is required");
  const parentMemoId =
    typeof parentMemoOrInput === "string"
      ? parentMemoOrInput
      : parentMemoOrInput.parentMemoName;
  const parentId = parseResourceName(parentMemoId, "memos");
  const parent = await getMemoById(db, user, parentId);
  const content = effectiveInput.comment?.content ?? effectiveInput.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new ValidationError("Comment content is required");
  }
  // Comments are memos: they pass the same three gates as createMemo —
  // active membership, content ceiling, and the per-user memo count quota.
  //
  // The quota gate needs the caller's resolved limits. It used to be called
  // with a literal `undefined` here, which `assertMemoCountQuota` reads as
  // "no limit configured" and returns immediately — so the third gate was
  // never actually applied to comments, and the note above described an intent
  // the code did not implement. Callers now pass the scope through.
  if (!isActiveTeamMember(user)) {
    throw new ForbiddenError("Removed members cannot create memos.");
  }
  assertMemoContentSize(content);
  await assertMemoCountQuota(db, scope?.userLimits, user.id);
  const payload = normalizeMemoPayload(
    effectiveInput.comment?.payload ?? effectiveInput.payload,
  );
  const rawTags = Array.isArray(payload.tags)
    ? payload.tags.filter((tag): tag is string => typeof tag === "string")
    : extractTags(content);
  const tags = normalizeMemoTags(rawTags);
  payload.tags = tags;
  const clientId = normalizeMemoClientId(payload.client_id);

  if (clientId) {
    const existing = await findMemoByClientId(db, user, clientId);
    if (existing) {
      await assertCommentRelation(db, existing.id, parentId);
      return routeInput ? { memo: existing, parentName: parentId } : existing;
    }
  }

  const commentId = effectiveInput.commentId
    ? parseResourceName(effectiveInput.commentId, "memos")
    : createResourceId("memos");
  const existingById = await db
    .select()
    .from(memos)
    .where(eq(memos.id, commentId))
    .get();
  if (existingById) {
    if (existingById.userId === user.id) {
      await assertCommentRelation(db, existingById.id, parentId);
      return routeInput
        ? { memo: existingById, parentName: parentId }
        : existingById;
    }
    throw new ConflictError("Memo id is already in use");
  }

  const now = new Date().toISOString();
  const row = {
    id: commentId,
    userId: user.id,
    content: content.trim(),
    // Memos comments inherit the visibility of the parent memo, and with it
    // the team: a protected row without a team id is readable by its author
    // only, which hid every team comment from the rest of the team.
    visibility: parent.visibility,
    teamId: parent.teamId,
    status: "normal" as const,
    pinned: false,
    source: effectiveInput.comment?.source ?? effectiveInput.source ?? "web",
    clientId: clientId ?? null,
    payload,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const relation = {
    memoId: commentId,
    relatedMemoId: parentId,
    type: "comment" as const,
    createdAt: now,
  };
  const eventStatement = insertMemosSseEvent(db, {
    type: "memo.comment.created",
    // The pinned Memos server broadcasts the parent memo so subscribers
    // refresh the comment collection attached to that resource.
    name: parentId,
    visibility: parent.visibility,
    teamId: parent.teamId,
    creatorId: parent.userId,
    createdAt: now,
  });
  const webhookEventStatement = insertMemosWebhookEvent(db, {
    receiverId: parent.userId,
    activityType: "memos.memo.comment.created",
    creator: user,
    memo: row,
    createdAt: now,
  });
  const notificationStatements = [];
  if (parent.visibility !== "private") {
    if (parent.userId !== user.id) {
      notificationStatements.push(
        insertMemoNotification(db, {
          receiverId: parent.userId,
          senderId: user.id,
          type: "memo_comment",
          sourceEventId: commentId,
          memoId: commentId,
          relatedMemoId: parentId,
          createdAt: now,
        }),
      );
    }
    const mentionedUsers = await findMentionedUsers(db, content, [user.id]);
    for (const mentionedUser of mentionedUsers) {
      // The parent owner already receives MEMO_COMMENT. Avoid a duplicate
      // inbox row when the comment also contains @owner.
      if (mentionedUser.id === parent.userId) continue;
      notificationStatements.push(
        insertMemoNotification(db, {
          receiverId: mentionedUser.id,
          senderId: user.id,
          type: "memo_mention",
          sourceEventId: commentId,
          memoId: commentId,
          relatedMemoId: parentId,
          createdAt: now,
        }),
      );
    }
  }

  // Comments stay out of the activity counter: they live under their parent
  // and are not records of their own in the stats, heatmap or streak. Every
  // later transition (trash, restore, hard delete) skips the counter for
  // comments too, and the nightly recalibration leaves them out, so nothing
  // is ever debited that was not credited.
  try {
    if (tags.length > 0) {
      await db.batch([
        db.insert(memos).values(row),
        db.insert(memoTags).values(
          tags.map((tag) => ({
            memoId: commentId,
            userId: user.id,
            tag,
            createdAt: now,
          })),
        ),
        db.insert(memoRelations).values(relation),
        eventStatement,
        webhookEventStatement,
        ...notificationStatements,
      ]);
    } else {
      await db.batch([
        db.insert(memos).values(row),
        db.insert(memoRelations).values(relation),
        eventStatement,
        webhookEventStatement,
        ...notificationStatements,
      ]);
    }
  } catch (error) {
    if (clientId) {
      const existing = await findMemoByClientId(db, user, clientId);
      if (existing) {
        await assertCommentRelation(db, existing.id, parentId);
        return routeInput ? { memo: existing, parentName: parentId } : existing;
      }
    }
    throw error;
  }

  const created = await getMemoById(db, user, commentId);
  return routeInput ? { memo: created, parentName: parentId } : created;
}

export async function getMemoParent(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
): Promise<string | undefined> {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  await getMemoById(db, user, normalizedMemoId, { includeDeleted: true });
  const relation = await db
    .select({ relatedMemoId: memoRelations.relatedMemoId })
    .from(memoRelations)
    .where(
      and(
        eq(memoRelations.memoId, normalizedMemoId),
        eq(memoRelations.type, "comment"),
      ),
    )
    .get();
  if (relation) {
    await getMemoById(db, user, relation.relatedMemoId, {
      includeDeleted: true,
    });
  }
  return relation?.relatedMemoId;
}

/**
 * Batched sibling of {@link getMemoParent} for comment pages: one probe that
 * the requested memos are readable, one relation read, one probe for the
 * parents. The single-id helper's error behavior is preserved — a requested
 * memo or a parent that is not readable throws instead of being silently
 * dropped — but the failure is raised once for the page rather than once per
 * comment.
 */
export async function getMemoParentsForViewer(
  db: FlareMoDb,
  user: UserRow,
  memoIds: string[],
): Promise<Map<string, string>> {
  const requested = [
    ...new Set(memoIds.map((id) => parseResourceName(id, "memos"))),
  ];
  if (requested.length === 0) return new Map();

  // Both reads below are fed by Connect `ListMemoComments`, whose page size
  // reaches 1000 — well past D1's per-statement binding cap.
  const readableIds = new Set<string>();
  for (const idChunk of chunkForD1(requested, d1IdsPerStatement())) {
    const readable = await db
      .select({ id: memos.id })
      .from(memos)
      .where(and(inArray(memos.id, idChunk), memoReadScope(user)));
    for (const row of readable) readableIds.add(row.id);
  }
  if (readableIds.size !== requested.length) {
    throw new NotFoundError("Memo not found");
  }

  const relationRows: Array<{
    memoId: string;
    relatedMemoId: string;
  }> = [];
  for (const idChunk of chunkForD1(requested, d1IdsPerStatement(2))) {
    relationRows.push(
      ...(await db
        .select({
          memoId: memoRelations.memoId,
          relatedMemoId: memoRelations.relatedMemoId,
        })
        .from(memoRelations)
        .where(
          and(
            inArray(memoRelations.memoId, idChunk),
            eq(memoRelations.type, "comment"),
          ),
        )),
    );
  }
  if (relationRows.length === 0) return new Map();

  const parentIds = [...new Set(relationRows.map((row) => row.relatedMemoId))];
  const readableParentIds = new Set<string>();
  for (const idChunk of chunkForD1(parentIds, d1IdsPerStatement())) {
    const readable = await db
      .select({ id: memos.id })
      .from(memos)
      .where(and(inArray(memos.id, idChunk), memoReadScope(user)));
    for (const row of readable) readableParentIds.add(row.id);
  }
  if (readableParentIds.size !== parentIds.length) {
    throw new NotFoundError("Memo not found");
  }

  return new Map(
    relationRows.map((row) => [row.memoId, row.relatedMemoId] as const),
  );
}

export function listMemoComments(
  db: FlareMoDb,
  user: UserRow | null,
  parentMemoId: string,
  input?: ListMemoCommentsInput,
): Promise<MemoCommentsResult>;
export function listMemoComments(
  db: FlareMoDb,
  user: UserRow | null,
  input: ListMemoCommentsInput & { memoName: string },
): Promise<MemoCommentsResult>;
export async function listMemoComments(
  db: FlareMoDb,
  user: UserRow | null,
  parentMemoOrInput: string | (ListMemoCommentsInput & { memoName: string }),
  input: ListMemoCommentsInput = {},
): Promise<MemoCommentsResult> {
  const effectiveInput =
    typeof parentMemoOrInput === "string" ? input : parentMemoOrInput;
  const parentMemoId =
    typeof parentMemoOrInput === "string"
      ? parentMemoOrInput
      : parentMemoOrInput.memoName;
  const parentId = parseResourceName(parentMemoId, "memos");
  await getMemoByIdForViewer(db, user, parentId);
  const order = normalizeCommentOrder(effectiveInput.orderBy);
  const pageSize = normalizePageSize(effectiveInput.pageSize);
  const cursor = effectiveInput.pageToken
    ? decodeSocialPageToken(
        effectiveInput.pageToken,
        "memo-comments",
        order,
        pageSize,
      )
    : undefined;
  const direction = order.endsWith(" asc") ? "asc" : "desc";
  const sortColumn = order.startsWith("name") ? memos.id : memos.createdAt;
  const baseFilters = [
    eq(memoRelations.relatedMemoId, parentId),
    eq(memoRelations.type, "comment"),
    // Comment rows inherit the parent memo's visibility; the row filter must
    // match the memo read boundary exactly (organization-aware), not a looser
    // visibility-only check.
    memoReadScope(user),
    ...(user
      ? [inArray(memos.status, ["normal", "archived"])]
      : [eq(memos.status, "normal")]),
  ];
  const filters = [...baseFilters];

  if (cursor) {
    const cursorFilter =
      direction === "asc"
        ? or(
            gt(sortColumn, cursor.sortValue),
            and(eq(sortColumn, cursor.sortValue), gt(memos.id, cursor.id)),
          )
        : or(
            lt(sortColumn, cursor.sortValue),
            and(eq(sortColumn, cursor.sortValue), lt(memos.id, cursor.id)),
          );
    if (cursorFilter) filters.push(cursorFilter);
  }

  const [rows, total] = await Promise.all([
    db
      .select({ memo: memos })
      .from(memoRelations)
      .innerJoin(memos, eq(memos.id, memoRelations.memoId))
      .where(and(...filters))
      .orderBy(
        direction === "asc" ? asc(sortColumn) : desc(sortColumn),
        direction === "asc" ? asc(memos.id) : desc(memos.id),
      )
      .limit(pageSize + 1),
    db
      .select({ count: count(memos.id) })
      .from(memoRelations)
      .innerJoin(memos, eq(memos.id, memoRelations.memoId))
      .where(and(...baseFilters))
      .get(),
  ]);
  const page = rows.slice(0, pageSize).map((row) => row.memo);
  const next = rows.length > pageSize ? page.at(-1) : undefined;

  return {
    memos: page,
    totalSize: Number(total?.count ?? 0),
    nextPageToken: next
      ? encodeSocialPageToken({
          kind: "memo-comments",
          id: next.id,
          sortValue: order.startsWith("name") ? next.id : next.createdAt,
          order,
          pageSize,
        })
      : undefined,
  };
}

async function findMemoByClientId(
  db: FlareMoDb,
  user: UserRow,
  clientId: string,
) {
  return db
    .select()
    .from(memos)
    .where(and(eq(memos.userId, user.id), eq(memos.clientId, clientId)))
    .get();
}

async function assertCommentRelation(
  db: FlareMoDb,
  commentId: string,
  parentId: string,
) {
  const relation = await db
    .select()
    .from(memoRelations)
    .where(
      and(
        eq(memoRelations.memoId, commentId),
        eq(memoRelations.relatedMemoId, parentId),
        eq(memoRelations.type, "comment"),
      ),
    )
    .get();
  if (!relation) {
    throw new ConflictError("Memo is already used by another comment");
  }
}

function normalizeCommentOrder(value: string | undefined) {
  const normalized = value?.trim() || "create_time desc";
  const [field = "create_time", direction = "desc"] = normalized
    .split(/\s+/)
    .map((part) => part.toLowerCase());
  if (
    !["create_time", "name"].includes(field) ||
    !["asc", "desc"].includes(direction)
  ) {
    throw new ValidationError("Unsupported comment order_by");
  }
  return `${field} ${direction}`;
}

/**
 * Live comment counts for a page of parent memos, keyed by parent id
 * (`memos/<id>`). Only comments the viewer can read are counted, with the
 * same boundary as {@link listMemoComments}, so the number on a card always
 * matches the list the detail page shows. Parents without comments are
 * absent from the map.
 */
export async function countMemoComments(
  db: FlareMoDb,
  user: UserRow,
  parentIds: string[],
): Promise<Map<string, number>> {
  const ids = [
    ...new Set(parentIds.map((id) => parseResourceName(id, "memos"))),
  ];
  const counts = new Map<string, number>();
  for (const idChunk of chunkForD1(ids, d1IdsPerStatement(4))) {
    const rows = await db
      .select({
        parentId: memoRelations.relatedMemoId,
        total: count(memos.id),
      })
      .from(memoRelations)
      .innerJoin(memos, eq(memos.id, memoRelations.memoId))
      .where(
        and(
          inArray(memoRelations.relatedMemoId, idChunk),
          eq(memoRelations.type, "comment"),
          inArray(memos.status, ["normal", "archived"]),
          memoReadScope(user),
        ),
      )
      .groupBy(memoRelations.relatedMemoId);
    for (const row of rows) counts.set(row.parentId, row.total);
  }
  return counts;
}
