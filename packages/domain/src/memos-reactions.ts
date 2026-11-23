import type { FlareMoDb, ReactionRow, UserRow } from "@flaremo/db";
import { memos, reactions } from "@flaremo/db";
import { and, asc, count, eq, gt, inArray, or } from "drizzle-orm";
import { chunkForD1, d1IdsPerStatement } from "./d1-limits";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { parseResourceName } from "./ids";
import { getMemoById, getMemoByIdForViewer } from "./memos";
import {
  createSocialResourceId,
  decodeSocialPageToken,
  encodeSocialPageToken,
  normalizePageSize,
} from "./memos-social-shared";
import { insertMemosSseEvent } from "./memos-sse";
import { memoReadScope } from "./team-permissions";

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

export type DeleteMemoReactionInput = {
  name: string;
  memoName?: string;
  reactionId?: string;
};

export type SocialReactionRow = ReactionRow & { name: string };

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
  if (memo.status !== "normal") {
    throw new ValidationError("Reactions are only allowed on active memos");
  }
  const reactionType = effectiveInput.reactionType.trim();
  if (!reactionType || reactionType.length > 128) {
    throw new ValidationError("Reaction type is required");
  }

  const now = new Date().toISOString();
  // Emit the SSE event only when the upsert actually created or changed a
  // reaction — a repeat of the same reaction is a no-op and must not flood
  // subscribers with identical events.
  const existing = await db
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
  const upsertStatement = db
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
    });
  if (existing) {
    await db.batch([upsertStatement]);
  } else {
    await db.batch([
      upsertStatement,
      insertMemosSseEvent(db, {
        type: "reaction.upserted",
        name: contentId,
        visibility: memo.visibility,
        teamId: memo.teamId,
        creatorId: memo.userId,
        createdAt: now,
      }),
    ]);
  }

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

/**
 * Batch variant of listMemoReactions for list rendering: one query over the
 * whole memo set, scoped through memoReadScope so a viewer only ever sees
 * reactions on memos they can read. Rows are unpaginated; callers group them
 * by contentId.
 */
export async function listReactionsForMemosForViewer(
  db: FlareMoDb,
  user: UserRow | null,
  memoIds: string[],
) {
  if (memoIds.length === 0) return [];
  // Same 100-parameter ceiling as the attachment hydration: one binding per
  // requested memo id inside the readability subquery.
  const rows: Array<typeof reactions.$inferSelect> = [];
  for (const idChunk of chunkForD1(memoIds, d1IdsPerStatement(12))) {
    const allowedMemoIds = db
      .select({ id: memos.id })
      .from(memos)
      .where(and(memoReadScope(user), inArray(memos.id, idChunk)));
    rows.push(
      ...(await db
        .select()
        .from(reactions)
        .where(inArray(reactions.contentId, allowedMemoIds))
        .orderBy(asc(reactions.createdAt), asc(reactions.id))),
    );
  }
  rows.sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  return rows;
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
  // The deleter is the reaction's own creator; requiring memo read access
  // here would strand the reaction row when the author later privatizes or
  // deletes the memo. The memo row is only needed for the event metadata.
  const memo = await db.query.memos.findFirst({
    where: eq(memos.id, row.contentId),
  });
  if (!memo) {
    await db
      .delete(reactions)
      .where(and(eq(reactions.id, row.id), eq(reactions.creatorId, user.id)));
    return;
  }
  await db.batch([
    db
      .delete(reactions)
      .where(and(eq(reactions.id, row.id), eq(reactions.creatorId, user.id))),
    insertMemosSseEvent(db, {
      type: "reaction.deleted",
      name: row.contentId,
      visibility: memo.visibility,
      teamId: memo.teamId,
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
