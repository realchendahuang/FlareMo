/**
 * Environment-shaped auth configuration, split from the Better Auth factory.
 *
 * Nothing here imports Better Auth. That is the whole point: the worker's
 * startup graph is walked from the entry through *static* import edges, and
 * `auth.ts` is heavy — the Better Auth runtime and its plugin set are ~1.8 MiB
 * of source, the single largest cluster in that graph (issue #138). Several
 * callers only need an origin list, a secret accessor, or a PAT constant, and
 * they are reached from the kernel's own request path, so a value import of
 * `auth.ts` from any of them drags the entire auth stack into every isolate's
 * startup parse.
 *
 * Keeping this side of the split free of Better Auth lets those callers import
 * it directly. Callers that genuinely need an auth *instance* go through
 * `context.ts`'s lazy `getFlareMoAuth`, which `import()`s the factory.
 */

import type { FlareMoEnv } from "./env";

export const MEMOS_PAT_CONFIG_ID = "memos";
export const MEMOS_PAT_PREFIX = "memos_pat_";
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
  /**
   * Better Auth api-key permission statements, parsed from the stored JSON.
   * Missing/null means a legacy token created before scopes existed, which
   * keeps unrestricted access.
   */
  permissions: unknown;
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
  /**
   * Change a Better Auth identity's login email and mark it verified. The
   * caller is responsible for prior password/identity verification and for
   * keeping the FlareMo domain `users` row in sync.
   */
  changeEmail: (input: {
    currentEmail: string;
    newEmail: string;
  }) => Promise<void>;
  /**
   * Mint a single-use, expiring password-reset token for a Better Auth
   * identity. The token is stored in `auth_verifications` under the same
   * `reset-password:` namespace Better Auth's reset-password endpoint already
   * consumes, so the recipient sets their own password through the official
   * flow without the admin ever learning the plaintext.
   */
  createPasswordResetToken: (authUserId: string) => Promise<string>;
  /**
   * Mint a single-use, 24h verification token for a Better Auth identity,
   * stored in `auth_verifications` under the `email-verify:` namespace.
   */
  createEmailVerificationToken: (authUserId: string) => Promise<string>;
  /** Mark a Better Auth identity's email as verified. */
  markEmailVerified: (authUserId: string) => Promise<void>;
  /**
   * Consume a single-use email-verification token. Returns the auth user id
   * it was minted for, or null when the token is unknown/expired/already used.
   */
  consumeEmailVerificationToken: (token: string) => Promise<string | null>;
  /**
   * Look up a Better Auth identity by email (normalized lowercase, matching
   * how Better Auth stores addresses).
   */
  findAuthUserByEmail: (email: string) => Promise<{
    id: string;
    email: string;
    emailVerified: boolean;
  } | null>;
  /**
   * Mint a single-use, 24h token authorizing a change of the identity's login
   * email to `newEmail`. The verification value embeds the current and target
   * address so consumption cannot be redirected to a different identity.
   */
  createEmailChangeToken: (
    authUserId: string,
    newEmail: string,
  ) => Promise<string>;
  /**
   * Consume an email-change token. Returns the scoped identity plus the
   * current and approved new address, or null when the token is
   * unknown/expired/already used.
   */
  consumeEmailChangeToken: (token: string) => Promise<{
    authUserId: string;
    currentEmail: string;
    newEmail: string;
  } | null>;
  api: {
    createApiKey: (input: {
      body: {
        configId: string;
        userId: string;
        name: string;
        expiresIn: number | null;
        permissions?: Record<string, string[]>;
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
    verifyPassword: (input: {
      body: { password: string };
      headers: Headers;
    }) => Promise<{ status: boolean }>;
    verifyApiKey: (input: {
      body: {
        configId: string;
        key: string;
      };
    }) => Promise<{
      valid: boolean;
      key: { referenceId: string; permissions?: unknown } | null;
    }>;
  };
};
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
    if (url.protocol === "http:" && !isLocalDevelopmentHostname(url.hostname)) {
      throw new AuthConfigurationError(
        "FLAREMO_TRUSTED_ORIGINS must use HTTPS outside local development.",
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

export function getRequiredBetterAuthSecret(env: FlareMoEnv): string {
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
