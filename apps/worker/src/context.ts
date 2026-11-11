import {
  memosPatScopesAllowPath,
  memosPatScopesFromPermissions,
} from "@flaremo/contracts";
import { createDb } from "@flaremo/db";
import {
  ForbiddenError,
  getFlaremoUserByAuthSessionToken,
  getFlaremoUserByAuthUserId,
  getUserRegistrationAllowed,
  isActiveTeamMember,
  type PlanLimits,
  parseUserPlanLimits,
  SELF_HOST_UNLIMITED,
  UnauthorizedError,
  type UserPlanLimits,
} from "@flaremo/domain";
import type { Context } from "hono";
import {
  type FlareMoAuth,
  getTrustedOrigins,
  MEMOS_PAT_CONFIG_ID,
} from "./auth-env";
import type { FlareMoEnv } from "./env";
import { memoFilterScanLimit } from "./filter-scan-limit";
import { resolveOauthIntegrationCached } from "./integrations/config";
import { authenticateMemosAccessToken } from "./memos-native-auth";

export type HonoBindings = {
  Bindings: FlareMoEnv;
  Variables: {
    /**
     * Resolved once per request by createFlareMoApp's limits middleware.
     * Self-hosted deployments always carry SELF_HOST_UNLIMITED; external
     * composition shells swap in a subscription-backed resolver via factory
     * options.
     */
    planLimits: PlanLimits;
    /**
     * Stashed by the same middleware so authenticated context builders can
     * resolve per-user limits after the user is known. Defaults to the
     * user-agnostic FLAREMO_USER_LIMITS_JSON payload.
     */
    resolveUserPlanLimits: (
      env: FlareMoEnv,
      userId: string,
    ) => Promise<UserPlanLimits | null> | UserPlanLimits | null;
  };
};

/**
 * Per-user quota limits for the authenticated user. `null` = not configured;
 * only deployment-level limits (or none) apply.
 */
async function resolveUserLimits(
  c: Context<HonoBindings>,
  userId: string,
): Promise<UserPlanLimits | null> {
  const resolve = c.get("resolveUserPlanLimits");
  if (!resolve) return parseUserPlanLimits(c.env.FLAREMO_USER_LIMITS_JSON);
  return resolve(c.env, userId);
}

// The D1 handle is cheap — `createDb` only wraps the binding — and most request
// paths need nothing else, so it stays synchronous and eager. Keeping `db`
// separate from the auth instance is what allows the auth side to be lazy
// without forcing every `db`-only caller to await anything.
const dbCache = new WeakMap<FlareMoEnv, ReturnType<typeof createDb>>();

export function getFlareMoDb(env: FlareMoEnv) {
  let db = dbCache.get(env);
  if (!db) {
    db = createDb(env.DB);
    dbCache.set(env, db);
  }
  return db;
}

/**
 * Better Auth's factory module, imported on first use and memoized.
 *
 * `auth.ts` is the heaviest module in the worker's startup graph: the auth
 * runtime plus its plugins, kysely, jose and the noble crypto curves come to
 * roughly 1.8 MiB of source. A single static value import of it anywhere on the
 * request path — including a file that only wanted an origin list — pins all of
 * that in every isolate's startup parse (issue #138).
 *
 * `import()` is a cached module load, so only the first caller pays; the
 * resolved module is shared by everyone after that.
 */
let authFactory: Promise<typeof import("./auth")> | undefined;

export function loadAuthFactory() {
  authFactory ??= import("./auth");
  return authFactory;
}

// Better Auth assembles a complete instance per construction (config
// resolution, table maps, drizzle adapter). Its inputs — the env bindings and
// the D1 wrapper built from them — are stable for the life of an isolate, so
// one instance is kept per env object. The *promise* is cached rather than the
// resolved value so concurrent requests share a single construction instead of
// racing to build several. Callers needing non-default options (bootstrap
// sign-up, social providers) still build their own instance.
const authCache = new WeakMap<FlareMoEnv, Promise<FlareMoAuth>>();

