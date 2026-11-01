import type { FlareMoDb, UserRow } from "@flaremo/db";
import {
  attachments,
  authAccounts,
  authApiKeys,
  authMembers,
  authOrganizations,
  authSessions,
  authUserLinks,
  authUsers,
  dataTasks,
  embeddingTasks,
  memoRelations,
  memoReviewMarks,
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
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  chunkForD1,
  d1IdsPerRepeatedBinding,
  d1IdsPerStatement,
} from "./d1-limits";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";
import type { PlanLimits } from "./limits";
import { recalibrateUserHourlyCounts } from "./memo-hourly-counts";
import { assertMemberQuota } from "./quotas";
import type { TeamRole } from "./team-permissions";

export type SingleUserConfig = {
  email: string;
  name: string;
};

export type NewMemberConfig = {
  email: string;
  name: string;
};

/** Every deployment has exactly one team under this fixed slug. */
export const DEFAULT_TEAM_SLUG = "flaremo";

export type TeamRow = typeof authOrganizations.$inferSelect;

/**
 * The deployment's team organization. Created lazily at bootstrap and by the
 * schema migration for existing deployments; never created from HTTP.
 */
export async function getDefaultTeam(db: FlareMoDb): Promise<TeamRow | null> {
  return (
    (await db.query.authOrganizations.findFirst({
      where: eq(authOrganizations.slug, DEFAULT_TEAM_SLUG),
    })) ?? null
  );
}

export async function ensureDefaultTeam(db: FlareMoDb): Promise<TeamRow> {
  const existing = await getDefaultTeam(db);
  if (existing) return existing;
  const now = new Date();
  await db
    .insert(authOrganizations)
    .values({
      id: `orgs/${crypto.randomUUID()}`,
      name: "FlareMo Team",
      slug: DEFAULT_TEAM_SLUG,
      logo: null,
      metadata: null,
      createdAt: now,
    })
    .onConflictDoNothing({ target: authOrganizations.slug });
  return (
    (await getDefaultTeam(db)) ??
    (() => {
      throw new ConflictError("Default team could not be created.");
    })()
  );
}

/** Add a user to the default team with the given role. Idempotent. */
export async function addTeamMember(
  db: FlareMoDb,
  input: { authUserId: string; role: TeamRole },
): Promise<void> {
  const team = await ensureDefaultTeam(db);
  await db
    .insert(authMembers)
    .values({
      id: `members/${crypto.randomUUID()}`,
      organizationId: team.id,
      userId: input.authUserId,
      role: input.role,
      createdAt: new Date(),
    })
    .onConflictDoNothing({
      target: [authMembers.organizationId, authMembers.userId],
    });
}

/**
 * Memos-compatible wire role. FlareMo never trusts the wire role for
 * authorization, so only the instance owner and resolved team roles surface
 * as ADMIN; viewers without a membership map to USER.
 */
export function memosWireRole(
  user: UserRow,
  teamRole?: TeamRole | null,
): "USER" | "ADMIN" {
  return user.id === "users/owner" ||
    teamRole === "owner" ||
    teamRole === "admin"
    ? "ADMIN"
    : "USER";
}

export async function removeTeamMember(
  db: FlareMoDb,
  authUserId: string,
): Promise<void> {
  const team = await getDefaultTeam(db);
  if (!team) return;
  await db
    .delete(authMembers)
    .where(
      and(
        eq(authMembers.organizationId, team.id),
        eq(authMembers.userId, authUserId),
      ),
    );
}

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
    email: config.email.trim().toLowerCase(),
    name: config.name,
    avatarUrl: null,
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
 *
 * The address is stored lowercased and an occupied address fails as a typed
 * conflict. Both matter because the identity is created before this row:
 * Better Auth answers a duplicate with a synthetic, unpersisted user when
 * `autoSignIn` is off, so this insert — not the sign-up call — is where a
 * collision surfaces. Left to the unique index it would raise a bare driver
 * error with no status (a 500 on every surface), and a differently-cased
 * duplicate would pass the byte-wise index only to fail on the link insert
 * while leaving the orphaned `users` row behind.
 */
