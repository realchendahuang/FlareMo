import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import {
  authAccounts,
  authApiKeys,
  authSessions,
  authUsers,
  authVerifications,
  createDb,
  type FlareMoDb,
} from "@flaremo/db";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import type { FlareMoEnv } from "./env";

export const MEMOS_PAT_CONFIG_ID = "memos";
export const MEMOS_PAT_PREFIX = "memos_pat_";

const authSchema = {
  user: authUsers,
  session: authSessions,
  account: authAccounts,
  verification: authVerifications,
  apikey: authApiKeys,
};

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

/**
 * The worker only relies on this narrow portion of Better Auth's generated
 * API. Keeping the exported surface explicit prevents TypeScript declaration
 * output from reaching into pnpm's private dependency paths while preserving
 * the concrete plugin types inside the factory implementation.
 */
export type MemosApiKey = {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  enabled: boolean;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastRequest: Date | null;
  requestCount: number;
  rateLimitEnabled: boolean;
  rateLimitMax: number | null;
  rateLimitTimeWindow: number | null;
};

export type FlareMoAuth = {
  handler: (request: Request) => Response | Promise<Response>;
  /**
   * Reset a password through Better Auth's own reset-password endpoint. This
   * is only used by the explicitly configured operator recovery route.
   */
  operatorResetPassword: (input: {
    authUserId: string;
    newPassword: string;
  }) => Promise<void>;
  api: {
    createApiKey: (input: {
      body: {
        configId: string;
        userId: string;
        name: string;
        expiresIn: number | null;
      };
    }) => Promise<MemosApiKey & { key: string }>;
    getSession: (input: {
      headers: Headers;
      query?: {
        disableCookieCache?: boolean;
        disableRefresh?: boolean;
      };
    }) => Promise<{
      session: { token: string; expiresAt: Date };
      user: { id: string };
    } | null>;
    signInUsername: (input: {
      body: {
        username: string;
        password: string;
        rememberMe?: boolean;
      };
      headers: Headers;
      asResponse: false;
      returnHeaders: true;
    }) => Promise<{
      headers: Headers;
      response: {
        token: string;
        user: { id: string };
      };
    }>;
    signUpEmail: (input: {
      body: {
        email: string;
        name: string;
        password: string;
        username: string;
        displayUsername: string;
      };
    }) => Promise<{ user: { id: string } }>;
    updateApiKey: (input: {
      body: {
        configId: string;
        keyId: string;
        userId: string;
        enabled: boolean;
      };
    }) => Promise<MemosApiKey>;
    verifyApiKey: (input: {
      body: {
        configId: string;
        key: string;
      };
    }) => Promise<{ valid: boolean; key: { referenceId: string } | null }>;
  };
};

export function createFlareMoAuth(
  env: FlareMoEnv,
  db: FlareMoDb = createDb(env.DB),
  options: { allowBootstrapSignUp?: boolean } = {},
): FlareMoAuth {
  const secret = getRequiredBetterAuthSecret(env);
  const publicUrl = getPublicUrl(env);
  const isSecureDeployment = new URL(publicUrl).protocol === "https:";

  const auth = betterAuth({
    appName: "FlareMo",
    baseURL: publicUrl,
    basePath: "/api/auth",
    secret,
    trustedOrigins: getTrustedOrigins(env, publicUrl),
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: authSchema,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !options.allowBootstrapSignUp,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
      // Password resets must invalidate every session, including sessions
      // the operator cannot inspect in a browser.
      revokeSessionsOnPasswordReset: true,
    },
    rateLimit: {
      // Local D1/Miniflare does not provide Cloudflare's trusted client-IP
      // header, so enabling the shared fallback bucket there makes unrelated
      // test and development requests throttle one another. Every deployed
      // FlareMo origin is HTTPS and uses the Cloudflare header below.
      enabled: isSecureDeployment,
      max: 100,
      window: 60,
    },
    advanced: {
      cookiePrefix: "flaremo",
      ipAddress: {
        // This header is written by Cloudflare before the Worker runs. It
        // gives Better Auth's login throttling a real client-IP bucket rather
        // than one shared bucket for the entire deployment.
        ipAddressHeaders: ["cf-connecting-ip"],
      },
      useSecureCookies: isSecureDeployment,
      defaultCookieAttributes: {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: isSecureDeployment,
      },
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 30,
      }),
      apiKey({
        configId: MEMOS_PAT_CONFIG_ID,
        defaultPrefix: MEMOS_PAT_PREFIX,
        defaultKeyLength: 64,
        requireName: true,
        enableSessionForAPIKeys: false,
        keyExpiration: {
          minExpiresIn: 1,
          maxExpiresIn: 365,
        },
        rateLimit: {
          enabled: true,
          timeWindow: 60 * 60 * 1_000,
          maxRequests: 10_000,
        },
      }),
    ],
  });

  return {
    ...auth,
    operatorResetPassword: async ({ authUserId, newPassword }) => {
      // Better Auth's resetPassword API owns password validation, hashing,
      // verification consumption, reset callbacks, and session revocation.
      // Create only a short-lived, in-memory-referenced verification record so
      // the operator path enters that same official flow without touching
      // auth_accounts.password or exposing a reusable reset token.
      const authContext = await auth.$context;
      const token = crypto.randomUUID();
      const identifier = `reset-password:${token}`;
      await authContext.internalAdapter.createVerificationValue({
        identifier,
        value: authUserId,
        expiresAt: new Date(Date.now() + 60_000),
      });

      try {
        const result = await auth.api.resetPassword({
          body: { newPassword, token },
        });
        if (!result.status) {
          throw new Error("Better Auth rejected the password reset.");
        }
      } catch (error) {
        await authContext.internalAdapter
          .deleteVerificationByIdentifier(identifier)
          .catch(() => undefined);
        throw error;
      }
    },
  };
}

