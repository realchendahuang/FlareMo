import type { FlareMoDb, UserRow } from "@flaremo/db";
import {
  attachments,
  authAccounts,
  authApiKeys,
  authSessions,
  authUserLinks,
  authUsers,
  dataTasks,
  embeddingTasks,
  memoRelations,
  memoRevisions,
  memoryItems,
  memoryRelations,
  memoryResourceLinks,
  memoryRevisions,
  memos,
  memosNotifications,
  memosSseEvents,
  memosWebhookDeliveries,
  memosWebhookEvents,
  memosWebhooks,
  memoTags,
  projects,
  reactions,
  settings,
  shares,
  shortcuts,
  taskActivity,
  tasks,
  usageCounters,
  users,
} from "@flaremo/db";
import { asc, eq, inArray, or } from "drizzle-orm";
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
 * Resource identities a caller must clean outside D1 (R2 objects and Vectorize
 * vectors) before/while the account rows go away.
 */
export type FlaremoAccountArtifacts = {
  memoIds: string[];
  memoryIds: string[];
  attachmentR2Keys: string[];
};

/**
 * Snapshot the account's out-of-D1 artifacts. Must be called BEFORE
 * deleteFlaremoAccount: after the batch the attachment rows (R2 keys) and
 * memo/memory rows (vector id sources) are gone.
 */
export async function collectFlaremoAccountArtifacts(
  db: FlareMoDb,
  userId: string,
): Promise<FlaremoAccountArtifacts> {
  const memoRows = await db
    .select({ id: memos.id })
    .from(memos)
    .where(eq(memos.userId, userId));
  const memoryRows = await db
    .select({ id: memoryItems.id })
    .from(memoryItems)
    .where(eq(memoryItems.userId, userId));
  const attachmentRows = await db
    .select({ key: attachments.r2Key })
    .from(attachments)
    .where(eq(attachments.userId, userId));
  return {
    memoIds: memoRows.map((row) => row.id),
    memoryIds: memoryRows.map((row) => row.id),
    attachmentR2Keys: attachmentRows.map((row) => row.key),
  };
}

/**
 * Self-service account deletion. Every per-user row is deleted explicitly,
 * children first, so the cleanup never depends on FK enforcement being
 * enabled in the runtime (D1/SQLite PRAGMAs differ between local and remote)
 * and cannot leave orphaned rows behind a missing cascade.
 *
 * The caller is responsible for the out-of-D1 artifacts returned by
 * collectFlaremoAccountArtifacts (R2 objects, Vectorize vectors) and for
 * refusing owner self-deletion.
 */
export async function deleteFlaremoAccount(
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
  const authUserId = link?.authUserId ?? null;

  const userWebhookIds = db
    .select({ id: memosWebhooks.id })
    .from(memosWebhooks)
    .where(eq(memosWebhooks.userId, userId));

  await db.batch([
    db.delete(taskActivity).where(eq(taskActivity.userId, userId)),
    db.delete(tasks).where(eq(tasks.userId, userId)),
    db.delete(projects).where(eq(projects.userId, userId)),
    // Embedding outbox rows are dropped here: vector cleanup happens
    // synchronously in the caller via collectFlaremoAccountArtifacts, so a
    // pending task must not outlive its owner.
    db.delete(embeddingTasks).where(eq(embeddingTasks.userId, userId)),
    db.delete(usageCounters).where(eq(usageCounters.userId, userId)),
    db.delete(dataTasks).where(eq(dataTasks.userId, userId)),
    db.delete(settings).where(eq(settings.userId, userId)),
    db.delete(shares).where(eq(shares.userId, userId)),
    db.delete(attachments).where(eq(attachments.userId, userId)),
    db.delete(reactions).where(eq(reactions.creatorId, userId)),
    db
      .delete(memoRelations)
      .where(
        inArray(
          memoRelations.memoId,
          db
            .select({ id: memos.id })
            .from(memos)
            .where(eq(memos.userId, userId)),
        ),
      ),
    db.delete(memoRevisions).where(eq(memoRevisions.userId, userId)),
    db.delete(memoTags).where(eq(memoTags.userId, userId)),
    db.delete(memos).where(eq(memos.userId, userId)),
    db.delete(memosSseEvents).where(eq(memosSseEvents.creatorId, userId)),
    db
      .delete(memosWebhookDeliveries)
      .where(inArray(memosWebhookDeliveries.webhookId, userWebhookIds)),
    db
      .delete(memosWebhookEvents)
      .where(eq(memosWebhookEvents.receiverId, userId)),
    db.delete(memosWebhooks).where(eq(memosWebhooks.userId, userId)),
    db
      .delete(memosNotifications)
      .where(
        or(
          eq(memosNotifications.receiverId, userId),
          eq(memosNotifications.senderId, userId),
        ),
      ),
    db.delete(shortcuts).where(eq(shortcuts.userId, userId)),
    db
      .delete(memoryResourceLinks)
      .where(eq(memoryResourceLinks.userId, userId)),
    db.delete(memoryRelations).where(eq(memoryRelations.userId, userId)),
    db.delete(memoryRevisions).where(eq(memoryRevisions.userId, userId)),
    db.delete(memoryItems).where(eq(memoryItems.userId, userId)),
  ]);

  // Better Auth identity last: sessions, PATs, accounts, then the user row
  // itself, then the bridge and the domain user.
  if (authUserId) {
    await db.batch([
      db.delete(authApiKeys).where(eq(authApiKeys.referenceId, authUserId)),
      db.delete(authSessions).where(eq(authSessions.userId, authUserId)),
      db.delete(authAccounts).where(eq(authAccounts.userId, authUserId)),
      db.delete(authUsers).where(eq(authUsers.id, authUserId)),
    ]);
  }
  await db.batch([
    db.delete(authUserLinks).where(eq(authUserLinks.flaremoUserId, userId)),
    db.delete(users).where(eq(users.id, userId)),
  ]);
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
