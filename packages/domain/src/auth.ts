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

export type AuthBootstrapState = "ready" | "complete" | "recovery_required";

export type AuthBootstrapStatus = {
  initialized: boolean;
  state: AuthBootstrapState;
};

export async function getAuthBootstrapStatus(
  db: FlareMoDb,
): Promise<AuthBootstrapStatus> {
  const [link, bootstrap, unlinkedAuthUser] = await Promise.all([
    db.query.authUserLinks.findFirst(),
    db.query.authBootstrap.findFirst({
      where: eq(authBootstrap.id, OWNER_BOOTSTRAP_ID),
    }),
    db.query.authUsers.findFirst(),
  ]);

  if (link) {
    return { initialized: true, state: "complete" };
  }

  // An authentication identity without a FlareMo owner mapping can be the
  // result of a partial bootstrap. Do not let a new request claim ownership;
  // require a deliberate operator recovery instead.
  if (unlinkedAuthUser || bootstrap) {
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
    !bootstrap.flaremoUserId
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
