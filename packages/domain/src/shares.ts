import type { CreateShareInput } from "@flaremo/contracts";
import type { FlareMoDb, UserRow } from "@flaremo/db";
import { attachments, memos, shares, users } from "@flaremo/db";
import { and, eq, isNull, or } from "drizzle-orm";
import { NotFoundError, ValidationError } from "./errors";
import { createResourceId, createToken, parseResourceName } from "./ids";
import { getMemoById } from "./memos";

export async function createMemoShare(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
  input: CreateShareInput = {},
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  await getMemoById(db, user, normalizedMemoId);
  const expiresAt = input.expires_at ?? null;
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    throw new ValidationError("Share expiry must be in the future");
  }

  const existing = await db
    .select()
    .from(shares)
    .where(
      and(
        eq(shares.userId, user.id),
        eq(shares.memoId, normalizedMemoId),
        isNull(shares.revokedAt),
      ),
    );
  const reusable = existing.find(
    (share) =>
      share.expiresAt === expiresAt &&
      (!share.expiresAt || new Date(share.expiresAt).getTime() > Date.now()),
  );
  if (reusable) return reusable;

  const now = new Date().toISOString();
  const row = {
    id: createResourceId("shares"),
    memoId: normalizedMemoId,
    userId: user.id,
    token: createToken(),
    expiresAt,
    createdAt: now,
    updatedAt: now,
    revokedAt: null,
  };

  await db.insert(shares).values(row);
  return getShareByIdOrToken(db, user, row.id);
}

export async function getShareByIdOrToken(
  db: FlareMoDb,
  user: UserRow,
  idOrToken: string,
) {
  const row = await db.query.shares.findFirst({
    where: and(
      eq(shares.userId, user.id),
      isNull(shares.revokedAt),
      or(
        eq(shares.id, parseResourceName(idOrToken, "shares")),
        eq(shares.token, idOrToken),
      ),
    ),
  });

  if (!row) {
    throw new NotFoundError("Share not found");
  }

  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) {
    throw new NotFoundError("Share not found");
  }

  return row;
}

export async function listShares(db: FlareMoDb, user: UserRow) {
  return db.select().from(shares).where(eq(shares.userId, user.id));
}

export async function listMemoShares(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
  options: { includeRevoked?: boolean } = {},
) {
  const normalizedMemoId = parseResourceName(memoId, "memos");
  await getMemoById(db, user, normalizedMemoId, { includeDeleted: true });
  const filters = [
    eq(shares.userId, user.id),
    eq(shares.memoId, normalizedMemoId),
  ];
  if (!options.includeRevoked) filters.push(isNull(shares.revokedAt));
  const rows = await db
    .select()
    .from(shares)
    .where(and(...filters));
  return rows.filter(
    (share) =>
      !share.expiresAt || new Date(share.expiresAt).getTime() > Date.now(),
  );
}

export async function revokeMemoShare(
  db: FlareMoDb,
  user: UserRow,
  idOrToken: string,
) {
  const share = await getShareByIdOrToken(db, user, idOrToken);
  const now = new Date().toISOString();
  await db
    .update(shares)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(shares.id, share.id), eq(shares.userId, user.id)));
  return { ...share, revokedAt: now, updatedAt: now };
}

export async function getPublicShareByToken(db: FlareMoDb, token: string) {
  const share = await db.query.shares.findFirst({
    where: and(eq(shares.token, token), isNull(shares.revokedAt)),
  });

  if (!share) {
    throw new NotFoundError("Share not found");
  }

  if (share.expiresAt && new Date(share.expiresAt).getTime() <= Date.now()) {
    throw new NotFoundError("Share not found");
  }

  const [memo, user, attachmentRows] = await Promise.all([
    db.query.memos.findFirst({
      where: and(
        eq(memos.id, share.memoId),
        eq(memos.userId, share.userId),
        eq(memos.status, "normal"),
      ),
    }),
    db.query.users.findFirst({
      where: eq(users.id, share.userId),
    }),
    db
      .select()
      .from(attachments)
      .where(
        and(
          eq(attachments.memoId, share.memoId),
          eq(attachments.userId, share.userId),
          isNull(attachments.deletedAt),
          eq(attachments.state, "ready"),
        ),
      ),
  ]);

  if (!memo || !user) {
    throw new NotFoundError("Share not found");
  }

  return {
    share,
    memo,
    user,
    attachments: attachmentRows,
  };
}
