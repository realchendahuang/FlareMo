import type { AttachmentRow, FlareMoDb, UserRow } from "@flaremo/db";
import { attachments } from "@flaremo/db";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { createResourceId, parseResourceName } from "./ids";
import { getMemoById, getMemoByIdForViewer } from "./memos";
import { insertMemosSseEvent } from "./memos-sse";

export type CreateAttachmentMetadataInput = {
  memoId?: string | null;
  filename: string;
  contentType?: string | null;
  size: number;
  r2Key: string;
  state?: "ready" | "deleting" | "missing";
  clientId?: string | null;
  etag?: string | null;
  payload?: Record<string, unknown>;
};

export type ListAttachmentsInput = {
  memoId?: string;
  pageSize?: number;
};

export type AttachmentListFilter = {
  memoId?: string;
  filenameEquals?: string;
  filenameContains?: string;
  contentType?: string;
};

export type ListAttachmentsPageInput = ListAttachmentsInput & {
  pageToken?: string;
  filter?: AttachmentListFilter;
  orderBy?: string;
};

export type AttachmentListResult = {
  attachments: AttachmentRow[];
  nextPageToken?: string;
  totalSize: number;
};

type AttachmentCursor = {
  id: string;
  sortValue: string;
  orderBy: string;
  scopeKey: string;
};

