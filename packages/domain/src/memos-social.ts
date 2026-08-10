import type {
  FlareMoDb,
  MemoPayload,
  MemoRow,
  ReactionRow,
  ShortcutRow,
  UserRow,
} from "@flaremo/db";
import {
  memoRelations,
  memos,
  memoTags,
  reactions,
  shortcuts,
} from "@flaremo/db";
import { and, asc, count, desc, eq, gt, inArray, lt, or } from "drizzle-orm";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { createResourceId, parseResourceName } from "./ids";
import { compileMemoFilter } from "./memo-filter";
import {
  getMemoById,
  getMemoByIdForViewer,
  normalizeMemoClientId,
  normalizeMemoPayload,
} from "./memos";
import { insertMemosSseEvent } from "./memos-sse";
import { findMentionedUsers, insertMemoNotification } from "./memos-user";
import { insertMemosWebhookEvent } from "./memos-webhooks";
import { extractTags, normalizeMemoTags } from "./tags";

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

export type UpsertMemoReactionInput = {
  memoName?: string;
  reactionType: string;
  contentId?: string;
};

export type ListMemoReactionsInput = {
  memoName?: string;
  pageSize?: number;
  pageToken?: string;
};

export type MemoReactionsResult = {
  reactions: SocialReactionRow[];
  nextPageToken?: string;
  totalSize: number;
};

export type CreateShortcutInput = {
  parentName?: string;
  title?: string;
  filter?: string;
  parent?: string;
  shortcut?: { title: string; filter?: string };
  validateOnly?: boolean;
};

export type UpdateShortcutInput = {
  name?: string;
  title?: string;
  filter?: string;
  updateMask?: string | string[];
  shortcut?: { name?: string; title?: string; filter?: string };
};

export type DeleteMemoReactionInput = {
  name: string;
  memoName?: string;
  reactionId?: string;
};

export type SocialReactionRow = ReactionRow & { name: string };
export type SocialShortcutRow = ShortcutRow & { name: string };