export async function createFlaremoMember(
  db: FlareMoDb,
  config: NewMemberConfig,
): Promise<UserRow> {
  const id = `users/${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const email = config.email.trim().toLowerCase();
  if (await isFlaremoUserEmailTaken(db, email)) {
    throw new ConflictError("That email is already in use.");
  }
  const row = {
    id,
    email,
    name: config.name,
    avatarUrl: null,
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
 * the auth-to-domain link is never written from an HTTP adapter. The member
 * joins the deployment's team with the member role; role elevation is a
 * separate, explicit admin action. When a member cap is supplied (hosted
 * plans), the deployment-wide headcount is checked first; bootstrap
 * (`ensureSingleUser`) intentionally bypasses this.
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
  await addTeamMember(db, { authUserId: input.authUserId, role: "member" });
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

/**
 * Change a team member's role. The bootstrap owner's role is immutable, and a
 * demotion or removal must never leave the team without an active
 * administrator. Role changes are owner-only — enforced by the admin API.
 */
export async function updateTeamMemberRole(
  db: FlareMoDb,
  authUserId: string,
  role: TeamRole,
): Promise<void> {
  const team = await getDefaultTeam(db);
  if (!team) throw new NotFoundError("Team not found");
  if (authUserId === (await getOwnerAuthMemberUserId(db))) {
    throw new ForbiddenError("The owner role cannot be changed.");
  }
  const member = await db.query.authMembers.findFirst({
    where: and(
      eq(authMembers.organizationId, team.id),
      eq(authMembers.userId, authUserId),
    ),
  });
  if (!member) {
    throw new NotFoundError("Active member not found");
  }
  // Demoting an administrator requires another active admin; promoting a
  // reader to member does not (a reader seat is not an administrator).
  if (member.role === "admin" && role === "member") {
    await assertAnotherActiveTeamAdmin(db, authUserId);
  }
  // Leaving the reader seat invalidates its expiry so stale dates cannot
  // resurface if the user becomes a reader again later.
  await db
    .update(authMembers)
    .set({ role, expiresAt: role === "reader" ? member.expiresAt : null })
    .where(
      and(
        eq(authMembers.id, member.id),
        eq(authMembers.organizationId, team.id),
      ),
    );
}

/**
 * Grant the read-only reader seat (community membership) to a user, storing
 * the absolute expiry (null = no expiry). Existing rows of any role become
 * reader rows; non-members get a reader membership in the default team. The
 * caller (admin API) computes renewal dates, so domain storage stays simple.
 */
export async function grantTeamReader(
  db: FlareMoDb,
  input: { authUserId: string; expiresAt: Date | null },
): Promise<void> {
  const team = await ensureDefaultTeam(db);
  await db
    .insert(authMembers)
    .values({
      id: `members/${crypto.randomUUID()}`,
      organizationId: team.id,
      userId: input.authUserId,
      role: "reader",
      expiresAt: input.expiresAt,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [authMembers.organizationId, authMembers.userId],
      set: { role: "reader", expiresAt: input.expiresAt },
    });
}

/**
 * Revoke the reader seat by removing the membership row: the user drops out
 * of the team entirely. Readers never authored team memos (publishing is
 * denied at resolveMemoTeamId), so no owner-claim follow-up is required —
 * unless they previously demoted from a full member, in which case their
 * existing team memos stay published and visible, exactly like a member
 * leaving without account removal.
 */
export async function revokeTeamReader(
  db: FlareMoDb,
  authUserId: string,
): Promise<void> {
  await removeTeamMember(db, authUserId);
}

/**
 * The bootstrap owner account's Better Auth identity, derived from the
 * auth-to-domain link. Used for the immutable-owner guard, not for general
 * role resolution.
 */
async function getOwnerAuthMemberUserId(db: FlareMoDb): Promise<string | null> {
  const link = await db.query.authUserLinks.findFirst({
    where: eq(authUserLinks.flaremoUserId, "users/owner"),
  });
  return link?.authUserId ?? null;
}

async function assertAnotherActiveTeamAdmin(
  db: FlareMoDb,
  excludedAuthUserId: string,
) {
  const team = await getDefaultTeam(db);
  if (!team) {
    throw new ForbiddenError(
      "The last active administrator cannot be changed.",
    );
  }
  // Only active members count: a removed owner's membership row must not
  // satisfy the guard for a degraded deployment. Membership rows carry the
  // Better Auth identity, so the domain user's status goes through the
  // auth-to-domain link.
  const rows = await db
    .select({ value: count() })
    .from(authMembers)
    .innerJoin(authUserLinks, eq(authUserLinks.authUserId, authMembers.userId))
    .innerJoin(users, eq(users.id, authUserLinks.flaremoUserId))
    .where(
      and(
        eq(authMembers.organizationId, team.id),
        inArray(authMembers.role, ["owner", "admin"]),
        eq(users.status, "active"),
        ne(authMembers.userId, excludedAuthUserId),
      ),
    )
    .get();
  if ((rows?.value ?? 0) < 1) {
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

  const link = await db.query.authUserLinks.findFirst({
    where: eq(authUserLinks.flaremoUserId, userId),
  });
  const authUserId = link?.authUserId;
  if (authUserId) {
    // Removing an administrator must never leave the team leaderless.
    const team = await getDefaultTeam(db);
    const member = team
      ? await db.query.authMembers.findFirst({
          where: and(
            eq(authMembers.organizationId, team.id),
            eq(authMembers.userId, authUserId),
          ),
        })
      : null;
    if (member && member.role !== "member") {
      await assertAnotherActiveTeamAdmin(db, authUserId);
    }
  }

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
      db.delete(authMembers).where(eq(authMembers.userId, authUserId)),
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
 * Delete only a removed member's private and personal D1 data. The removed
 * member's team/public memos are adopted by the bootstrap owner so the team
 * keeps one member who can edit, publish, or delete them; their identity
 * fields (author tags, revisions, webhooks) keep pointing at the historical
 * author row.
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
    db.delete(memoReviewMarks).where(eq(memoReviewMarks.userId, userId)),
    db
      .delete(memoryResourceLinks)
      .where(eq(memoryResourceLinks.userId, userId)),
    db.delete(memoryRelations).where(eq(memoryRelations.userId, userId)),
    db.delete(memoryRevisions).where(eq(memoryRevisions.userId, userId)),
    db.delete(memoryItems).where(eq(memoryItems.userId, userId)),
  ]);

  if (privateMemoIds.length > 0) {
    // Every statement here binds the member's whole private-memo id list, and
    // D1 stops at 100 parameters. Deleting an active member used to fail
    // outright past that count — the whole removal is one transaction body, so
    // there was no partial state to recover from either. Chunks are safe to
    // run sequentially because each one only ever narrows the same row set.
    // The relation delete below binds both `memo_id` and `related_memo_id`,
    // so every id costs two parameters instead of one.
    for (const idChunk of chunkForD1(
      privateMemoIds,
      d1IdsPerRepeatedBinding(2),
    )) {
      await db.batch([
        db
          .delete(embeddingTasks)
          .where(
            and(
              eq(embeddingTasks.userId, userId),
              inArray(embeddingTasks.resourceId, idChunk),
            ),
          ),
        db
          .delete(memoRelations)
          .where(
            or(
              inArray(memoRelations.memoId, idChunk),
              inArray(memoRelations.relatedMemoId, idChunk),
            ),
          ),
        db.delete(memoRevisions).where(inArray(memoRevisions.memoId, idChunk)),
        db.delete(memoTags).where(inArray(memoTags.memoId, idChunk)),
        db.delete(memos).where(inArray(memos.id, idChunk)),
      ]);
    }
  }
  if (privateAttachmentIds.length > 0) {
    for (const idChunk of chunkForD1(
      privateAttachmentIds,
      d1IdsPerStatement(),
    )) {
      await db.delete(attachments).where(inArray(attachments.id, idChunk));
    }
  }
  await db
    .delete(embeddingTasks)
    .where(
      and(
        eq(embeddingTasks.userId, userId),
        eq(embeddingTasks.resourceType, "memory"),
      ),
    );

  // Adopt the removed member's team/public memos. The client id is dropped
  // with the old owner so the owner's `(user_id, client_id)` idempotency
  // index can never conflict.
  //
  // The ids are read before the update rather than in a subquery inside the
  // same batch: statements in one batch must not depend on each other's
  // effects, and this batch reassigns the very rows the tag filter selects on.
  const adoptedMemoRows = await db
    .select({ id: memos.id })
    .from(memos)
    .where(and(eq(memos.userId, userId), isNotNull(memos.teamId)));
  const adoptedMemoIds = adoptedMemoRows.map((row) => row.id);

  // `memo_tags.user_id` is denormalized from the memo's author, so the
  // adopted memos' tag rows have to move with them: the fast-path tag query
  // filters on `memo_tags.user_id` while every other number filters on
  // `memos.user_id`, and leaving them apart makes the owner see adopted memos
  // in `counts` but not in `tags`. The `(memo_id, tag)` primary key and the
  // `memo_tags_user_tag_memo_idx` both start with `user_id`, so the migration
  // keeps the index usable.
  if (adoptedMemoIds.length > 0) {
    for (const idChunk of chunkForD1(adoptedMemoIds, d1IdsPerStatement())) {
      await db.batch([
        db
          .update(memos)
          .set({ userId: "users/owner", clientId: null })
          .where(inArray(memos.id, idChunk)),
        db
          .update(memoTags)
          .set({ userId: "users/owner" })
          .where(inArray(memoTags.memoId, idChunk)),
      ]);
    }
  }

  // Both halves above move memos without touching `memo_hourly_counts`: the
  // purge deletes rows, the adoption reassigns them. Rebuild the two affected
  // counters rather than emitting per-memo adjustments — this runs once per
  // member removal, and the removed member's own rows have to disappear
  // entirely (the `users` row is only soft-deleted, so the FK cascade that
  // would normally clear them never fires). Left to the nightly recalibration
  // this would read as the owner undercounting and the removed member still
  // counting memos that no longer exist.
  const now = new Date().toISOString();
  await recalibrateUserHourlyCounts(db, "users/owner", now);
  await recalibrateUserHourlyCounts(db, userId, now);
}

/**
 * Whether the business `users` table already holds this email, compared
 * case-insensitively. The unique index compares bytes, so rows written before
 * addresses were normalized to lowercase still exist; matching on `lower()`
 * keeps those rows authoritative instead of letting a differently-cased
 * duplicate slip through to fail later on the link insert. The authoritative
 * unique-constraint enforcement stays inside updateFlaremoUserEmail.
 */
export async function isFlaremoUserEmailTaken(
  db: FlareMoDb,
  email: string,
  excludeUserId?: string,
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const taken = await db.query.users.findFirst({
    where: sql`lower(${users.email}) = ${normalized}`,
  });
  return Boolean(taken && taken.id !== excludeUserId);
}

/**
 * Update the FlareMo domain user's email in the business `users` table. The
 * caller is responsible for updating the Better Auth `auth_users` credential
 * and for any prior identity verification; this service only keeps the domain
 * copy in sync and enforces the table's unique-email constraint. The email is
 * normalized to lowercase so the two unique email columns stay comparable.
 */
export async function updateFlaremoUserEmail(
  db: FlareMoDb,
  user: UserRow,
  newEmail: string,
): Promise<UserRow> {
  const email = newEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError("A valid email address is required.");
  }
  if (await isFlaremoUserEmailTaken(db, email, user.id)) {
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
  input: {
    name?: string;
    avatarUrl?: string | null;
    authUserId?: string | null;
  },
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

  const authUserId =
    input.authUserId ??
    (
      await db.query.authUserLinks.findFirst({
        where: eq(authUserLinks.flaremoUserId, user.id),
      })
    )?.authUserId;

  if (authUserId) {
    await db
      .update(authUsers)
      .set({
        ...(nextName !== undefined
          ? { name: nextName, displayUsername: nextName }
          : {}),
        ...(input.avatarUrl !== undefined ? { image: input.avatarUrl } : {}),
        updatedAt: new Date(),
      })
      .where(eq(authUsers.id, authUserId));
  }

  return (
    (await db.query.users.findFirst({ where: eq(users.id, user.id) })) ?? user
  );
}
