import {
  authApiKeys,
  authBootstrap,
  authSessions,
  authUserLinks,
  authUsers,
  type FlareMoDb,
  type UserRow,
  users,
} from "@flaremo/db";
import { and, desc, eq, gt } from "drizzle-orm";
import { ConflictError } from "./errors";
import { ensureSingleUser, type SingleUserConfig } from "./users";

const OWNER_BOOTSTRAP_ID = "bootstrap/owner";
const OWNER_FLAREMO_USER_ID = "users/owner";

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

export async function getFlaremoUserByAuthUserId(
  db: FlareMoDb,
  authUserId: string,
): Promise<UserRow | null> {
  const link = await db.query.authUserLinks.findFirst({
    where: eq(authUserLinks.authUserId, authUserId),
  });
  if (!link) return null;

  return (
    (await db.query.users.findFirst({
      where: eq(users.id, link.flaremoUserId),
    })) ?? null
  );
}

export async function getAuthUserById(db: FlareMoDb, authUserId: string) {
  return (
    (await db.query.authUsers.findFirst({
      where: eq(authUsers.id, authUserId),
    })) ?? null
  );
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
