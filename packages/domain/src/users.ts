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
import { and, asc, count, eq, inArray, ne, or } from "drizzle-orm";
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
    status: "active" as const,
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
    status: "active" as const,
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

export async function listFlaremoUsers(
  db: FlareMoDb,
  options: { includeRemoved?: boolean } = {},
): Promise<UserRow[]> {
  const query = db.select().from(users);
  return options.includeRemoved
    ? query.orderBy(asc(users.createdAt))
    : query.where(eq(users.status, "active")).orderBy(asc(users.createdAt));
}

export async function getFlaremoUserNames(
  db: FlareMoDb,
  userIds: string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [...new Set(userIds)]));
  return new Map(rows.map((row) => [row.id, row.name]));
}

export async function updateFlaremoUserRole(
  db: FlareMoDb,
  userId: string,
  role: "admin" | "member",
): Promise<UserRow> {
  if (userId === "users/owner") {
    throw new ForbiddenError("The owner role cannot be changed.");
  }
  const user = await getFlaremoUserById(db, userId);
  if (user?.status !== "active") {
    throw new NotFoundError("Active member not found");
  }
  if (user.role === "admin" && role === "member") {
    await assertAnotherActiveAdmin(db, userId);
  }
  const updatedAt = new Date().toISOString();
  await db
    .update(users)
    .set({ role, updatedAt })
    .where(and(eq(users.id, userId), eq(users.status, "active")));
  return (await getFlaremoUserById(db, userId)) ?? { ...user, role, updatedAt };
}

