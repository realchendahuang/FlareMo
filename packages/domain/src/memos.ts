import type {
  CreateMemoInput,
  ListMemosQuery,
  MemoStatsQuery,
  MemoStatsResponse,
  UpdateMemoInput,
} from "@flaremo/contracts";
import type { FlareMoDb, MemoPayload, MemoRow, UserRow } from "@flaremo/db";
import { memos } from "@flaremo/db";
import { and, asc, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { NotFoundError, ValidationError } from "./errors";
import { createResourceId } from "./ids";

export type MemoListResult = {
  memos: MemoRow[];
  nextPageToken?: string;
};

export async function createMemo(
  db: FlareMoDb,
  user: UserRow,
  input: CreateMemoInput,
): Promise<MemoRow> {
  const now = new Date().toISOString();
  const row = {
    id: createResourceId("memos"),
    userId: user.id,
    content: input.content,
    visibility: input.visibility,
    status: "normal" as const,
    pinned: false,
    source: input.source,
    payload: normalizeMemoPayload(input.payload),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  await db.insert(memos).values(row);
  const created = await getMemoById(db, user, row.id, { includeDeleted: true });
  return created;
}

export async function listMemos(
  db: FlareMoDb,
  user: UserRow,
  query: ListMemosQuery,
): Promise<MemoListResult> {
  const pageSize = query.page_size;
  const cursor = query.page_token
    ? decodePageToken(query.page_token)
    : undefined;
  const direction = query.order_by.toLowerCase().includes("asc")
    ? "asc"
    : "desc";
  const orderColumn = memos.createdAt;
  const filters = [eq(memos.userId, user.id)];

  if (query.state) {
    filters.push(eq(memos.status, query.state));
  } else if (!query.include_deleted) {
    filters.push(eq(memos.status, "normal"));
  }

  if (query.q) {
    filters.push(
      sql`${memos.content} LIKE ${`%${escapeLike(query.q)}%`} ESCAPE '\\'`,
    );
  }

  if (query.tag) {
    filters.push(
      sql`EXISTS (
        SELECT 1
        FROM json_each(${memos.payload}, '$.tags')
        WHERE json_each.value = ${query.tag}
      )`,
    );
  }

  if (cursor) {
    const cursorFilter =
      direction === "asc"
        ? or(
            gt(orderColumn, cursor.createdAt),
            and(eq(orderColumn, cursor.createdAt), gt(memos.id, cursor.id)),
          )
        : or(
            lt(orderColumn, cursor.createdAt),
            and(eq(orderColumn, cursor.createdAt), lt(memos.id, cursor.id)),
          );
    if (cursorFilter) filters.push(cursorFilter);
  }

  const rows = await db
    .select()
    .from(memos)
    .where(and(...filters.filter(Boolean)))
    .orderBy(
      direction === "asc" ? asc(orderColumn) : desc(orderColumn),
      direction === "asc" ? asc(memos.id) : desc(memos.id),
    )
    .limit(pageSize + 1);

  const page = rows.slice(0, pageSize);
  const next = rows.length > pageSize ? page.at(-1) : undefined;

  return {
    memos: page,
    nextPageToken: next
      ? encodePageToken({ createdAt: next.createdAt, id: next.id })
      : undefined,
  };
}

export async function getMemoStats(
  db: FlareMoDb,
  user: UserRow,
  query: MemoStatsQuery,
): Promise<MemoStatsResponse> {
  const dateKeyFormatter = createDateKeyFormatter(query.time_zone);
  const rows = await db
    .select({
      content: memos.content,
      createdAt: memos.createdAt,
      payload: memos.payload,
      status: memos.status,
    })
    .from(memos)
    .where(eq(memos.userId, user.id));

  const counts = { normal: 0, archived: 0, trashed: 0, total: 0 };
  const activeDays = new Set<string>();
  const activityCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();

  for (const row of rows) {
    if (row.status === "normal") counts.normal += 1;
    if (row.status === "archived") counts.archived += 1;
    if (row.status === "trashed") counts.trashed += 1;
    if (row.status !== "normal" && row.status !== "archived") continue;

    counts.total += 1;
    const date = new Date(row.createdAt);
    if (!Number.isNaN(date.getTime())) {
      const key = dateKeyFormatter(date);
      activeDays.add(key);
      activityCounts.set(key, (activityCounts.get(key) ?? 0) + 1);
    }

    const tags = row.payload.tags ?? extractTags(row.content);
    for (const tag of new Set(tags)) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  return {
    counts,
    active_days: activeDays.size,
    tags: [...tagCounts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    activity: buildActivity(dateKeyFormatter(new Date()), activityCounts),
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

export async function updateMemo(
  db: FlareMoDb,
  user: UserRow,
  id: string,
  input: UpdateMemoInput,
): Promise<MemoRow> {
  await getMemoById(db, user, id, { includeDeleted: true });
  const now = new Date().toISOString();
  const status = input.status;
  const patch = {
    ...(input.content !== undefined ? { content: input.content } : {}),
    ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
    ...(input.payload !== undefined
      ? { payload: normalizeMemoPayload(input.payload) }
      : {}),
    updatedAt: now,
    ...(status === "trashed" || status === "deleted" ? { deletedAt: now } : {}),
    ...(status === "normal" || status === "archived"
      ? { deletedAt: null }
      : {}),
  };

  await db
    .update(memos)
    .set(patch)
    .where(and(eq(memos.id, id), eq(memos.userId, user.id)));
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
  await db
    .delete(memos)
    .where(and(eq(memos.id, id), eq(memos.userId, user.id)));
}

function normalizeMemoPayload(payload: unknown): MemoPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return payload as MemoPayload;
}

function encodePageToken(value: { createdAt: string; id: string }) {
  return btoa(JSON.stringify(value));
}

function decodePageToken(
  token: string,
): { createdAt: string; id: string } | undefined {
  try {
    const parsed = JSON.parse(atob(token)) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.createdAt === "string" && typeof parsed.id === "string") {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function escapeLike(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
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
