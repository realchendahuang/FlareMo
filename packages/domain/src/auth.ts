import {
  authApiKeys,
  authBootstrap,
  authMembers,
  authOrganizations,
  authSessions,
  authUserLinks,
  authUsers,
  type FlareMoDb,
  type UserRow,
  users,
} from "@flaremo/db";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { ConflictError } from "./errors";
import type { TeamRole, TeamViewer } from "./team-permissions";
import {
  addTeamMember,
  DEFAULT_TEAM_SLUG,
  ensureSingleUser,
  type SingleUserConfig,
} from "./users";

const OWNER_BOOTSTRAP_ID = "bootstrap/owner";
export const OWNER_FLAREMO_USER_ID = "users/owner";

export type AuthBootstrapState = "ready" | "complete" | "recovery_required";

export type AuthBootstrapStatus = {
  initialized: boolean;
  state: AuthBootstrapState;
};

export async function getAuthBootstrapStatus(
  db: FlareMoDb,
): Promise<AuthBootstrapStatus> {
  const [links, bootstrap, authUserRows] = await Promise.all([
    db.select().from(authUserLinks),
    db.query.authBootstrap.findFirst({
      where: eq(authBootstrap.id, OWNER_BOOTSTRAP_ID),
    }),
    db.select({ id: authUsers.id }).from(authUsers),
  ]);

  const hasExactCompletedLink = Boolean(
    bootstrap?.state === "complete" &&
      bootstrap.authUserId &&
      bootstrap.flaremoUserId === OWNER_FLAREMO_USER_ID &&
      links.some(
        (link) =>
          link.authUserId === bootstrap.authUserId &&
          link.flaremoUserId === bootstrap.flaremoUserId,
      ),
  );

  if (hasExactCompletedLink) {
    return { initialized: true, state: "complete" };
  }

  // An authentication identity, link, or bootstrap claim without a fully
  // consistent completion record can be the result of a partial bootstrap.
  // Do not let a new request claim ownership; require deliberate operator
  // recovery instead. In particular, a future user link must not make the
  // single-user owner bootstrap appear complete.
  if (authUserRows.length > 0 || links.length > 0 || bootstrap) {
    return { initialized: false, state: "recovery_required" };
  }

  return { initialized: false, state: "ready" };
}

export async function claimOwnerBootstrap(db: FlareMoDb): Promise<void> {
  const claimed = await db
    .insert(authBootstrap)
    .values({
      id: OWNER_BOOTSTRAP_ID,
      state: "initializing",
      createdAt: new Date(),
    })
    .onConflictDoNothing({ target: authBootstrap.id })
    .returning({ id: authBootstrap.id });

  if (!claimed[0]) {
    throw new ConflictError(
      "Initial setup is unavailable. Contact the administrator for recovery.",
    );
  }
}

export async function completeOwnerBootstrap(
  db: FlareMoDb,
  input: {
    authUserId: string;
    singleUser: SingleUserConfig;
  },
): Promise<UserRow> {
  const user = await ensureSingleUser(db, input.singleUser);

  await db.insert(authUserLinks).values({
    authUserId: input.authUserId,
    flaremoUserId: user.id,
    createdAt: new Date(),
  });
  await addTeamMember(db, { authUserId: input.authUserId, role: "owner" });

  await db
    .update(authBootstrap)
    .set({
      state: "complete",
      authUserId: input.authUserId,
      flaremoUserId: user.id,
      completedAt: new Date(),
    })
    .where(eq(authBootstrap.id, OWNER_BOOTSTRAP_ID));

  return user;
}

export async function markOwnerBootstrapRecoveryRequired(
  db: FlareMoDb,
): Promise<void> {
  await db
    .update(authBootstrap)
    .set({ state: "recovery_required" })
    .where(eq(authBootstrap.id, OWNER_BOOTSTRAP_ID));
}

/**
 * Reconcile a failed owner bootstrap without opening signup again.
 *
 * This deliberately accepts only a recovery-required singleton and only the
 * shapes that can be proven unambiguous: one Better Auth user, zero or one
 * auth-to-domain links, and (when present) an exact link to users/owner. It
 * never creates a Better Auth identity and it does not accept caller-supplied
 * user data.
 */
