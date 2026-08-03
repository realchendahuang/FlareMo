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
    }) => Promise<{ user: { id: string } } | null>;
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

  return betterAuth({
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
  return value || null;
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