export async function createAttachmentMetadata(
  db: FlareMoDb,
  user: UserRow,
  input: CreateAttachmentMetadataInput,
) {
  const memoId = input.memoId ? parseResourceName(input.memoId, "memos") : null;
  const clientId = normalizeAttachmentClientId(input.clientId);
  if (memoId) {
    await getMemoById(db, user, memoId);
  }
  if (!input.filename.trim()) {
    throw new ValidationError("Attachment filename is required");
  }
  if (clientId) {
    const existing = await findAttachmentByClientId(db, user, clientId);
    if (existing) return assertUsableClientAttachment(existing);
  }

  const now = new Date().toISOString();
  const row = {
    id: createResourceId("attachments"),
    userId: user.id,
    memoId,
    r2Key: input.r2Key,
    filename: input.filename,
    contentType: input.contentType ?? null,
    size: input.size,
    state: input.state ?? "ready",
    clientId,
    etag: input.etag ?? null,
    payload: input.payload ?? {},
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  try {
    await db.insert(attachments).values(row);
  } catch (error) {
    // A second browser can cross the pre-insert check at the same time. The
    // unique index remains the final idempotency boundary.
    if (clientId) {
      const existing = await findAttachmentByClientId(db, user, clientId);
      if (existing) return assertUsableClientAttachment(existing);
    }
    throw error;
  }
  return getAttachmentById(db, user, row.id);
}

export async function listAttachments(
  db: FlareMoDb,
  user: UserRow,
  input: ListAttachmentsInput = {},
) {
  const filters = [
    eq(attachments.userId, user.id),
    isNull(attachments.deletedAt),
    eq(attachments.state, "ready"),
  ];
  if (input.memoId) {
    filters.push(
      eq(attachments.memoId, parseResourceName(input.memoId, "memos")),
    );
  }

  return db
    .select()
    .from(attachments)
    .where(and(...filters))
    .orderBy(desc(attachments.createdAt))
    .limit(input.pageSize ?? 50);
}

/**
 * List attachments using the upstream AttachmentService cursor contract.
 *
 * The current Memos service accepts rich CEL filters, but accepting arbitrary
 * expressions in a Worker would make both cost and authorization behavior
 * difficult to bound. The route parses a deliberately small filter subset
 * into this typed input, while this domain function owns the user/deleted/R2
 * visibility boundary and the stable cursor semantics.
 */
export async function listAttachmentsPage(
  db: FlareMoDb,
  user: UserRow,
  input: ListAttachmentsPageInput = {},
): Promise<AttachmentListResult> {
  const pageSize = normalizeAttachmentPageSize(input.pageSize);
  const orderBy = normalizeAttachmentOrderBy(input.orderBy);
  const memoId = input.memoId
    ? parseResourceName(input.memoId, "memos")
    : undefined;
  const filterMemoId = input.filter?.memoId
    ? parseResourceName(input.filter.memoId, "memos")
    : undefined;
  if (memoId && filterMemoId && memoId !== filterMemoId) {
    throw new ValidationError("Attachment memo filters must match");
  }
  const scopeKey = JSON.stringify({
    memoId: memoId ?? filterMemoId ?? null,
    filter: input.filter ?? null,
  });
  const cursor = input.pageToken
    ? decodeAttachmentPageToken(input.pageToken, orderBy, scopeKey)
    : undefined;
  const filters = [
    eq(attachments.userId, user.id),
    isNull(attachments.deletedAt),
    eq(attachments.state, "ready"),
  ];
  const scopedMemoId = memoId ?? filterMemoId;
  if (scopedMemoId) filters.push(eq(attachments.memoId, scopedMemoId));
  if (input.filter?.filenameEquals !== undefined) {
    filters.push(eq(attachments.filename, input.filter.filenameEquals));
  }
  if (input.filter?.filenameContains !== undefined) {
    filters.push(
      sql`${attachments.filename} LIKE ${`%${escapeAttachmentLike(input.filter.filenameContains)}%`} ESCAPE '\\'`,
    );
  }
  if (input.filter?.contentType !== undefined) {
    filters.push(eq(attachments.contentType, input.filter.contentType));
  }

  const sortColumn = orderBy.startsWith("filename")
    ? attachments.filename
    : attachments.createdAt;
  const direction = orderBy.endsWith(" asc") ? "asc" : "desc";
  const baseWhere = and(...filters);
  if (cursor) {
    const cursorFilter =
      direction === "asc"
        ? or(
            gt(sortColumn, cursor.sortValue),
            and(
              eq(sortColumn, cursor.sortValue),
              gt(attachments.id, cursor.id),
            ),
          )
        : or(
            lt(sortColumn, cursor.sortValue),
            and(
              eq(sortColumn, cursor.sortValue),
              lt(attachments.id, cursor.id),
            ),
          );
    if (cursorFilter) filters.push(cursorFilter);
  }

  const [rows, total] = await Promise.all([
    db
      .select()
      .from(attachments)
      .where(and(...filters))
      .orderBy(
        direction === "asc" ? asc(sortColumn) : desc(sortColumn),
        direction === "asc" ? asc(attachments.id) : desc(attachments.id),
      )
      .limit(pageSize + 1),
    db
      .select({ count: count(attachments.id) })
      .from(attachments)
      .where(baseWhere)
      .get(),
  ]);
  const page = rows.slice(0, pageSize);
  const next = rows.length > pageSize ? page.at(-1) : undefined;
  return {
    attachments: page,
    totalSize: Number(total?.count ?? 0),
    nextPageToken: next
      ? encodeAttachmentPageToken({
          id: next.id,
          sortValue: orderBy.startsWith("filename")
            ? next.filename
            : next.createdAt,
          orderBy,
          scopeKey,
        })
      : undefined,
  };
}

export async function listMemoAttachments(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  await getMemoById(db, user, normalizedMemoId);
  return listAttachments(db, user, { memoId: normalizedMemoId, pageSize: 100 });
}

export async function listMemoAttachmentsForViewer(
  db: FlareMoDb,
  user: UserRow | null,
  memoId: string,
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  await getMemoByIdForViewer(db, user, normalizedMemoId);
  if (user) return listMemoAttachments(db, user, normalizedMemoId);
  return db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.memoId, normalizedMemoId),
        isNull(attachments.deletedAt),
        eq(attachments.state, "ready"),
      ),
    )
    .orderBy(desc(attachments.createdAt))
    .limit(100);
}

export async function listAllMemoAttachments(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  await getMemoById(db, user, normalizedMemoId, { includeDeleted: true });
  return db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.userId, user.id),
        eq(attachments.memoId, normalizedMemoId),
        isNull(attachments.deletedAt),
      ),
    );
}

export async function markMemoAttachmentsDeleting(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
) {
  const rows = await listAllMemoAttachments(db, user, memoId);
  if (rows.length === 0) return rows;
  const now = new Date().toISOString();
  await db
    .update(attachments)
    .set({ state: "deleting", updatedAt: now })
    .where(
      and(
        eq(attachments.userId, user.id),
        inArray(
          attachments.id,
          rows.map((attachment) => attachment.id),
        ),
      ),
    );
  return rows;
}

export async function listAttachmentsForMemos(
  db: FlareMoDb,
  user: UserRow,
  memoIds: string[],
) {
  if (memoIds.length === 0) {
    return [];
  }

  return db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.userId, user.id),
        inArray(attachments.memoId, memoIds),
        isNull(attachments.deletedAt),
        eq(attachments.state, "ready"),
      ),
    )
    .orderBy(desc(attachments.createdAt));
}