export function getPublicUrl(env: FlareMoEnv): string {
  const value = env.FLAREMO_PUBLIC_URL?.trim();
  if (!value) {
    throw new AuthConfigurationError(
      "FLAREMO_PUBLIC_URL must be configured before native authentication is enabled.",
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AuthConfigurationError(
      "FLAREMO_PUBLIC_URL must be an absolute URL.",
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new AuthConfigurationError(
      "FLAREMO_PUBLIC_URL must use http or https.",
    );
  }
  if (url.protocol === "http:" && !isLocalDevelopmentHostname(url.hostname)) {
    throw new AuthConfigurationError(
      "FLAREMO_PUBLIC_URL must use HTTPS outside local development.",
    );
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new AuthConfigurationError(
      "FLAREMO_PUBLIC_URL must be an origin without a path, query, or fragment.",
    );
  }

  return url.origin;
}

export function getTrustedOrigins(
  env: FlareMoEnv,
  publicUrl = getPublicUrl(env),
): string[] {
  const origins = new Set([publicUrl]);
  const configured = env.FLAREMO_TRUSTED_ORIGINS?.trim();
  if (!configured) return [...origins];

  for (const rawOrigin of configured.split(",")) {
    const value = rawOrigin.trim();
    if (!value) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new AuthConfigurationError(
        "FLAREMO_TRUSTED_ORIGINS must contain absolute origins.",
      );
    }
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new AuthConfigurationError(
        "FLAREMO_TRUSTED_ORIGINS entries must be origins without paths.",
      );
    }
    origins.add(url.origin);
  }

  return [...origins];
}

export function getBootstrapSecret(env: FlareMoEnv): string | null {
  const value = env.FLAREMO_BOOTSTRAP_SECRET?.trim();
  if (!value || value.length < 32) return null;
  return value;
}

/**
 * Break-glass recovery is intentionally separate from the one-time bootstrap
 * secret. It should normally be absent and be configured only for an
 * operator-approved recovery, then rotated or removed immediately afterward.
 */
export function getRecoverySecret(env: FlareMoEnv): string | null {
  const value = env.FLAREMO_RECOVERY_SECRET?.trim();
  if (!value || value.length < 32) return null;
  return value;
}

function getRequiredBetterAuthSecret(env: FlareMoEnv): string {
  const value = env.BETTER_AUTH_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new AuthConfigurationError(
      "BETTER_AUTH_SECRET must be configured with at least 32 characters before native authentication is enabled.",
    );
  }
  return value;
}

/**
 * The Memos-compatible JWT layer signs with the same secret that configures
 * Better Auth. Exporting this narrow accessor keeps secret validation in one
 * place without exposing the secret through any response or log path.
 */
export function getBetterAuthSecret(env: FlareMoEnv): string {
  return getRequiredBetterAuthSecret(env);
}

function isLocalDevelopmentHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".test")
  );
}
