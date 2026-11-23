import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import {
  authAccounts,
  authApiKeys,
  authInvitations,
  authMembers,
  authOrganizations,
  authSessions,
  authUsers,
  authVerifications,
  createDb,
  type FlareMoDb,
} from "@flaremo/db";
import { betterAuth } from "better-auth";
import { organization, username } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { eq } from "drizzle-orm";
import {
  type FlareMoAuth,
  getPublicUrl,
  getRequiredBetterAuthSecret,
  getTrustedOrigins,
  MEMOS_PAT_CONFIG_ID,
  MEMOS_PAT_PREFIX,
} from "./auth-env";
import type { FlareMoEnv } from "./env";

/**
 * The Better Auth factory. Heavy on purpose: importing this module pulls the
 * auth runtime and its plugins into the bundle, and the worker reaches it only
 * through a dynamic `import()` so it stays out of the isolate startup graph.
 * Environment config and shared types live in `./auth-env`, which has no
 * Better Auth dependency and is safe to import from anywhere.
 */

const authSchema = {
  user: authUsers,
  session: authSessions,
  account: authAccounts,
  verification: authVerifications,
  apikey: authApiKeys,
  organization: authOrganizations,
  member: authMembers,
  // Better Auth 1.7 validates every organization-plugin model up front;
  // FlareMo never issues invitations, but the table must be mapped.
  invitation: authInvitations,
};

/**
 * The team permission matrix, expressed in Better Auth's access-control DSL.
 * Verbs mirror the domain predicates in packages/domain/src/
 * team-permissions.ts: team members read published memos, administrators
 * additionally govern memo state and manage members, and only the owner
 * edits or republishes another member's memo. The Better Auth organization
 * endpoints guard themselves against these statements, so endpoints whose
 * verbs the matrix omits (member:delete, member:update) fail closed for
 * every role — FlareMo's admin API is the only member-management surface.
 */
const teamAccessControl = createAccessControl({
  memo: ["read-others", "govern-others", "edit-others"],
  member: ["invite", "update-role", "remove", "reset-password"],
});

