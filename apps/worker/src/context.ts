import { createDb } from "@flaremo/db";
import {
  ForbiddenError,
  getFlaremoUserByAuthSessionToken,
  getFlaremoUserByAuthUserId,
  UnauthorizedError,
} from "@flaremo/domain";
import type { Context } from "hono";
import {
  createFlareMoAuth,
  getTrustedOrigins,
  MEMOS_PAT_CONFIG_ID,
} from "./auth";
import type { FlareMoEnv } from "./env";
import { authenticateMemosAccessToken } from "./memos-native-auth";

export type HonoBindings = {
  Bindings: FlareMoEnv;
};

export type RequestCredential = "session" | "pat";

export async function getRequestContext(c: Context<HonoBindings>) {
  const db = createDb(c.env.DB);
  const token = getBearerToken(c.req.raw.headers);
  const auth = createFlareMoAuth(c.env, db);

  if (token) {
    assertTrustedBearerOrigin(c);
    if (!token.startsWith("memos_pat_")) {
      const nativeAccess = await authenticateMemosAccessToken({
        db,
        env: c.env,
        token,
      });
      if (nativeAccess) {
        return {
          db,
          user: nativeAccess.user,
          authUserId: nativeAccess.authUserId,
          credential: "session" as const,
          bearerSession: false,
          nativeAccessToken: true,
          session: null,
        };
      }

      const session = await getFlaremoUserByAuthSessionToken(db, token);
      if (!session) throw new UnauthorizedError();

      return {
        db,
        user: session.user,
        authUserId: session.authUserId,
        credential: "session" as const,
        bearerSession: true,
        nativeAccessToken: false,
        session: session.session,
      };
    }
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

    return {
      db,
      user,
      authUserId: verification.key.referenceId,
      credential: "pat" as const,
      bearerSession: false,
      nativeAccessToken: false,
      session: null,
    };
  }

  return getBrowserRequestContext(c, { auth, db });
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
        db: createDb(c.env.DB),
        user: null,
        authUserId: null,
        credential: "anonymous" as const,
        bearerSession: false,
        nativeAccessToken: false,
        session: null,
      };
    }
    throw error;
  }
}

export async function getBrowserRequestContext(
  c: Context<HonoBindings>,
  supplied?: {
    auth: ReturnType<typeof createFlareMoAuth>;
    db: ReturnType<typeof createDb>;
  },
) {
  if (c.req.raw.headers.has("authorization")) {
    throw new UnauthorizedError();
  }

  const db = supplied?.db ?? createDb(c.env.DB);
  const auth = supplied?.auth ?? createFlareMoAuth(c.env, db);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) throw new UnauthorizedError();

  assertTrustedCookieMutation(c);

  const user = await getFlaremoUserByAuthUserId(db, session.user.id);
  if (!user) throw new UnauthorizedError();

  return {
    db,
    user,
    authUserId: session.user.id,
    credential: "session" as const,
    bearerSession: false,
    nativeAccessToken: false,
    session: null,
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

export type ReturnTypeOfRequestContext = Awaited<
  ReturnType<typeof getRequestContext>
>;