export async function listAttachmentsForMemosForViewer(
  db: FlareMoDb,
  user: UserRow | null,
  memoIds: string[],
) {
  if (user) return listAttachmentsForMemos(db, user, memoIds);
  if (memoIds.length === 0) return [];

  return db
    .select()
    .from(attachments)
    .where(
      and(
        inArray(attachments.memoId, memoIds),
        isNull(attachments.deletedAt),
        eq(attachments.state, "ready"),
      ),
    )
    .orderBy(desc(attachments.createdAt));
}

export async function getAttachmentById(
  db: FlareMoDb,
  user: UserRow,
  id: string,
  options: { includeUnavailable?: boolean } = {},
) {
  const filters = [
    eq(attachments.id, parseResourceName(id, "attachments")),
    eq(attachments.userId, user.id),
    isNull(attachments.deletedAt),
  ];
  if (!options.includeUnavailable) filters.push(eq(attachments.state, "ready"));
  const row = await db.query.attachments.findFirst({
    where: and(...filters),
  });

  if (!row) {
    throw new NotFoundError("Attachment not found");
  }

  return row;
}

export async function getAttachmentByClientId(
  db: FlareMoDb,
  user: UserRow,
  clientId: string,
): Promise<AttachmentRow | undefined> {
  const attachment = await findAttachmentByClientId(db, user, clientId);
  return attachment && !attachment.deletedAt && attachment.state === "ready"
    ? attachment
    : undefined;
}

async function findAttachmentByClientId(
  db: FlareMoDb,
  user: UserRow,
  clientId: string,
): Promise<AttachmentRow | undefined> {
  return db
    .select()
    .from(attachments)
    .where(
      and(eq(attachments.userId, user.id), eq(attachments.clientId, clientId)),
    )
    .get();
}

function assertUsableClientAttachment(attachment: AttachmentRow) {
  if (!attachment.deletedAt && attachment.state === "ready") {
    return attachment;
  }
  throw new ConflictError("Attachment client_id is unavailable");
}

export function normalizeAttachmentClientId(value: unknown) {
  if (typeof value !== "string") return undefined;
  const clientId = value.trim();
  return clientId && clientId.length <= 128 ? clientId : undefined;
}

export async function bindMemoAttachments(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
  attachmentNames: string[],
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  const memo = await getMemoById(db, user, normalizedMemoId);
  const ids = attachmentNames.map((name) =>
    parseResourceName(name, "attachments"),
  );
  const now = new Date().toISOString();

  if (ids.length > 0) {
    const existing = await db
      .select()
      .from(attachments)
      .where(
        and(
          eq(attachments.userId, user.id),
          inArray(attachments.id, ids),
          isNull(attachments.deletedAt),
          eq(attachments.state, "ready"),
        ),
      );
    const existingIds = new Set(existing.map((attachment) => attachment.id));
    const missing = ids.find((id) => !existingIds.has(id));
    if (missing) {
      throw new NotFoundError(`Attachment not found: ${missing}`);
    }
  }

  const clearExisting = db
    .update(attachments)
    .set({ memoId: null, updatedAt: now })
    .where(
      and(
        eq(attachments.userId, user.id),
        eq(attachments.memoId, normalizedMemoId),
      ),
    );

  if (ids.length > 0) {
    // Attachment binding is a memo mutation in upstream Memos. Keep the
    // durable outbox write in the same D1 batch so reconnecting SSE clients do
    // not observe a successful update without its refresh event.
    await db.batch([
      clearExisting,
      db
        .update(attachments)
        .set({ memoId: normalizedMemoId, updatedAt: now })
        .where(
          and(eq(attachments.userId, user.id), inArray(attachments.id, ids)),
        ),
      insertMemosSseEvent(db, {
        type: "memo.updated",
        name: memo.id,
        visibility: memo.visibility,
        creatorId: memo.userId,
        createdAt: now,
      }),
    ]);
  } else {
    await db.batch([
      clearExisting,
      insertMemosSseEvent(db, {
        type: "memo.updated",
        name: memo.id,
        visibility: memo.visibility,
        creatorId: memo.userId,
        createdAt: now,
      }),
    ]);
  }

  return listMemoAttachments(db, user, normalizedMemoId);
}

