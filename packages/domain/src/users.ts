import type { FlareMoDb, UserRow } from "@flaremo/db";
import { authUserLinks, authUsers, users } from "@flaremo/db";
import { asc, eq } from "drizzle-orm";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";
import type { PlanLimits } from "./limits";
import { assertMemberQuota } from "./quotas";

export type SingleUserConfig = {
  email: string;
  name: string;
};

export type NewMemberConfig = {
  email: string;
  name: string;
};

export async function ensureSingleUser(
  db: FlareMoDb,
  config: SingleUserConfig,
): Promise<UserRow> {
  const id = "users/owner";
  const now = new Date().toISOString();
  const existing = await db.query.users.findFirst({
    where: eq(users.id, id),
  });

  if (existing) {
    return existing;
  }

  const row = {
    id,
    email: config.email,
    name: config.name,
    avatarUrl: null,
    role: "owner" as const,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(users).values(row).onConflictDoNothing({ target: users.id });
  return (await db.query.users.findFirst({ where: eq(users.id, id) })) ?? row;
}

export async function getFlaremoUserById(
  db: FlareMoDb,
  id: string,
): Promise<UserRow | null> {
  return (await db.query.users.findFirst({ where: eq(users.id, id) })) ?? null;
}

/**
 * Create a non-owner domain user for multi-user signups and admin-created
 * accounts. IDs are `users/<uuid>`: `memosSubjectForFlaremoUserId` already
 * hashes non-numeric ids deterministically and the link table keeps the
 * auth identity separate, so no counter table is required.
 */
export async function createFlaremoMember(
  db: FlareMoDb,
  config: NewMemberConfig,
): Promise<UserRow> {
  const id = `users/${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const row = {
    id,
    email: config.email,
    name: config.name,
    avatarUrl: null,
    role: "member" as const,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(users).values(row).onConflictDoNothing({ target: users.id });
  return (await db.query.users.findFirst({ where: eq(users.id, id) })) ?? row;
}

/**
 * Create a member and bind it to an existing Better Auth identity in one
 * ownership boundary. Registration and admin creation both reach this path so
 * the auth-to-domain link is never written from an HTTP adapter. When a member
 * cap is supplied (hosted plans), the deployment-wide headcount is checked
 * first; bootstrap (`ensureSingleUser`) intentionally bypasses this.
 */
export async function createFlaremoMemberWithLink(
  db: FlareMoDb,
  input: { authUserId: string; email: string; name: string },
  limits?: PlanLimits,
): Promise<UserRow> {
  if (limits) {
    await assertMemberQuota(db, limits);
  }
  const user = await createFlaremoMember(db, {
    email: input.email,
    name: input.name,
  });
  await db.insert(authUserLinks).values({
    authUserId: input.authUserId,
    flaremoUserId: user.id,
    createdAt: new Date(),
  });
  return user;
}

export async function listFlaremoUsers(db: FlareMoDb): Promise<UserRow[]> {
  return db.select().from(users).orderBy(asc(users.createdAt));
}

/**
 * Derive a legal, unique Better Auth username from an email address. Web
 * signup and admin-created accounts log in with email; the username is kept
 * only because the Memos-compatible wire (signin and user resources) still
 * identifies users by username, and it is editable from the account page.
 */
export async function deriveUniqueUsername(
  db: FlareMoDb,
  email: string,
): Promise<string> {
  const base =
    email
      .split("@")[0]
      ?.toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 30) || "user";
  let candidate = base;
  let suffix = 0;
  for (;;) {
    const existing = await db.query.authUsers.findFirst({
      where: eq(authUsers.username, candidate),
    });
    if (!existing) return candidate;
    suffix += 1;
    const suffixText = String(suffix);
    candidate = `${base.slice(0, 30 - suffixText.length)}${suffixText}`;
  }
}

/**
 * Delete a non-owner user. The auth identity is removed first so its sessions,
 * accounts, and API keys cascade, then the domain row is removed so memos and
 * other owned resources cascade. The owner bootstrap identity is immutable.
 */
export async function deleteFlaremoUser(
  db: FlareMoDb,
  userId: string,
): Promise<void> {
  if (userId === "users/owner") {
    throw new ForbiddenError("The owner account cannot be deleted.");
  }
  const user = await getFlaremoUserById(db, userId);
  if (!user) throw new NotFoundError("User not found");

  const link = await db.query.authUserLinks.findFirst({
    where: eq(authUserLinks.flaremoUserId, userId),
  });
  if (link) {
    await db.delete(authUsers).where(eq(authUsers.id, link.authUserId));
  }
  await db.delete(users).where(eq(users.id, userId));
}

/**
 * Update the FlareMo domain user's email in the business `users` table. The
 * caller is responsible for updating the Better Auth `auth_users` credential
 * and for any prior identity verification; this service only keeps the domain
 * copy in sync and enforces the table's unique-email constraint. The email is
 * normalized to lowercase so the two unique email columns stay comparable.
 */
/**
 * Whether the business `users` table already holds this (lowercased) email.
 * Used for early conflict feedback on email-change requests; the authoritative
 * unique-constraint enforcement stays inside updateFlaremoUserEmail.
 */
export async function isFlaremoUserEmailTaken(
  db: FlareMoDb,
  email: string,
  excludeUserId?: string,
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const taken = await db.query.users.findFirst({
    where: eq(users.email, normalized),
  });
  return Boolean(taken && taken.id !== excludeUserId);
}

export async function updateFlaremoUserEmail(
  db: FlareMoDb,
  user: UserRow,
  newEmail: string,
): Promise<UserRow> {
  const email = newEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError("A valid email address is required.");
  }
  const taken = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (taken && taken.id !== user.id) {
    throw new ConflictError("That email is already in use.");
  }
  await db
    .update(users)
    .set({ email, updatedAt: new Date().toISOString() })
    .where(eq(users.id, user.id));
  return (
    (await db.query.users.findFirst({ where: eq(users.id, user.id) })) ?? user
  );
}

export async function updateFlaremoUserProfile(
  db: FlareMoDb,
  user: UserRow,
  input: { name?: string; avatarUrl?: string | null },
) {
  const nextName = input.name?.trim();
  if (nextName === "") throw new Error("Display name cannot be empty");
  await db
    .update(users)
    .set({
      ...(nextName !== undefined ? { name: nextName } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(users.id, user.id));
  return (
    (await db.query.users.findFirst({ where: eq(users.id, user.id) })) ?? user
  );
}