type SocialPageCursor = {
  kind: "memo-comments" | "memo-reactions";
  id: string;
  sortValue: string;
  order: string;
  pageSize: number;
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
    // Memos comments inherit the visibility of the parent memo.
    visibility: parent.visibility,
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
  return relation?.relatedMemoId;
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
    ...(user
      ? [
          or(
            eq(memos.userId, user.id),
            eq(memos.visibility, "public"),
            eq(memos.visibility, "protected"),
          ),
        ]
      : [eq(memos.visibility, "public")]),
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

export function upsertMemoReaction(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
  input: UpsertMemoReactionInput,
): Promise<SocialReactionRow>;
export function upsertMemoReaction(
  db: FlareMoDb,
  user: UserRow,
  input: UpsertMemoReactionInput & { memoName: string },
): Promise<SocialReactionRow>;
export async function upsertMemoReaction(
  db: FlareMoDb,
  user: UserRow,
  memoOrInput: string | (UpsertMemoReactionInput & { memoName: string }),
  input?: UpsertMemoReactionInput,
): Promise<SocialReactionRow> {
  const effectiveInput = typeof memoOrInput === "string" ? input : memoOrInput;
  if (!effectiveInput) throw new ValidationError("Reaction input is required");
  const memoId =
    typeof memoOrInput === "string" ? memoOrInput : memoOrInput.memoName;
  const contentId = parseResourceName(
    effectiveInput.contentId ?? memoId,
    "memos",
  );
  if (contentId !== parseResourceName(memoId, "memos")) {
    throw new ValidationError("Reaction contentId must match the memo name");
  }
  const memo = await getMemoById(db, user, contentId);
  const reactionType = effectiveInput.reactionType.trim();
  if (!reactionType || reactionType.length > 128) {
    throw new ValidationError("Reaction type is required");
  }

  const now = new Date().toISOString();
  await db.batch([
    db
      .insert(reactions)
      .values({
        id: createSocialResourceId("reactions"),
        creatorId: user.id,
        contentId,
        reactionType,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [
          reactions.creatorId,
          reactions.contentId,
          reactions.reactionType,
        ],
        set: { reactionType },
      }),
    insertMemosSseEvent(db, {
      type: "reaction.upserted",
      name: contentId,
      visibility: memo.visibility,
      creatorId: memo.userId,
      createdAt: now,
    }),
  ]);

  const row = await db
    .select()
    .from(reactions)
    .where(
      and(
        eq(reactions.creatorId, user.id),
        eq(reactions.contentId, contentId),
        eq(reactions.reactionType, reactionType),
      ),
    )
    .get();
  if (!row) throw new NotFoundError("Reaction not found after upsert");
  return namedReaction(row);
}

export function listMemoReactions(
  db: FlareMoDb,
  user: UserRow | null,
  memoId: string,
  input?: ListMemoReactionsInput,
): Promise<MemoReactionsResult>;
export function listMemoReactions(
  db: FlareMoDb,
  user: UserRow | null,
  input: ListMemoReactionsInput & { memoName: string },
): Promise<MemoReactionsResult>;
export async function listMemoReactions(
  db: FlareMoDb,
  user: UserRow | null,
  memoOrInput: string | (ListMemoReactionsInput & { memoName: string }),
  input: ListMemoReactionsInput = {},
): Promise<MemoReactionsResult> {
  const effectiveInput = typeof memoOrInput === "string" ? input : memoOrInput;
  const memoId =
    typeof memoOrInput === "string" ? memoOrInput : memoOrInput.memoName;
  const contentId = parseResourceName(memoId, "memos");
  await getMemoByIdForViewer(db, user, contentId);
  const pageSize = normalizePageSize(effectiveInput.pageSize);
  const order = "create_time asc";
  const cursor = effectiveInput.pageToken
    ? decodeSocialPageToken(
        effectiveInput.pageToken,
        "memo-reactions",
        order,
        pageSize,
      )
    : undefined;
  const filters = [eq(reactions.contentId, contentId)];
  if (cursor) {
    const cursorFilter = or(
      gt(reactions.createdAt, cursor.sortValue),
      and(
        eq(reactions.createdAt, cursor.sortValue),
        gt(reactions.id, cursor.id),
      ),
    );
    if (cursorFilter) filters.push(cursorFilter);
  }

  const [rows, total] = await Promise.all([
    db
      .select()
      .from(reactions)
      .where(and(...filters))
      .orderBy(asc(reactions.createdAt), asc(reactions.id))
      .limit(pageSize + 1),
    db
      .select({ count: count(reactions.id) })
      .from(reactions)
      .where(eq(reactions.contentId, contentId))
      .get(),
  ]);
  const page = rows.slice(0, pageSize);
  const next = rows.length > pageSize ? page.at(-1) : undefined;
  return {
    reactions: page.map(namedReaction),
    totalSize: Number(total?.count ?? 0),
    nextPageToken: next
      ? encodeSocialPageToken({
          kind: "memo-reactions",
          id: next.id,
          sortValue: next.createdAt,
          order,
          pageSize,
        })
      : undefined,
  };
}

export function deleteMemoReaction(
  db: FlareMoDb,
  user: UserRow,
  reactionName: string,
): Promise<void>;
export function deleteMemoReaction(
  db: FlareMoDb,
  user: UserRow,
  input: DeleteMemoReactionInput,
): Promise<void>;
export async function deleteMemoReaction(
  db: FlareMoDb,
  user: UserRow,
  reactionNameOrInput: string | DeleteMemoReactionInput,
): Promise<void> {
  const input =
    typeof reactionNameOrInput === "string"
      ? { name: reactionNameOrInput }
      : reactionNameOrInput;
  const parsed = parseReactionResourceName(input.name);
  if (input.memoName && parsed.contentId) {
    if (parsed.contentId !== parseResourceName(input.memoName, "memos")) {
      throw new NotFoundError("Reaction not found");
    }
  }
  const row = await db
    .select()
    .from(reactions)
    .where(eq(reactions.id, parsed.id))
    .get();
  if (!row) throw new NotFoundError("Reaction not found");
  if (row.creatorId !== user.id) throw new ForbiddenError("Permission denied");
  if (parsed.contentId && parsed.contentId !== row.contentId) {
    throw new NotFoundError("Reaction not found");
  }
  const memo = await getMemoById(db, user, row.contentId, {
    includeDeleted: true,
  });
  await db.batch([
    db
      .delete(reactions)
      .where(and(eq(reactions.id, row.id), eq(reactions.creatorId, user.id))),
    insertMemosSseEvent(db, {
      type: "reaction.deleted",
      name: row.contentId,
      visibility: memo.visibility,
      creatorId: memo.userId,
      createdAt: new Date().toISOString(),
    }),
  ]);
}

export function memoReactionName(reaction: ReactionRow) {
  const reactionId = reaction.id.replace(/^reactions\//, "");
  return `${reaction.contentId}/reactions/${reactionId}`;
}

function namedReaction(reaction: ReactionRow): SocialReactionRow {
  return { ...reaction, name: memoReactionName(reaction) };
}

export function listShortcuts(
  db: FlareMoDb,
  user: UserRow,
  parent: string,
): Promise<SocialShortcutRow[]>;
export function listShortcuts(
  db: FlareMoDb,
  user: UserRow,
  input: { parentName: string },
): Promise<SocialShortcutRow[]>;
export async function listShortcuts(
  db: FlareMoDb,
  user: UserRow,
  parentOrInput: string | { parentName: string } = user.id,
): Promise<SocialShortcutRow[]> {
  const parent =
    typeof parentOrInput === "string"
      ? parentOrInput
      : parentOrInput.parentName;
  assertUserResourceName(parent, user);
  const rows = await db
    .select()
    .from(shortcuts)
    .where(eq(shortcuts.userId, user.id))
    .orderBy(asc(shortcuts.createdAt), asc(shortcuts.id));
  return rows.map(withShortcutResourceName);
}

export function getShortcut(
  db: FlareMoDb,
  user: UserRow,
  name: string,
): Promise<SocialShortcutRow>;
export function getShortcut(
  db: FlareMoDb,
  user: UserRow,
  input: { name: string },
): Promise<SocialShortcutRow>;
export async function getShortcut(
  db: FlareMoDb,
  user: UserRow,
  nameOrInput: string | { name: string },
): Promise<SocialShortcutRow> {
  const name = typeof nameOrInput === "string" ? nameOrInput : nameOrInput.name;
  const id = parseShortcutResourceName(name, user);
  const row = await db
    .select()
    .from(shortcuts)
    .where(and(eq(shortcuts.id, id), eq(shortcuts.userId, user.id)))
    .get();
  if (!row) throw new NotFoundError("Shortcut not found");
  return withShortcutResourceName(row);
}

export async function createShortcut(
  db: FlareMoDb,
  user: UserRow,
  input: CreateShortcutInput,
): Promise<SocialShortcutRow> {
  if (input.parentName) assertUserResourceName(input.parentName, user);
  if (input.parent) assertUserResourceName(input.parent, user);
  const title = (input.shortcut?.title ?? input.title ?? "").trim();
  const filter = (input.shortcut?.filter ?? input.filter ?? "").trim();
  validateShortcut(title, filter);
  const now = new Date().toISOString();
  const row = {
    id: createSocialResourceId("shortcuts"),
    userId: user.id,
    title,
    filter,
    createdAt: now,
    updatedAt: now,
  };
  if (input.validateOnly) return withShortcutResourceName(row);
  await db.insert(shortcuts).values(row);
  return getShortcut(db, user, row.id);
}

export function updateShortcut(
  db: FlareMoDb,
  user: UserRow,
  input: UpdateShortcutInput,
): Promise<SocialShortcutRow>;
export function updateShortcut(
  db: FlareMoDb,
  user: UserRow,
  name: string,
  input: UpdateShortcutInput,
): Promise<SocialShortcutRow>;
export async function updateShortcut(
  db: FlareMoDb,
  user: UserRow,
  nameOrInput: string | UpdateShortcutInput,
  input?: UpdateShortcutInput,
): Promise<SocialShortcutRow> {
  const effectiveInput =
    typeof nameOrInput === "string" ? (input ?? {}) : nameOrInput;
  const name =
    typeof nameOrInput === "string"
      ? nameOrInput
      : (effectiveInput.shortcut?.name ?? effectiveInput.name ?? "");
  const resourceName =
    effectiveInput.shortcut?.name ?? effectiveInput.name ?? name;
  const existing = await getShortcut(db, user, resourceName);
  const updateMask = normalizeUpdateMask(effectiveInput.updateMask);
  const updatesTitle = !updateMask || updateMask.includes("title");
  const updatesFilter = !updateMask || updateMask.includes("filter");
  const title = updatesTitle
    ? (
        effectiveInput.shortcut?.title ??
        effectiveInput.title ??
        existing.title
      ).trim()
    : existing.title;
  const filter = updatesFilter
    ? (
        effectiveInput.shortcut?.filter ??
        effectiveInput.filter ??
        existing.filter
      ).trim()
    : existing.filter;
  validateShortcut(title, filter);
  const now = new Date().toISOString();
  await db
    .update(shortcuts)
    .set({ title, filter, updatedAt: now })
    .where(and(eq(shortcuts.id, existing.id), eq(shortcuts.userId, user.id)));
  return getShortcut(db, user, existing.id);
}

export function deleteShortcut(
  db: FlareMoDb,
  user: UserRow,
  input: { name: string },
): Promise<void>;
export function deleteShortcut(
  db: FlareMoDb,
  user: UserRow,
  name: string,
): Promise<void>;
export async function deleteShortcut(
  db: FlareMoDb,
  user: UserRow,
  nameOrInput: string | { name: string },
): Promise<void> {
  const name = typeof nameOrInput === "string" ? nameOrInput : nameOrInput.name;
  const existing = await getShortcut(db, user, name);
  await db
    .delete(shortcuts)
    .where(and(eq(shortcuts.id, existing.id), eq(shortcuts.userId, user.id)));
}

function withShortcutResourceName(row: ShortcutRow): SocialShortcutRow {
  const shortcutId = row.id.replace(/^shortcuts\//, "");
  return { ...row, name: `${row.userId}/shortcuts/${shortcutId}` };
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

function normalizePageSize(value: number | undefined) {
  if (value === undefined) return 50;
  if (!Number.isInteger(value) || value < 1) {
    throw new ValidationError("Page size must be a positive integer");
  }
  return Math.min(value, 1000);
}

function encodeSocialPageToken(cursor: SocialPageCursor) {
  return btoa(JSON.stringify(cursor));
}

function decodeSocialPageToken(
  token: string,
  kind: SocialPageCursor["kind"],
  order: string,
  pageSize: number,
) {
  try {
    const cursor = JSON.parse(atob(token)) as Partial<SocialPageCursor>;
    if (
      cursor.kind === kind &&
      typeof cursor.id === "string" &&
      typeof cursor.sortValue === "string" &&
      cursor.order === order &&
      cursor.pageSize === pageSize
    ) {
      return cursor as SocialPageCursor;
    }
  } catch {
    // Fall through to one stable validation error.
  }
  throw new ValidationError("Invalid page token");
}

function createSocialResourceId(prefix: "reactions" | "shortcuts") {
  return `${prefix}/${crypto.randomUUID()}`;
}

function parseReactionResourceName(name: string) {
  const parts = name.split("/").filter(Boolean);
  const marker = parts.lastIndexOf("reactions");
  if (marker < 0 || !parts[marker + 1]) {
    throw new ValidationError("Invalid reaction name");
  }
  const reactionId = parts[marker + 1] as string;
  const contentId = parts.slice(0, marker).join("/");
  return {
    id: reactionId.startsWith("reactions/")
      ? reactionId
      : `reactions/${reactionId}`,
    contentId: contentId || undefined,
  };
}

function assertUserResourceName(name: string, user: UserRow) {
  const normalized = normalizeUserResourceName(name);
  if (normalized !== user.id) {
    throw new ForbiddenError("Only the current user is available");
  }
}

function normalizeUserResourceName(name: string) {
  if (name.startsWith("users/")) return name;
  return `users/${name}`;
}

function parseShortcutResourceName(name: string, user: UserRow) {
  const parts = name.split("/").filter(Boolean);
  if (parts.length === 4 && parts[0] === "users" && parts[2] === "shortcuts") {
    assertUserResourceName(`users/${parts[1]}`, user);
    if (!parts[3]) throw new ValidationError("Invalid shortcut name");
    return `shortcuts/${parts[3]}`;
  }
  if (name.startsWith("shortcuts/") && name.split("/").length === 2) {
    return name;
  }
  throw new ValidationError("Invalid shortcut name");
}

function normalizeUpdateMask(mask: string | string[] | undefined) {
  if (mask === undefined) return undefined;
  const values = Array.isArray(mask) ? mask : mask.split(",");
  const normalized = values
    .map((value) => value.trim())
    .filter(
      (value): value is "title" | "filter" =>
        value === "title" || value === "filter",
    );
  if (normalized.length !== values.filter((value) => value.trim()).length) {
    throw new ValidationError("Unsupported shortcut update mask");
  }
  return normalized;
}

function validateShortcut(title: string, filter: string) {
  if (!title) throw new ValidationError("Shortcut title is required");
  if (title.length > 256)
    throw new ValidationError("Shortcut title is too long");
  if (!filter) throw new ValidationError("Shortcut filter is required");
  if (filter.length > 4_096)
    throw new ValidationError("Shortcut filter is too long");
  if (filter) compileMemoFilter(filter);
}