export async function updateAttachmentMemo(
  db: FlareMoDb,
  user: UserRow,
  id: string,
  memoId: string | null,
) {
  const attachment = await getAttachmentById(db, user, id);
  const normalizedMemoId = memoId ? parseResourceName(memoId, "memos") : null;
  if (normalizedMemoId) await getMemoById(db, user, normalizedMemoId);
  await db
    .update(attachments)
    .set({ memoId: normalizedMemoId, updatedAt: new Date().toISOString() })
    .where(
      and(eq(attachments.id, attachment.id), eq(attachments.userId, user.id)),
    );
  return getAttachmentById(db, user, attachment.id);
}

export async function softDeleteAttachment(
  db: FlareMoDb,
  user: UserRow,
  id: string,
) {
  const attachment = await getAttachmentById(db, user, id);
  const now = new Date().toISOString();
  await db
    .update(attachments)
    .set({ deletedAt: now, updatedAt: now, memoId: null })
    .where(
      and(eq(attachments.id, attachment.id), eq(attachments.userId, user.id)),
    );
  return attachment;
}

export async function markAttachmentDeleting(
  db: FlareMoDb,
  user: UserRow,
  id: string,
) {
  const attachment = await getAttachmentById(db, user, id, {
    includeUnavailable: true,
  });
  const now = new Date().toISOString();
  await db
    .update(attachments)
    .set({ state: "deleting", updatedAt: now })
    .where(
      and(eq(attachments.id, attachment.id), eq(attachments.userId, user.id)),
    );
  return { ...attachment, state: "deleting" as const, updatedAt: now };
}

export async function finalizeAttachmentDelete(
  db: FlareMoDb,
  user: UserRow,
  id: string,
) {
  const attachment = await getAttachmentById(db, user, id, {
    includeUnavailable: true,
  });
  const now = new Date().toISOString();
  await db
    .update(attachments)
    .set({ deletedAt: now, updatedAt: now, memoId: null, state: "deleting" })
    .where(
      and(eq(attachments.id, attachment.id), eq(attachments.userId, user.id)),
    );
  return attachment;
}

export async function listAttachmentCleanupCandidates(
  db: FlareMoDb,
  cutoff: string,
) {
  return db
    .select()
    .from(attachments)
    .where(
      and(
        isNull(attachments.deletedAt),
        or(
          eq(attachments.state, "deleting"),
          and(isNull(attachments.memoId), lt(attachments.createdAt, cutoff)),
        ),
      ),
    )
    .limit(100);
}

export async function finalizeAttachmentCleanup(db: FlareMoDb, id: string) {
  const now = new Date().toISOString();
  await db
    .update(attachments)
    .set({ deletedAt: now, updatedAt: now, memoId: null, state: "deleting" })
    .where(eq(attachments.id, parseResourceName(id, "attachments")));
}

function normalizeAttachmentPageSize(value: number | undefined) {
  if (value === undefined) return 50;
  if (!Number.isInteger(value) || value < 1) {
    throw new ValidationError(
      "Attachment page size must be a positive integer",
    );
  }
  return Math.min(value, 1_000);
}

function normalizeAttachmentOrderBy(value: string | undefined) {
  const normalized = (
    value?.trim().toLowerCase() || "create_time desc"
  ).replace("createtime", "create_time");
  const [field = "create_time", direction = "desc"] = normalized.split(/\s+/);
  if (
    !["create_time", "filename"].includes(field) ||
    !["asc", "desc"].includes(direction)
  ) {
    throw new ValidationError(
      "Attachment order_by only supports create_time or filename asc/desc",
    );
  }
  return `${field} ${direction}`;
}

function encodeAttachmentPageToken(cursor: AttachmentCursor) {
  return btoa(JSON.stringify(cursor));
}

function decodeAttachmentPageToken(
  token: string,
  orderBy: string,
  scopeKey: string,
): AttachmentCursor {
  try {
    const cursor = JSON.parse(atob(token)) as Partial<AttachmentCursor>;
    if (
      typeof cursor.id === "string" &&
      typeof cursor.sortValue === "string" &&
      cursor.orderBy === orderBy &&
      cursor.scopeKey === scopeKey
    ) {
      return cursor as AttachmentCursor;
    }
  } catch {
    // Fall through to one stable validation error.
  }
  throw new ValidationError("Invalid attachment page token");
}

function escapeAttachmentLike(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}