export async function reconcileOwnerBootstrap(db: FlareMoDb): Promise<UserRow> {
  const [bootstrap, authUserRows, links] = await Promise.all([
    db.query.authBootstrap.findFirst({
      where: eq(authBootstrap.id, OWNER_BOOTSTRAP_ID),
    }),
    db.select().from(authUsers),
    db.select().from(authUserLinks),
  ]);

  if (bootstrap?.state !== "recovery_required") {
    throw new ConflictError(
      "Owner bootstrap recovery requires a recovery-required state.",
    );
  }
  if (authUserRows.length !== 1) {
    throw new ConflictError(
      "Owner bootstrap recovery requires exactly one authentication identity.",
    );
  }
  if (links.length > 1) {
    throw new ConflictError(
      "Owner bootstrap recovery found an ambiguous identity mapping.",
    );
  }

  const authUser = authUserRows[0];
  if (!authUser) {
    throw new ConflictError(
      "Owner bootstrap recovery found no authentication identity.",
    );
  }

  if (
    (bootstrap.authUserId && bootstrap.authUserId !== authUser.id) ||
    (bootstrap.flaremoUserId &&
      bootstrap.flaremoUserId !== OWNER_FLAREMO_USER_ID)
  ) {
    throw new ConflictError(
      "Owner bootstrap recovery found an inconsistent completion record.",
    );
  }

  const existingLink = links[0];
  if (
    existingLink &&
    (existingLink.authUserId !== authUser.id ||
      existingLink.flaremoUserId !== OWNER_FLAREMO_USER_ID)
  ) {
    throw new ConflictError(
      "Owner bootstrap recovery found an inconsistent identity mapping.",
    );
  }

  const user = await ensureSingleUser(db, {
    email: authUser.email,
    name: authUser.name,
  });

  if (!existingLink) {
    await db
      .insert(authUserLinks)
      .values({
        authUserId: authUser.id,
        flaremoUserId: user.id,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
  }
  await addTeamMember(db, { authUserId: authUser.id, role: "owner" });

  const completed = await db
    .update(authBootstrap)
    .set({
      state: "complete",
      authUserId: authUser.id,
      flaremoUserId: user.id,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(authBootstrap.id, OWNER_BOOTSTRAP_ID),
        eq(authBootstrap.state, "recovery_required"),
      ),
    )
    .returning({ id: authBootstrap.id });

  if (!completed[0]) {
    throw new ConflictError(
      "Owner bootstrap recovery was changed concurrently; retry the operation.",
    );
  }

  return user;
}

/**
 * Return the already-linked owner identity for a completed single-user
 * bootstrap. Recovery must target this identity in place; it must never create
 * another Better Auth user or another domain owner.
 */
export async function getOwnerAuthUserId(
  db: FlareMoDb,
): Promise<string | null> {
  const bootstrap = await db.query.authBootstrap.findFirst({
    where: eq(authBootstrap.id, OWNER_BOOTSTRAP_ID),
  });
  if (
    bootstrap?.state !== "complete" ||
    !bootstrap.authUserId ||
    bootstrap.flaremoUserId !== OWNER_FLAREMO_USER_ID
  ) {
    return null;
  }

  const link = await db.query.authUserLinks.findFirst({
    where: eq(authUserLinks.authUserId, bootstrap.authUserId),
  });
  if (!link || link.flaremoUserId !== bootstrap.flaremoUserId) return null;

  return bootstrap.authUserId;
}

/**
 * The raw membership row for the default team, without expiry handling.
 * Callers that enforce access must prefer {@link getViewerTeamMembership},
 * which folds expired readers out; this exists for /me (surfacing the
 * expired state) and the admin member list.
 */
export async function getMembershipState(
  db: FlareMoDb,
  authUserId: string,
): Promise<{
  role: TeamRole;
  organizationId: string;
  organizationName: string;
  expiresAt: Date | null;
} | null> {
  const row = await db
    .select({
      role: authMembers.role,
      expiresAt: authMembers.expiresAt,
      organizationId: authOrganizations.id,
      organizationName: authOrganizations.name,
    })
    .from(authMembers)
    .innerJoin(
      authOrganizations,
      eq(authOrganizations.id, authMembers.organizationId),
    )
    .where(
      and(
        eq(authMembers.userId, authUserId),
        eq(authOrganizations.slug, DEFAULT_TEAM_SLUG),
      ),
    )
    .get();
  if (!row) return null;
  return {
    role: row.role as TeamRole,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    expiresAt: row.expiresAt ?? null,
  };
}

/**
 * Whether a resolved membership still grants access. Readers with a past
 * `expiresAt` fail closed (the seat lapses without a cron sweep); every other
 * role is open-ended. Shared by the single-query viewer resolution and the
 * standalone membership lookup so the two can never disagree.
 */
export function isMembershipActive(
  role: TeamRole,
  expiresAt: Date | null,
): boolean {
  if (role === "reader" && expiresAt) {
    return expiresAt.getTime() > Date.now();
  }
  return true;
}

/**
 * Resolve the deployment team membership (role + organization id) for a
 * Better Auth identity in one indexed query. Null when the deployment has no
 * team, the identity is not a member, or the membership is an expired
 * reader seat — the single fail-closed gate that makes "到期自动失去访问"
 * hold for every downstream consumer without a cron sweep.
 */
export async function getViewerTeamMembership(
  db: FlareMoDb,
  authUserId: string,
): Promise<{
  role: TeamRole;
  organizationId: string;
  organizationName: string;
} | null> {
  const state = await getMembershipState(db, authUserId);
  if (!state) return null;
  if (!isMembershipActive(state.role, state.expiresAt)) return null;
  return {
    role: state.role,
    organizationId: state.organizationId,
    organizationName: state.organizationName,
  };
}

export async function getFlaremoUserByAuthUserId(
  db: FlareMoDb,
  authUserId: string,
): Promise<TeamViewer | null> {
  // Runs on every authenticated request, so the link, the domain user and the
  // team membership resolve in one indexed join instead of three serial round
  // trips. The organization is left-joined by its fixed slug first, then the
  // membership by (auth user, organization) — a miss on either side leaves the
  // role null, which is exactly the fail-closed shape the old three-step read
  // produced for a non-member.
  const row = await db
    .select({
      user: users,
      role: authMembers.role,
      expiresAt: authMembers.expiresAt,
      organizationId: authOrganizations.id,
      organizationName: authOrganizations.name,
    })
    .from(authUserLinks)
    .innerJoin(users, eq(users.id, authUserLinks.flaremoUserId))
    .leftJoin(authOrganizations, eq(authOrganizations.slug, DEFAULT_TEAM_SLUG))
    .leftJoin(
      authMembers,
      and(
        eq(authMembers.userId, authUserLinks.authUserId),
        eq(authMembers.organizationId, authOrganizations.id),
      ),
    )
    .where(eq(authUserLinks.authUserId, authUserId))
    .get();
  if (!row) return null;

  const role = (row.role ?? null) as TeamRole | null;
  const membership =
    role && row.organizationId && row.organizationName
      ? {
          role,
          organizationId: row.organizationId,
          organizationName: row.organizationName,
        }
      : null;
  const activeMembership =
    membership && isMembershipActive(membership.role, row.expiresAt ?? null)
      ? membership
      : null;

  return {
    ...row.user,
    teamRole: activeMembership?.role ?? null,
    teamOrganizationId: activeMembership?.organizationId ?? null,
  };
}

/**
 * The deployment team as the UI sees it: id plus display name. Null when the
 * viewer has no membership — the sidebar hides the team space entirely.
 */
export async function getViewerTeamInfo(
  db: FlareMoDb,
  authUserId: string,
): Promise<{ id: string; name: string } | null> {
  const membership = await getViewerTeamMembership(db, authUserId);
  if (!membership) return null;
  return { id: membership.organizationId, name: membership.organizationName };
}

export async function getAuthUserIdByFlaremoUserId(
  db: FlareMoDb,
  flaremoUserId: string,
): Promise<string | null> {
  const link = await db.query.authUserLinks.findFirst({
    where: eq(authUserLinks.flaremoUserId, flaremoUserId),
  });
  return link?.authUserId ?? null;
}

export async function getAuthUserById(db: FlareMoDb, authUserId: string) {
  return (
    (await db.query.authUsers.findFirst({
      where: eq(authUsers.id, authUserId),
    })) ?? null
  );
}

export type FlaremoUserWithMembership = {
  user: UserRow;
  authUser: {
    id: string;
    email: string;
    username: string | null;
  } | null;
  membership: {
    role: TeamRole;
    expiresAt: Date | null;
  } | null;
};

/**
 * List domain users with their Better Auth identity and default-team seat in
 * one join. The left joins preserve legacy rows with no auth link or no
 * default-team membership, while the organization predicate prevents a
 * membership in another organization from changing the admin DTO.
 */
export async function listFlaremoUsersWithMemberships(
  db: FlareMoDb,
  options: { includeRemoved?: boolean } = {},
): Promise<FlaremoUserWithMembership[]> {
  const rows = await db
    .select({
      user: users,
      authUserId: authUsers.id,
      authEmail: authUsers.email,
      authUsername: authUsers.username,
      role: authMembers.role,
      expiresAt: authMembers.expiresAt,
    })
    .from(users)
    .leftJoin(authUserLinks, eq(authUserLinks.flaremoUserId, users.id))
    .leftJoin(authUsers, eq(authUsers.id, authUserLinks.authUserId))
    .leftJoin(authOrganizations, eq(authOrganizations.slug, DEFAULT_TEAM_SLUG))
    .leftJoin(
      authMembers,
      and(
        eq(authMembers.userId, authUserLinks.authUserId),
        eq(authMembers.organizationId, authOrganizations.id),
      ),
    )
    .where(options.includeRemoved ? undefined : eq(users.status, "active"))
    .orderBy(asc(users.createdAt))
    .all();

  return rows.map((row) => ({
    user: row.user,
    authUser:
      row.authUserId && row.authEmail
        ? {
            id: row.authUserId,
            email: row.authEmail,
            username: row.authUsername,
          }
        : null,
    membership: row.role
      ? { role: row.role as TeamRole, expiresAt: row.expiresAt ?? null }
      : null,
  }));
}

/**
 * Resolve a Better Auth session token for the current-Memos auth facade.
 *
 * Better Auth's browser session remains the source of truth. This helper only
 * lets a Memos-compatible client carry the opaque session token returned by
 * `/api/v1/auth/signin` in an Authorization header; it does not introduce a
 * second token store or a shared-password fallback.
 */
export async function getFlaremoUserByAuthSessionToken(
  db: FlareMoDb,
  token: string,
) {
  const session = await db.query.authSessions.findFirst({
    where: and(
      eq(authSessions.token, token),
      gt(authSessions.expiresAt, new Date()),
    ),
  });
  if (!session) return null;

  const user = await getFlaremoUserByAuthUserId(db, session.userId);
  if (!user) return null;

  return {
    authUserId: session.userId,
    session,
    user,
  };
}

export async function revokeAuthSessionByToken(
  db: FlareMoDb,
  token: string,
): Promise<boolean> {
  const deleted = await db
    .delete(authSessions)
    .where(eq(authSessions.token, token))
    .returning({ id: authSessions.id });
  return deleted.length > 0;
}

export async function listMemosPersonalAccessTokens(
  db: FlareMoDb,
  authUserId: string,
) {
  return db
    .select()
    .from(authApiKeys)
    .where(
      and(
        eq(authApiKeys.referenceId, authUserId),
        eq(authApiKeys.configId, "memos"),
      ),
    )
    .orderBy(desc(authApiKeys.createdAt));
}

export async function getMemosPersonalAccessToken(
  db: FlareMoDb,
  input: { authUserId: string; keyId: string },
) {
  return (
    (await db.query.authApiKeys.findFirst({
      where: and(
        eq(authApiKeys.id, input.keyId),
        eq(authApiKeys.referenceId, input.authUserId),
        eq(authApiKeys.configId, "memos"),
      ),
    })) ?? null
  );
}

/** Hard-delete a token row, scoped to its owner. Returns the deleted id or null. */
export async function deleteMemosPersonalAccessToken(
  db: FlareMoDb,
  input: { authUserId: string; keyId: string },
) {
  const deleted = await db
    .delete(authApiKeys)
    .where(
      and(
        eq(authApiKeys.id, input.keyId),
        eq(authApiKeys.referenceId, input.authUserId),
        eq(authApiKeys.configId, "memos"),
      ),
    )
    .returning({ id: authApiKeys.id });
  return deleted[0]?.id ?? null;
}