export function getFlareMoAuth(env: FlareMoEnv): Promise<FlareMoAuth> {
  let pending = authCache.get(env);
  if (!pending) {
    pending = loadAuthFactory().then(({ createFlareMoAuth }) =>
      createFlareMoAuth(env, getFlareMoDb(env)),
    );
    authCache.set(env, pending);
  }
  return pending;
}

/**
 * Auth identity fields the /me surface needs. Sourced from the Better Auth
 * session (no extra query) on browser paths; undefined otherwise.
 */
type AuthUserSummary = {
  email: string;
  username: string | null;
  image?: string | null;
};

/**
 * Better Auth's typed api surface only promises `user.id`, but the transport
 * payload (and the session cookie used for browser cookie caching) always
 * carries email/username. Normalize defensively so a missing field degrades
 * to no auth-user summary instead of a wrong value.
 */
function browserAuthUserSummary(user: unknown): AuthUserSummary | undefined {
  const record = user as {
    email?: unknown;
    username?: unknown;
    image?: unknown;
  } | null;
  if (typeof record?.email !== "string") return undefined;
  return {
    email: record.email,
    username: typeof record.username === "string" ? record.username : null,
    image: typeof record.image === "string" ? record.image : null,
  };
}

// The auth handler route rebuilds the Better Auth instance when the owner
// changes social-provider settings (or an env-provided provider appears in a
// fresh isolate). Cache the built instance per env; keying by the resolved
// integration revision/ids keeps unconfigured deployments on the shared
// default runtime auth.
const oauthAuthCache = new WeakMap<
  FlareMoEnv,
  { key: string; auth: FlareMoAuth }
>();

/**
 * Auth instance for /api/auth/* with social providers wired in when the
 * instance has them configured (env first, then the owner's encrypted D1
 * settings). Provider config is checked against a short TTL cache; the
 * rebuild itself only happens when the resolved config actually changes.
 */
export async function getFlareMoAuthHandler(env: FlareMoEnv) {
  const db = getFlareMoDb(env);
  const oauth = await resolveOauthIntegrationCached(env, db);
  if (!oauth.google && !oauth.github) {
    return getFlareMoAuth(env);
  }
  const key =
    oauth.revision ??
    `env:${oauth.google?.clientId ?? ""}:${oauth.github?.clientId ?? ""}`;
  const cached = oauthAuthCache.get(env);
  if (cached && cached.key === key) return cached.auth;
  let registrationOpen = true;
  try {
    registrationOpen = await getUserRegistrationAllowed(db);
  } catch (error) {
    // Fail open: the registration toggle read must never break sign-in.
    // Leave a trace — a silently broken D1 binding would otherwise
    // re-open registration without anyone noticing.
    console.error(
      "[auth] registration toggle read failed, failing open",
      error,
    );
  }
  const { createFlareMoAuth } = await loadAuthFactory();
  const auth = createFlareMoAuth(env, db, {
    socialProviders: {
      google: oauth.google ?? undefined,
      github: oauth.github ?? undefined,
    },
    disableSocialImplicitSignUp: !registrationOpen,
  });
  oauthAuthCache.set(env, { key, auth });
  return auth;
}

