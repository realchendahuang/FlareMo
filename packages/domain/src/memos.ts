import type {
  CreateMemoInput,
  ListMemosQuery,
  UpdateMemoInput,
} from "@flaremo/contracts";
import type { FlareMoDb, MemoPayload, MemoRow, UserRow } from "@flaremo/db";
import { memos } from "@flaremo/db";
import { and, desc, eq, gt, inArray, like, lt, sql } from "drizzle-orm";
import { NotFoundError } from "./errors";
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
    filters.push(like(memos.content, `%${escapeLike(query.q)}%`));
  }

  if (query.tag) {
    filters.push(
      like(
        sql<string>`json_extract(${memos.payload}, '$.tags')`,
        `%${escapeLike(query.tag)}%`,
      ),
    );
  }

  if (cursor) {
    filters.push(
      direction === "asc"
        ? gt(orderColumn, cursor.createdAt)
        : lt(orderColumn, cursor.createdAt),
    );
  }

  const rows = await db
    .select()
    .from(memos)
    .where(and(...filters.filter(Boolean)))
    .orderBy(direction === "asc" ? orderColumn : desc(orderColumn))
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
  return value.replaceAll("%", "\\%").replaceAll("_", "\\_");
}
