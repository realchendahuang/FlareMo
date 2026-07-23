import {
  type CreateMemoInput,
  type ListMemosQuery,
  type MemoOrderBy,
  type MemoStatsQuery,
  type MemoStatsResponse,
  parseMemoSearchQuery,
  type UpdateMemoInput,
} from "@flaremo/contracts";
import type { FlareMoDb, MemoPayload, MemoRow, UserRow } from "@flaremo/db";
import { attachments, memoRevisions, memos, memoTags } from "@flaremo/db";
import { and, asc, desc, eq, gt, gte, inArray, lt, or, sql } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { createResourceId } from "./ids";

export type MemoListResult = {
  memos: MemoRow[];
  nextPageToken?: string;
};

type MemoCursor = {
  id: string;
  orderBy: MemoOrderBy;
  pinned: boolean;
  sortValue: string;
};

export async function createMemo(
  db: FlareMoDb,
  user: UserRow,
  input: CreateMemoInput,
): Promise<MemoRow> {
  const now = new Date().toISOString();
  const payload = normalizeMemoPayload(input.payload);
  const clientId = normalizeMemoClientId(payload.client_id);
  if (clientId) {
    payload.client_id = clientId;
    const existing = await getMemoByClientId(db, user, clientId);
    if (existing) return existing;
  }
  const tags = normalizeMemoTags(payload.tags ?? extractTags(input.content));
  payload.tags = tags;
  const row = {
    id: createResourceId("memos"),
    userId: user.id,
    content: input.content,
    visibility: input.visibility,
    status: "normal" as const,
    pinned: false,
    source: input.source,
    clientId,
    payload,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  const insertMemo = db.insert(memos).values(row);
  try {
    if (tags.length > 0) {
      await db.batch([
        insertMemo,
        db.insert(memoTags).values(
          tags.map((tag) => ({
            memoId: row.id,
            userId: user.id,
            tag,
            createdAt: now,
          })),
        ),
      ]);
    } else {
      await insertMemo;
    }
  } catch (error) {
    // A second tab can submit the same queued entry at the same time. The
    // unique `(user_id, client_id)` index is the final idempotency boundary.
    if (clientId) {
      const existing = await getMemoByClientId(db, user, clientId);
      if (existing) return existing;
    }
    throw error;
  }
  return getMemoById(db, user, row.id, { includeDeleted: true });
}

export async function listMemos(
  db: FlareMoDb,
  user: UserRow,
  query: ListMemosQuery,
): Promise<MemoListResult> {
  const search = parseMemoSearchQuery(query.q);
  const cursor = query.page_token
    ? decodePageToken(query.page_token, query.order_by)
    : undefined;
  const direction = query.order_by.endsWith(" asc") ? "asc" : "desc";
  const orderColumn = query.order_by.startsWith("updated_at")
    ? memos.updatedAt
    : memos.createdAt;
  const filters = [eq(memos.userId, user.id)];

  // The established `state` query parameter wins over a search scope so that
  // Memos-compatible clients retain their existing filtering semantics.
  const searchState = query.state ?? memoSearchScopeToState(search.scope);
  if (searchState) {
    filters.push(eq(memos.status, searchState));
  } else if (query.q?.trim() && !query.include_deleted) {
    // Full-text search is intentionally broader than the timeline: archived
    // notes stay discoverable, while trashed notes remain opt-in via in:trash.
    filters.push(inArray(memos.status, ["normal", "archived"]));
  } else if (!query.include_deleted) {
    filters.push(eq(memos.status, "normal"));
  }

  if (search.text) {
    const ftsQuery = buildFtsQuery(search.text);
    filters.push(
      ftsQuery
        ? sql`${memos.id} IN (
            SELECT memo_id FROM memos_fts WHERE memos_fts MATCH ${ftsQuery}
          )`
        : sql`${memos.content} LIKE ${`%${escapeLike(search.text)}%`} ESCAPE '\\'`,
    );
  }

  if (search.hasAttachment) {
    filters.push(
      sql`EXISTS (
        SELECT 1 FROM ${attachments}
        WHERE ${attachments.memoId} = ${memos.id}
          AND ${attachments.userId} = ${user.id}
          AND ${attachments.deletedAt} IS NULL
          AND ${attachments.state} = 'ready'
      )`,
    );
  }

  if (search.isPinned) {
    filters.push(eq(memos.pinned, true));
  }

  if (search.after) {
    filters.push(gte(memos.createdAt, toUtcDayStart(search.after)));
  }

  if (search.before) {
    filters.push(lt(memos.createdAt, toUtcDayStart(search.before)));
  }

  if (query.tag) {
    const tag = normalizeMemoTags([query.tag])[0];
    if (!tag) {
      return { memos: [] };
    }
    filters.push(
      sql`EXISTS (
        SELECT 1 FROM ${memoTags}
        WHERE ${memoTags.memoId} = ${memos.id}
          AND ${memoTags.userId} = ${user.id}
          AND ${memoTags.tag} = ${tag}
      )`,
    );
  }

  if (cursor) {
    const sortFilter =
      direction === "asc"
        ? or(
            gt(orderColumn, cursor.sortValue),
            and(eq(orderColumn, cursor.sortValue), gt(memos.id, cursor.id)),
          )
        : or(
            lt(orderColumn, cursor.sortValue),
            and(eq(orderColumn, cursor.sortValue), lt(memos.id, cursor.id)),
          );
    const cursorFilter = or(
      sql`${memos.pinned} < ${cursor.pinned ? 1 : 0}`,
      and(eq(memos.pinned, cursor.pinned), sortFilter),
    );
    if (cursorFilter) filters.push(cursorFilter);
  }

  const rows = await db
    .select()
    .from(memos)
    .where(and(...filters.filter(Boolean)))
    .orderBy(
      desc(memos.pinned),
      direction === "asc" ? asc(orderColumn) : desc(orderColumn),
      direction === "asc" ? asc(memos.id) : desc(memos.id),
    )
    .limit(query.page_size + 1);

  const page = rows.slice(0, query.page_size);
  const next = rows.length > query.page_size ? page.at(-1) : undefined;

  return {
    memos: page,
    nextPageToken: next
      ? encodePageToken({
          id: next.id,
          orderBy: query.order_by,
          pinned: next.pinned,
          sortValue: query.order_by.startsWith("updated_at")
            ? next.updatedAt
            : next.createdAt,
        })
      : undefined,
  };
}

export async function getMemoStats(
  db: FlareMoDb,
  user: UserRow,
  query: MemoStatsQuery,
): Promise<MemoStatsResponse> {
  const dateKeyFormatter = createDateKeyFormatter(query.time_zone);
  const todayKey = dateKeyFormatter(new Date());
  const recentCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const [countRow, tagRows, activeDayRows, recentRows] = await Promise.all([
    db
      .select({
        normal:
          sql<number>`SUM(CASE WHEN ${memos.status} = 'normal' THEN 1 ELSE 0 END)`.mapWith(
            Number,
          ),
        archived:
          sql<number>`SUM(CASE WHEN ${memos.status} = 'archived' THEN 1 ELSE 0 END)`.mapWith(
            Number,
          ),
        trashed:
          sql<number>`SUM(CASE WHEN ${memos.status} = 'trashed' THEN 1 ELSE 0 END)`.mapWith(
            Number,
          ),
        total:
          sql<number>`SUM(CASE WHEN ${memos.status} IN ('normal', 'archived') THEN 1 ELSE 0 END)`.mapWith(
            Number,
          ),
      })
      .from(memos)
      .where(eq(memos.userId, user.id))
      .get(),
    db
      .select({
        name: memoTags.tag,
        count: sql<number>`COUNT(*)`.mapWith(Number),
      })
      .from(memoTags)
      .innerJoin(memos, eq(memoTags.memoId, memos.id))
      .where(
        and(
          eq(memoTags.userId, user.id),
          inArray(memos.status, ["normal", "archived"]),
        ),
      )
      .groupBy(memoTags.tag)
      .orderBy(asc(memoTags.tag)),
    db
      .select({ day: sql<string>`substr(${memos.createdAt}, 1, 10)` })
      .from(memos)
      .where(
        and(
          eq(memos.userId, user.id),
          inArray(memos.status, ["normal", "archived"]),
        ),
      )
      .groupBy(sql`substr(${memos.createdAt}, 1, 10)`),
    db
      .select({ createdAt: memos.createdAt })
      .from(memos)
      .where(
        and(
          eq(memos.userId, user.id),
          inArray(memos.status, ["normal", "archived"]),
          gte(memos.createdAt, recentCutoff.toISOString()),
        ),
      ),
  ]);

  const activityCounts = new Map<string, number>();
  for (const row of recentRows) {
    const date = new Date(row.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = dateKeyFormatter(date);
    activityCounts.set(key, (activityCounts.get(key) ?? 0) + 1);
  }

  return {
    counts: {
      normal: countRow?.normal ?? 0,
      archived: countRow?.archived ?? 0,
      trashed: countRow?.trashed ?? 0,
      total: countRow?.total ?? 0,
    },
    active_days: activeDayRows.length,
    tags: tagRows,
    activity: buildActivity(todayKey, activityCounts),
  };
}

export async function getMemoById(
  db: FlareMoDb,
  user: UserRow,
  id: string,
  options: { includeDeleted?: boolean } = {},
): Promise<MemoRow> {
  const filters = [eq(memos.id, id), eq(memos.userId, user.id)];
  if (!options.includeDeleted) {
    filters.push(inArray(memos.status, ["normal", "archived", "trashed"]));
  }

  const row = await db
    .select()
    .from(memos)
    .where(and(...filters.filter(Boolean)))
    .get();

  if (!row) {
    throw new NotFoundError("Memo not found");
  }

  return row;
}

async function getMemoByClientId(
  db: FlareMoDb,
  user: UserRow,
  clientId: string,
): Promise<MemoRow | undefined> {
  return db
    .select()
    .from(memos)
    .where(and(eq(memos.userId, user.id), eq(memos.clientId, clientId)))
    .get();
}

export async function updateMemo(
  db: FlareMoDb,
  user: UserRow,
  id: string,
  input: UpdateMemoInput,
): Promise<MemoRow> {
  const existing = await getMemoById(db, user, id, { includeDeleted: true });
  const now = new Date().toISOString();
  const status = input.status;
  const metadataChanged =
    input.content !== undefined || input.payload !== undefined;
  const nextContent = input.content ?? existing.content;
  const nextPayload =
    input.payload !== undefined
      ? normalizeMemoPayload(input.payload)
      : normalizeMemoPayload(existing.payload);
  const persistedClientId =
    existing.clientId ?? normalizeMemoClientId(existing.payload.client_id);
  const requestedClientId =
    input.payload !== undefined
      ? normalizeMemoClientId(nextPayload.client_id)
      : undefined;
  // payload.client_id stays mutable like any other payload field. A payload
  // update that omits it preserves the previous creation id so the
  // idempotency key is not silently dropped.
  const nextClientId = requestedClientId ?? persistedClientId;
  if (nextClientId && nextClientId !== existing.clientId) {
    const owner = await getMemoByClientId(db, user, nextClientId);
    if (owner && owner.id !== existing.id) {
      throw new ConflictError("Memo client_id is already in use");
    }
  }
  if (input.payload !== undefined && nextClientId) {
    nextPayload.client_id = nextClientId;
  }
  const tags = metadataChanged
    ? normalizeMemoTags(nextPayload.tags ?? extractTags(nextContent))
    : [];
  if (metadataChanged) nextPayload.tags = tags;

  const shouldCreateRevision =
    input.content !== undefined ||
    input.visibility !== undefined ||
    input.payload !== undefined;
  const patch = {
    ...(input.content !== undefined ? { content: input.content } : {}),
    ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
    ...(nextClientId !== existing.clientId ? { clientId: nextClientId } : {}),
    ...(metadataChanged ? { payload: nextPayload } : {}),
    updatedAt: now,
    ...(status === "trashed" || status === "deleted" ? { deletedAt: now } : {}),
    ...(status === "normal" || status === "archived"
      ? { deletedAt: null }
      : {}),
  };

  const updateStatement = db
    .update(memos)
    .set(patch)
    .where(and(eq(memos.id, id), eq(memos.userId, user.id)));
  const revisionStatement = db.insert(memoRevisions).values({
    id: createResourceId("revisions"),
    memoId: existing.id,
    userId: user.id,
    content: existing.content,
    visibility: existing.visibility,
    payload: existing.payload,
    createdAt: now,
  });
  const deleteTagsStatement = db
    .delete(memoTags)
    .where(and(eq(memoTags.memoId, id), eq(memoTags.userId, user.id)));
  if (metadataChanged && tags.length > 0 && shouldCreateRevision) {
    await db.batch([
      revisionStatement,
      updateStatement,
      deleteTagsStatement,
      db.insert(memoTags).values(
        tags.map((tag) => ({
          memoId: id,
          userId: user.id,
          tag,
          createdAt: now,
        })),
      ),
    ]);
  } else if (metadataChanged && shouldCreateRevision) {
    await db.batch([revisionStatement, updateStatement, deleteTagsStatement]);
  } else if (shouldCreateRevision) {
    await db.batch([revisionStatement, updateStatement]);
  } else {
    await updateStatement;
  }

  return getMemoById(db, user, id, { includeDeleted: true });
}

export async function moveMemoToTrash(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<MemoRow> {
  return updateMemo(db, user, id, { status: "trashed" });
}

export async function hardDeleteMemo(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<void> {
  await getMemoById(db, user, id, { includeDeleted: true });
  await db.batch([
    db
      .delete(attachments)
      .where(and(eq(attachments.memoId, id), eq(attachments.userId, user.id))),
    db.delete(memos).where(and(eq(memos.id, id), eq(memos.userId, user.id))),
  ]);
}

export function normalizeMemoPayload(payload: unknown): MemoPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return { ...(payload as MemoPayload) };
}

export function normalizeMemoClientId(value: unknown) {
  if (typeof value !== "string") return undefined;
  const clientId = value.trim();
  return clientId && clientId.length <= 128 ? clientId : undefined;
}

export function normalizeMemoTags(values: string[]) {
  const tags = new Set<string>();
  for (const value of values) {
    const tag = value.trim().replace(/^#/, "").toLocaleLowerCase();
    if (tag && tag.length <= 100) tags.add(tag);
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

function encodePageToken(value: MemoCursor) {
  return btoa(JSON.stringify(value));
}

function decodePageToken(token: string, orderBy: MemoOrderBy): MemoCursor {
  try {
    const parsed = JSON.parse(atob(token)) as Partial<MemoCursor>;
    if (
      typeof parsed.sortValue === "string" &&
      typeof parsed.id === "string" &&
      typeof parsed.pinned === "boolean" &&
      parsed.orderBy === orderBy
    ) {
      return parsed as MemoCursor;
    }
  } catch {
    // The validation error below gives callers one stable failure shape.
  }
  throw new ValidationError("Invalid page token");
}

function buildFtsQuery(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !/^[\p{Script=Latin}\p{N}\s_-]+$/u.test(trimmed)) {
    return undefined;
  }
  const terms = trimmed.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return terms.length > 0
    ? terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(" AND ")
    : undefined;
}

function escapeLike(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function memoSearchScopeToState(
  scope: "timeline" | "archive" | "trash" | undefined,
) {
  if (scope === "timeline") return "normal" as const;
  if (scope === "archive") return "archived" as const;
  if (scope === "trash") return "trashed" as const;
  return undefined;
}

function toUtcDayStart(date: string) {
  return `${date}T00:00:00.000Z`;
}

function extractTags(content: string) {
  const tags = new Set<string>();
  for (const match of content.matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)) {
    const tag = match[2];
    if (tag) tags.add(tag);
  }
  return [...tags];
}

function createDateKeyFormatter(timeZone: string) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    });
  } catch {
    throw new ValidationError("Invalid time zone");
  }

  return (date: Date) => {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(date)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
}

function buildActivity(todayKey: string, counts: Map<string, number>) {
  const today = new Date(`${todayKey}T00:00:00Z`);
  const days: Array<{ count: number; date: string }> = [];
  for (let offset = 83; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    days.push({ count: counts.get(key) ?? 0, date: key });
  }
  return days;
}