export async function getRequestContext(c: Context<HonoBindings>) {
  const db = getFlareMoDb(c.env);
  const token = getBearerToken(c.req.raw.headers);

  if (token) {
    assertTrustedBearerOrigin(c);
    if (!token.startsWith("memos_pat_")) {
      const nativeAccess = await authenticateMemosAccessToken({
        db,
        env: c.env,
        token,
      });
      if (nativeAccess) {
        assertActiveMember(nativeAccess.user);
        return {
          db,
          user: nativeAccess.user,
          authUserId: nativeAccess.authUserId,
          credential: "session" as const,
          bearerSession: false,
          nativeAccessToken: true,
          session: null,
          authUser: undefined,
          memoFilterScanLimit: memoFilterScanLimit(c.env),
          limits: c.get("planLimits") ?? SELF_HOST_UNLIMITED,
          userLimits: await resolveUserLimits(c, nativeAccess.user.id),
        };
      }

      const session = await getFlaremoUserByAuthSessionToken(db, token);
      if (!session) throw new UnauthorizedError();
      assertActiveMember(session.user);

      return {
        db,
        user: session.user,
        authUserId: session.authUserId,
        credential: "session" as const,
        bearerSession: true,
        nativeAccessToken: false,
        session: session.session,
        authUser: undefined,
        memoFilterScanLimit: memoFilterScanLimit(c.env),
        limits: c.get("planLimits") ?? SELF_HOST_UNLIMITED,
        userLimits: await resolveUserLimits(c, session.user.id),
      };
    }
    // Only `memos_pat_` credentials reach Better Auth, so the auth instance is
    // resolved here rather than at the top of the function: a browser session
    // or a native access token never needs it, and loading it eagerly would
    // defeat the lazy factory for the majority of requests.
    const auth = await getFlareMoAuth(c.env);
    const verification = await auth.api.verifyApiKey({
      body: {
        configId: MEMOS_PAT_CONFIG_ID,
        key: token,
      },
    });
    if (!verification.valid || !verification.key) {
      throw new UnauthorizedError();
    }

    const user = await getFlaremoUserByAuthUserId(
      db,
      verification.key.referenceId,
    );
    if (!user) throw new UnauthorizedError();
    assertActiveMember(user);

    // A PAT only reaches the surfaces its scopes cover. Migration 0050 narrows
    // legacy rows to notes; null remains unrestricted for an un-migrated row.
    const patScopes = memosPatScopesFromPermissions(
      verification.key.permissions,
    );
    if (!memosPatScopesAllowPath(patScopes, c.req.path)) {
      throw new ForbiddenError(
        "This personal access token is not allowed to use this endpoint.",
      );
    }

    return {
      db,
      user,
      authUserId: verification.key.referenceId,
      credential: "pat" as const,
      bearerSession: false,
      nativeAccessToken: false,
      session: null,
      authUser: undefined,
      memoFilterScanLimit: memoFilterScanLimit(c.env),
      limits: c.get("planLimits") ?? SELF_HOST_UNLIMITED,
      userLimits: await resolveUserLimits(c, user.id),
    };
  }

  return getBrowserRequestContext(c);
}

/**
 * Read-only Memos endpoints may serve an anonymous public view. Do not use
 * the single-user owner as a fallback: that would make a missing credential
 * equivalent to the owner's private session. Any explicit bearer credential
 * remains fail-closed and is never downgraded to anonymous access.
 */
export async function getOptionalRequestContext(c: Context<HonoBindings>) {
  try {
    return await getRequestContext(c);
  } catch (error) {
    if (
      error instanceof UnauthorizedError &&
      !c.req.raw.headers.has("authorization") &&
      !c.req.raw.headers.has("cookie")
    ) {
      return {
        db: getFlareMoDb(c.env),
        user: null,
        authUserId: null,
        credential: "anonymous" as const,
        bearerSession: false,
        nativeAccessToken: false,
        session: null,
        authUser: undefined,
        memoFilterScanLimit: memoFilterScanLimit(c.env),
        limits: c.get("planLimits") ?? SELF_HOST_UNLIMITED,
        userLimits: null,
      };
    }
    throw error;
  }
}

/**
 * Better Auth's session cookie names (the `advanced.cookiePrefix` is
 * `flaremo` and secure deployments add the `__Secure-` prefix). Reading the
 * cookie header is enough to tell a browser-session request from an
 * unauthenticated one, without touching the session store.
 */
const SESSION_COOKIE_NAMES = [
  "flaremo.session_token",
  "__Secure-flaremo.session_token",
];

function hasBrowserSessionCookie(headers: Headers): boolean {
  const cookie = headers.get("cookie");
  if (!cookie) return false;
  return SESSION_COOKIE_NAMES.some((name) => cookie.includes(`${name}=`));
}