const teamRoles = {
  owner: teamAccessControl.newRole({
    memo: ["read-others", "govern-others", "edit-others"],
    member: ["invite", "update-role", "remove", "reset-password"],
  }),
  admin: teamAccessControl.newRole({
    memo: ["read-others", "govern-others"],
    member: ["invite", "remove", "reset-password"],
  }),
  member: teamAccessControl.newRole({ memo: [], member: [] }),
  // Read-only, optionally time-boxed seat. Zero statements — Better Auth's
  // organization endpoints fail closed for it, and FlareMo's publishing
  // denial lives in resolveMemoTeamId (domain).
  reader: teamAccessControl.newRole({ memo: [], member: [] }),
};
export function createFlareMoAuth(
  env: FlareMoEnv,
  db: FlareMoDb = createDb(env.DB),
  options: {
    allowBootstrapSignUp?: boolean;
    /**
     * Social sign-in providers resolved per request by the auth handler
     * route (admin-configured or env vars). Each entry needs both halves;
     * Better Auth owns the /api/auth/callback/<provider> round trip and the
     * auth_accounts rows.
     */
    socialProviders?: {
      google?: { clientId: string; clientSecret: string };
      github?: { clientId: string; clientSecret: string };
    };
    /**
     * Blocks implicit account creation through social sign-in (existing
     * accounts still link) — used when instance registration is closed so
     * OAuth cannot bypass the registration toggle.
     */
    disableSocialImplicitSignUp?: boolean;
  } = {},
): FlareMoAuth {
  const secret = getRequiredBetterAuthSecret(env);
  const publicUrl = getPublicUrl(env);
  const isSecureDeployment = new URL(publicUrl).protocol === "https:";

  const socialProviders: Record<
    string,
    { clientId: string; clientSecret: string; disableImplicitSignUp: boolean }
  > = {};
  for (const [id, config] of Object.entries(options.socialProviders ?? {})) {
    if (config) {
      socialProviders[id] = {
        ...config,
        disableImplicitSignUp: Boolean(options.disableSocialImplicitSignUp),
      };
    }
  }
  const hasSocialProviders = Object.keys(socialProviders).length > 0;

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
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: false,
      // Password resets must invalidate every session, including sessions
      // the operator cannot inspect in a browser.
      revokeSessionsOnPasswordReset: true,
    },
    // Social sign-in merges into an existing account when the verified
    // provider email matches (Google/GitHub verify addresses); nothing is
    // merged across different email addresses.
    ...(hasSocialProviders
      ? {
          account: {
            accountLinking: {
              enabled: true,
              trustedProviders: ["google", "github"],
            },
          },
        }
      : {}),
    ...(hasSocialProviders ? { socialProviders } : {}),
    // NOTE: Better Auth's `session.cookieCache` is deliberately NOT enabled.
    // It serves the session from a signed cookie without a DB check for up
    // to maxAge, but FlareMo's contract (enforced by auth.test.ts and
    // memos-compatibility.test.ts) requires sign-out and password resets to
    // invalidate cookie sessions immediately. If the hot-path session query
    // ever needs caching, it needs an invalidation story first.
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
      organization({
        // The deployment's single team is created by the bootstrap code and
        // the schema migration; members join it through FlareMo's admin API.
        allowUserToCreateOrganization: false,
        ac: teamAccessControl,
        roles: teamRoles,
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
    createEmailVerificationToken: async (authUserId: string) => {
      const authContext = await auth.$context;
      const token = crypto.randomUUID();
      const identifier = `email-verify:${token}`;
      await authContext.internalAdapter.createVerificationValue({
        identifier,
        value: authUserId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      });
      return token;
    },
    markEmailVerified: async (authUserId: string) => {
      const authContext = await auth.$context;
      await authContext.internalAdapter.updateUser(authUserId, {
        emailVerified: true,
        updatedAt: new Date(),
      });
    },
    consumeEmailVerificationToken: async (token: string) => {
      const authContext = await auth.$context;
      const identifier = `email-verify:${token}`;
      const record =
        await authContext.internalAdapter.findVerificationValue(identifier);
      if (!record) return null;
      await authContext.internalAdapter.deleteVerificationByIdentifier(
        identifier,
      );
      return record.value;
    },
    findAuthUserByEmail: async (email) => {
      const normalized = email.trim().toLowerCase();
      if (!normalized) return null;
      const row = await db
        .select({
          id: authUsers.id,
          email: authUsers.email,
          emailVerified: authUsers.emailVerified,
        })
        .from(authUsers)
        .where(eq(authUsers.email, normalized))
        .get();
      return row ?? null;
    },
    createEmailChangeToken: async (authUserId, newEmail) => {
      const authContext = await auth.$context;
      const current = await db
        .select({ email: authUsers.email })
        .from(authUsers)
        .where(eq(authUsers.id, authUserId))
        .get();
      if (!current) {
        throw new Error("Auth identity not found for email change.");
      }
      const token = crypto.randomUUID();
      const identifier = `email-change:${token}`;
      await authContext.internalAdapter.createVerificationValue({
        identifier,
        value: JSON.stringify({
          authUserId,
          currentEmail: current.email,
          newEmail: newEmail.trim().toLowerCase(),
        }),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      });
      return token;
    },
    consumeEmailChangeToken: async (token) => {
      const authContext = await auth.$context;
      const identifier = `email-change:${token}`;
      const record =
        await authContext.internalAdapter.findVerificationValue(identifier);
      if (!record) return null;
      await authContext.internalAdapter.deleteVerificationByIdentifier(
        identifier,
      );
      try {
        const parsed = JSON.parse(record.value) as {
          authUserId?: unknown;
          currentEmail?: unknown;
          newEmail?: unknown;
        };
        if (
          typeof parsed.authUserId !== "string" ||
          typeof parsed.currentEmail !== "string" ||
          typeof parsed.newEmail !== "string"
        ) {
          return null;
        }
        return {
          authUserId: parsed.authUserId,
          currentEmail: parsed.currentEmail,
          newEmail: parsed.newEmail,
        };
      } catch {
        return null;
      }
    },
    createPasswordResetToken: async (authUserId: string) => {
      // The token is the verification record's unique identifier under the
      // `reset-password:` prefix Better Auth's reset-password endpoint looks
      // up. Storing the auth user id as the value keeps the flow scoped to
      // one identity and one attempt.
      const authContext = await auth.$context;
      const token = crypto.randomUUID();
      const identifier = `reset-password:${token}`;
      await authContext.internalAdapter.createVerificationValue({
        identifier,
        value: authUserId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      });
      return token;
    },
    changeEmail: async ({ currentEmail, newEmail }) => {
      const authContext = await auth.$context;
      // Better Auth lowercases the email and refreshes the caller's own
      // session so subsequent requests observe the new login identity.
      await authContext.internalAdapter.updateUserByEmail(currentEmail, {
        email: newEmail,
        emailVerified: true,
        updatedAt: new Date(),
      });
    },
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
