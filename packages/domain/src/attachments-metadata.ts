import type { AttachmentRow, FlareMoDb, UserRow } from "@flaremo/db";
import { attachments } from "@flaremo/db";
import { and, eq, isNull } from "drizzle-orm";
import { requireArticle } from "./articles";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { createResourceId, parseResourceName } from "./ids";
import { getMemoById } from "./memos";
import { assertCanEditMemo, isActiveTeamMember } from "./team-permissions";

export type CreateAttachmentMetadataInput = {
  memoId?: string | null;
  articleId?: string | null;
  filename: string;
  contentType?: string | null;
  size: number;
  /** Bytes of the derived preview object, which is stored separately. */
  thumbnailSize?: number;
  r2Key: string;
  state?: "ready" | "deleting" | "missing";
  clientId?: string | null;
  etag?: string | null;
  payload?: Record<string, unknown>;
};

export async function createAttachmentMetadata(
  db: FlareMoDb,
  user: UserRow,
  input: CreateAttachmentMetadataInput,
) {
  const memoId = input.memoId ? parseResourceName(input.memoId, "memos") : null;
  const articleId = input.articleId
    ? parseResourceName(input.articleId, "articles")
    : null;
  const clientId = normalizeAttachmentClientId(input.clientId);
  if (memoId) {
    const memo = await getMemoById(db, user, memoId);
    assertCanEditMemo(user, memo);
  }
  if (articleId) {
    // requireArticle filters by caller id, so this doubles as the ownership
    // check.
    await requireArticle(db, user, articleId);
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
    articleId,
    r2Key: input.r2Key,
    filename: input.filename,
    contentType: input.contentType ?? null,
    size: input.size,
    thumbnailSize: input.thumbnailSize ?? 0,
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

export async function getAttachmentById(
  db: FlareMoDb,
  user: UserRow,
  id: string,
  options: { includeUnavailable?: boolean } = {},
) {
  const filters = [
    eq(attachments.id, parseResourceName(id, "attachments")),
    isNull(attachments.deletedAt),
  ];
  if (!options.includeUnavailable) filters.push(eq(attachments.state, "ready"));
  const row = await db.query.attachments.findFirst({
    where: and(...filters),
  });

  if (!row) {
    throw new NotFoundError("Attachment not found");
  }

  if (row.memoId) {
    await getMemoById(db, user, row.memoId, {
      includeDeleted: options.includeUnavailable,
    });
  } else if (!isActiveTeamMember(user) || row.userId !== user.id) {
    throw new NotFoundError("Attachment not found");
  }

  return row;
}

export async function assertCanManageAttachment(
  db: FlareMoDb,
  user: UserRow,
  attachment: AttachmentRow,
) {
  if (!attachment.memoId) {
    if (!isActiveTeamMember(user) || attachment.userId !== user.id) {
      throw new NotFoundError("Attachment not found");
    }
    return;
  }
  const memo = await getMemoById(db, user, attachment.memoId, {
    includeDeleted: true,
  });
  assertCanEditMemo(user, memo);
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

/**
 * Clients can report an audio file's playback duration at upload time; it
 * lands in the free-form payload as `duration` (positive whole seconds). An
 * invalid or absent value keeps the payload empty instead of failing the
 * upload — duration is decoration, not a contract.
 */
export function parseAttachmentDuration(value: unknown) {
  const seconds =
    typeof value === "string" || typeof value === "number"
      ? Number(value)
      : Number.NaN;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 7 * 24 * 60 * 60) {
    return undefined;
  }
  return { duration: seconds };
}

/**
 * Clients can report an image's intrinsic pixel dimensions at upload time;
 * they land in the free-form payload as `width`/`height` so the web app can
 * reserve the rendered box before the bytes arrive (no scroll jump). Invalid
 * or half-present values keep the payload empty instead of failing the
 * upload — dimensions are decoration, not a contract.
 */
export function parseAttachmentDimensions(input: {
  width: unknown;
  height: unknown;
}) {
  const parse = (value: unknown) => {
    const px =
      typeof value === "string" || typeof value === "number"
        ? Number(value)
        : Number.NaN;
    return Number.isInteger(px) && px >= 1 && px <= 20000 ? px : undefined;
  };
  const width = parse(input.width);
  const height = parse(input.height);
  if (width === undefined || height === undefined) return undefined;
  return { width, height };
}