/**
 * Context for endpoints that are safe for a `notes`-scoped machine credential:
 * the reader settings that describe what the client may use (voice, email,
 * OAuth availability), the capture status probe, and the insight queue that the
 * DSH executor drives.
 *
 * The browser path is unchanged. A bearer credential takes the same route as
 * every other data endpoint (`getRequestContext`: PAT or device token, exact
 * Origin when one is supplied), so the scope check already applied there
 * remains the only authority. Nothing here widens what a `notes` token can do:
 * account, token management and connected-app revocation stay on
 * {@link getBrowserRequestContext}, which still refuses every bearer.
 */
export async function getClientRequestContext(c: Context<HonoBindings>) {
  if (!c.req.raw.headers.has("authorization")) {
    return getBrowserRequestContext(c);
  }
  return getRequestContext(c);
}

export async function getBrowserRequestContext(c: Context<HonoBindings>) {
  if (c.req.raw.headers.has("authorization")) {
    throw new UnauthorizedError();
  }

  const db = getFlareMoDb(c.env);
  // Requests with no session cookie are unauthenticated, full stop: answer 401
  // before the origin contract so the "no credentials → 401" behavior stays
  // stable on every route. Only an actual cookie attempt pays for the origin
  // check, and an unsafe cookie request from the wrong origin is rejected
  // before the session lookup (and its metadata refresh) runs.
  if (!hasBrowserSessionCookie(c.req.raw.headers)) {
    throw new UnauthorizedError();
  }
  assertTrustedCookieMutation(c);
  const auth = await getFlareMoAuth(c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) throw new UnauthorizedError();

  const user = await getFlaremoUserByAuthUserId(db, session.user.id);
  if (!user) throw new UnauthorizedError();
  assertActiveMember(user);

  return {
    db,
    user,
    authUserId: session.user.id,
    credential: "session" as const,
    bearerSession: false,
    nativeAccessToken: false,
    session: null,
    memoFilterScanLimit: memoFilterScanLimit(c.env),
    authUser: browserAuthUserSummary(session.user),
    limits: c.get("planLimits") ?? SELF_HOST_UNLIMITED,
    userLimits: await resolveUserLimits(c, user.id),
  };
}

export function assertTrustedCookieMutation(c: Context<HonoBindings>) {
  if (!isUnsafeMethod(c.req.method)) return;

  const origin = c.req.header("origin");
  if (!origin || !getTrustedOrigins(c.env).includes(origin)) {
    throw new ForbiddenError("This browser request must use FlareMo's origin.");
  }
}

/**
 * Validate the transport-level credential boundary before a public Connect
 * method can short-circuit authentication. Public reads may omit credentials,
 * but a supplied bearer or cookie must still obey the same exact-origin rule
 * as authenticated private routes.
 */
export function assertRequestCredentialBoundary(c: Context<HonoBindings>) {
  const token = getBearerToken(c.req.raw.headers);
  if (token) {
    assertTrustedBearerOrigin(c);
    return;
  }
  if (c.req.raw.headers.has("cookie")) {
    assertTrustedCookieMutation(c);
  }
}

function assertTrustedBearerOrigin(c: Context<HonoBindings>) {
  // Desktop scripts and MCP clients do not normally send Origin. If a browser
  // does send one, it must be the deployment itself or an explicit trusted
  // integration origin, matching the modern Memos MCP security model.
  const origin = c.req.header("origin");
  if (origin && !getTrustedOrigins(c.env).includes(origin)) {
    throw new ForbiddenError("This bearer request uses an untrusted origin.");
  }
}

function isUnsafeMethod(method: string) {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function getBearerToken(headers: Headers): string | null {
  const value = headers.get("authorization");
  if (!value) return null;
  const [scheme, token, extra] = value.trim().split(/\s+/);
  if (!scheme || !token || extra || scheme.toLowerCase() !== "bearer") {
    throw new UnauthorizedError();
  }
  return token;
}

function assertActiveMember(user: Parameters<typeof isActiveTeamMember>[0]) {
  if (!isActiveTeamMember(user)) throw new UnauthorizedError();
}

export type ReturnTypeOfRequestContext = Awaited<
  ReturnType<typeof getRequestContext>
>;
