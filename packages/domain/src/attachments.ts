import type { FlareMoDb, UserRow } from "@flaremo/db";
import { attachments } from "@flaremo/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { NotFoundError, ValidationError } from "./errors";
import { createResourceId, parseResourceName } from "./ids";
import { getMemoById } from "./memos";

export type CreateAttachmentMetadataInput = {
  memoId?: string | null;
  filename: string;
  contentType?: string | null;
  size: number;
  r2Key: string;
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
  if (memoId) {
    await getMemoById(db, user, memoId);
  }
  if (!input.filename.trim()) {
    throw new ValidationError("Attachment filename is required");
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
    payload: input.payload ?? {},
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  await db.insert(attachments).values(row);
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

export async function getAttachmentById(
  db: FlareMoDb,
  user: UserRow,
  id: string,
) {
  const row = await db.query.attachments.findFirst({
    where: and(
      eq(attachments.id, parseResourceName(id, "attachments")),
      eq(attachments.userId, user.id),
      isNull(attachments.deletedAt),
    ),
  });

  if (!row) {
    throw new NotFoundError("Attachment not found");
  }

  return row;
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
