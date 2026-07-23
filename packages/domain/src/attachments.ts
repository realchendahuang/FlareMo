import type { AttachmentRow, FlareMoDb, UserRow } from "@flaremo/db";
import { attachments } from "@flaremo/db";
import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { createResourceId, parseResourceName } from "./ids";
import { getMemoById } from "./memos";

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

export async function listMemoAttachments(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  await getMemoById(db, user, normalizedMemoId);
  return listAttachments(db, user, { memoId: normalizedMemoId, pageSize: 100 });
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
  await getMemoById(db, user, normalizedMemoId);
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

  await db
    .update(attachments)
    .set({ memoId: null, updatedAt: now })
    .where(
      and(
        eq(attachments.userId, user.id),
        eq(attachments.memoId, normalizedMemoId),
      ),
    );

  if (ids.length > 0) {
    await db
      .update(attachments)
      .set({ memoId: normalizedMemoId, updatedAt: now })
      .where(
        and(eq(attachments.userId, user.id), inArray(attachments.id, ids)),
      );
  }

  return listMemoAttachments(db, user, normalizedMemoId);
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