async function assertAnotherActiveAdmin(db: FlareMoDb, excludedUserId: string) {
  const row = await db
    .select({ value: count() })
    .from(users)
    .where(
      and(
        eq(users.status, "active"),
        inArray(users.role, ["owner", "admin"]),
        ne(users.id, excludedUserId),
      ),
    )
    .get();
  if ((row?.value ?? 0) < 1) {
    throw new ForbiddenError(
      "The last active administrator cannot be changed.",
    );
  }
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
 * Resource identities a caller must clean outside D1 (R2 objects and Vectorize
 * vectors) while removing a member.
 */
export type FlaremoAccountArtifacts = {
  memoIds: string[];
  memoryIds: string[];
  attachmentR2Keys: string[];
};

export type FlaremoMemberRemovalArtifacts = FlaremoAccountArtifacts & {
  attachmentIds: string[];
};

/**
 * Immediately block a member and revoke every application credential, then
 * return the private/personal artifacts that must be removed outside D1.
 * Repeating the call for an already removed member is safe and lets an admin
 * retry a failed R2/Vectorize cleanup before finalizing D1 deletion.
 */
export async function beginFlaremoMemberRemoval(
  db: FlareMoDb,
  userId: string,
): Promise<FlaremoMemberRemovalArtifacts> {
  if (userId === "users/owner") {
    throw new ForbiddenError("The owner account cannot be removed.");
  }
  const user = await getFlaremoUserById(db, userId);
  if (!user) throw new NotFoundError("Member not found");
  if (user.status === "active" && user.role === "admin") {
    await assertAnotherActiveAdmin(db, userId);
  }

  const link = await db.query.authUserLinks.findFirst({
    where: eq(authUserLinks.flaremoUserId, userId),
  });
  const authUserId = link?.authUserId;
  const removedEmail = `removed+${user.id.replace(/[^a-zA-Z0-9]/g, "-")}@flaremo.invalid`;
  await db
    .update(users)
    .set({
      email: removedEmail,
      status: "removed",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(users.id, userId));
  if (authUserId) {
    await db.batch([
      db.delete(authApiKeys).where(eq(authApiKeys.referenceId, authUserId)),
      db.delete(authSessions).where(eq(authSessions.userId, authUserId)),
      db.delete(authAccounts).where(eq(authAccounts.userId, authUserId)),
      db.delete(authUserLinks).where(eq(authUserLinks.authUserId, authUserId)),
      db.delete(authUsers).where(eq(authUsers.id, authUserId)),
    ]);
  }

  const privateMemoRows = await db
    .select({ id: memos.id })
    .from(memos)
    .where(and(eq(memos.userId, userId), eq(memos.visibility, "private")));
  const privateMemoIds = privateMemoRows.map((row) => row.id);
  const memoryRows = await db
    .select({ id: memoryItems.id })
    .from(memoryItems)
    .where(eq(memoryItems.userId, userId));
  const attachmentRows = await db
    .select({
      id: attachments.id,
      memoId: attachments.memoId,
      key: attachments.r2Key,
    })
    .from(attachments)
    .where(eq(attachments.userId, userId));
  const privateMemoSet = new Set(privateMemoIds);
  const privateAttachments = attachmentRows.filter(
    (attachment) =>
      attachment.memoId === null || privateMemoSet.has(attachment.memoId),
  );

  return {
    memoIds: privateMemoIds,
    memoryIds: memoryRows.map((row) => row.id),
    attachmentIds: privateAttachments.map((attachment) => attachment.id),
    attachmentR2Keys: privateAttachments.map((attachment) => attachment.key),
  };
}

/**
 * Delete only a removed member's private and personal D1 data. Team/public
 * memos and their attachments stay attached to the historical author row.
 */
export async function finalizeFlaremoMemberRemoval(
  db: FlareMoDb,
  userId: string,
  artifacts: FlaremoMemberRemovalArtifacts,
): Promise<void> {
  const user = await getFlaremoUserById(db, userId);
  if (!user) throw new NotFoundError("Member not found");
  if (user.status !== "removed") {
    throw new ConflictError("Member removal has not started.");
  }

  const userWebhookIds = db
    .select({ id: memosWebhooks.id })
    .from(memosWebhooks)
    .where(eq(memosWebhooks.userId, userId));
  const privateMemoIds = artifacts.memoIds;
  const privateAttachmentIds = artifacts.attachmentIds;

  await db.batch([
    db.delete(taskActivity).where(eq(taskActivity.userId, userId)),
    db.delete(tasks).where(eq(tasks.userId, userId)),
    db.delete(projects).where(eq(projects.userId, userId)),
    db.delete(usageCounters).where(eq(usageCounters.userId, userId)),
    db.delete(dataTasks).where(eq(dataTasks.userId, userId)),
    db.delete(settings).where(eq(settings.userId, userId)),
    db.delete(shares).where(eq(shares.userId, userId)),
    db.delete(reactions).where(eq(reactions.creatorId, userId)),
    db
      .delete(memosSseEvents)
      .where(
        and(
          eq(memosSseEvents.creatorId, userId),
          eq(memosSseEvents.visibility, "private"),
        ),
      ),
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

  if (privateMemoIds.length > 0) {
    await db.batch([
      db
        .delete(embeddingTasks)
        .where(
          and(
            eq(embeddingTasks.userId, userId),
            inArray(embeddingTasks.resourceId, privateMemoIds),
          ),
        ),
      db
        .delete(memoRelations)
        .where(
          or(
            inArray(memoRelations.memoId, privateMemoIds),
            inArray(memoRelations.relatedMemoId, privateMemoIds),
          ),
        ),
      db
        .delete(memoRevisions)
        .where(inArray(memoRevisions.memoId, privateMemoIds)),
      db.delete(memoTags).where(inArray(memoTags.memoId, privateMemoIds)),
      db.delete(memos).where(inArray(memos.id, privateMemoIds)),
    ]);
  }
  if (privateAttachmentIds.length > 0) {
    await db
      .delete(attachments)
      .where(inArray(attachments.id, privateAttachmentIds));
  }
  await db
    .delete(embeddingTasks)
    .where(
      and(
        eq(embeddingTasks.userId, userId),
        eq(embeddingTasks.resourceType, "memory"),
      ),
    );
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
