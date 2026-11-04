import {
  DEFAULT_MEMOS_PAT_EXPIRES_IN_DAYS,
  DEFAULT_MEMOS_PAT_SCOPE,
  MAX_MEMOS_PAT_EXPIRES_IN_DAYS,
  MEMOS_PAT_SCOPES,
  type MemosPatScope,
  memosPatPermissionsFor,
  memosPatScopesFromPermissions,
} from "@flaremo/contracts";
import {
  beginFlaremoMemberRemoval,
  ConflictError,
  createMemberRemovalJob,
  deleteMemosPersonalAccessToken,
  ForbiddenError,
  finalizeFlaremoMemberRemoval,
  getMemosPersonalAccessToken,
  isFlaremoUserEmailTaken,
  isInstanceOwner,
  listMemosPersonalAccessTokens,
  NotFoundError,
  updateFlaremoUserEmail,
  updateMemberRemovalJob,
  ValidationError,
} from "@flaremo/domain";
import { Hono } from "hono";
import { z } from "zod";
import { cleanupFlaremoArtifacts } from "../artifact-cleanup";
import { getPublicUrl, MEMOS_PAT_CONFIG_ID } from "../auth-env";
import {
  getBrowserRequestContext,
  type HonoBindings,
  loadAuthFactory,
} from "../context";
import {
  resolveEmailSendConfig,
  sendEmailChangeVerificationEmail,
} from "../email";
import { jsonError } from "../http";
import { zValidator } from "../validated";

export const accountApi = new Hono<HonoBindings>();

const createPersonalAccessTokenSchema = z.object({
  name: z.string().trim().min(1).max(32),
  // null stays accepted for older clients; it now means "the default lifetime"
  // instead of "never expires".
  expires_in_days: z
    .number()
    .int()
    .min(1)
    .max(MAX_MEMOS_PAT_EXPIRES_IN_DAYS)
    .nullable()
    .optional(),
  scopes: z.array(z.enum(MEMOS_PAT_SCOPES)).min(1).max(2).optional(),
});

const changeEmailSchema = z.object({
  current_password: z.string().min(1).max(128),
  new_email: z.string().trim().email().max(320),
});

const deleteAccountSchema = z.object({
  current_password: z.string().min(1).max(128),
});

accountApi.get("/personal-access-tokens", async (c) => {
  try {
    const context = await getBrowserRequestContext(c);
    const tokens = await listMemosPersonalAccessTokens(
      context.db,
      context.authUserId,
    );
    return c.json({
      personal_access_tokens: tokens.map(toPersonalAccessTokenDto),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

accountApi.post(
  "/personal-access-tokens",
  zValidator("json", createPersonalAccessTokenSchema),
  async (c) => {
    try {
      const context = await getBrowserRequestContext(c);
      const input = c.req.valid("json");
      const { createFlareMoAuth } = await loadAuthFactory();
      const auth = createFlareMoAuth(c.env, context.db);
      const scopes = input.scopes ?? [DEFAULT_MEMOS_PAT_SCOPE];
      const expiresInDays =
        input.expires_in_days ?? DEFAULT_MEMOS_PAT_EXPIRES_IN_DAYS;
      const created = await auth.api.createApiKey({
        body: {
          configId: MEMOS_PAT_CONFIG_ID,
          userId: context.authUserId,
          name: input.name,
          expiresIn: expiresInDays * 24 * 60 * 60,
          permissions: memosPatPermissionsFor(scopes),
        },
      });
      const response = c.json(
        {
          personal_access_token: toPersonalAccessTokenDto(created),
          // Better Auth only returns this plaintext value at creation time.
          token: created.key,
        },
        201,
      );
      response.headers.set("cache-control", "no-store");
      return response;
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

accountApi.post("/personal-access-tokens/:id/revoke", async (c) => {
  try {
    const context = await getBrowserRequestContext(c);
    const existing = await getMemosPersonalAccessToken(context.db, {
      authUserId: context.authUserId,
      keyId: c.req.param("id"),
    });
    if (!existing) {
      throw new NotFoundError("Personal access token not found.");
    }

    const { createFlareMoAuth } = await loadAuthFactory();
    const auth = createFlareMoAuth(c.env, context.db);
    const updated = await auth.api.updateApiKey({
      body: {
        configId: MEMOS_PAT_CONFIG_ID,
        keyId: existing.id,
        userId: context.authUserId,
        enabled: false,
      },
    });
    return c.json({ personal_access_token: toPersonalAccessTokenDto(updated) });
  } catch (error) {
    return jsonError(c, error);
  }
});

accountApi.delete("/personal-access-tokens/:id", async (c) => {
  try {
    const context = await getBrowserRequestContext(c);
    const deleted = await deleteMemosPersonalAccessToken(context.db, {
      authUserId: context.authUserId,
      keyId: c.req.param("id"),
    });
    if (!deleted) {
      throw new NotFoundError("Personal access token not found.");
    }
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, error);
  }
});

accountApi.post("/email", zValidator("json", changeEmailSchema), async (c) => {
  try {
    const context = await getBrowserRequestContext(c);
    const input = c.req.valid("json");
    const newEmail = input.new_email.trim().toLowerCase();
    const { createFlareMoAuth } = await loadAuthFactory();
    const auth = createFlareMoAuth(c.env, context.db);

    // Changing the login identity re-authenticates the caller with their
    // current password before touching any credential. Better Auth raises an
    // error (rather than returning status:false) on a mismatch, so a thrown
    // result here is a plain "bad password", not a server fault.
    try {
      await auth.api.verifyPassword({
        body: { password: input.current_password },
        headers: c.req.raw.headers,
      });
    } catch {
      throw new ValidationError("The current password is incorrect.");
    }

    // An address that already belongs to another identity is a conflict in
    // both credential stores, and neither write may be attempted: Better Auth
    // rejects an occupied auth email with a raw unique-index error that reads
    // as a server fault. Checked ahead of the branch below so the
    // no-provider deployment cannot reach that write.
    const existingAuthUser = await auth.findAuthUserByEmail(newEmail);
    if (existingAuthUser && existingAuthUser.id !== context.authUserId) {
      throw new ConflictError("That email is already in use.");
    }
    if (await isFlaremoUserEmailTaken(context.db, newEmail, context.user.id)) {
      throw new ConflictError("That email is already in use.");
    }

    // When a transactional-email provider is configured, the change only
    // takes effect after the NEW address confirms ownership through its
    // verification link, so a typo cannot lock the account out of every
    // future email flow.
    if ((await resolveEmailSendConfig(c.env, context.db)).provider !== "none") {
      const token = await auth.createEmailChangeToken(
        context.authUserId,
        newEmail,
      );
      const sent = await sendEmailChangeVerificationEmail(c.env, context.db, {
        to: newEmail,
        token,
        publicUrl: getPublicUrl(c.env),
        acceptLanguage: c.req.header("accept-language"),
      });
      if (!sent) {
        return c.json(
          { error: { message: "Verification email could not be sent." } },
          502,
        );
      }
      const response = c.json({ ok: true, verification_sent: true });
      response.headers.set("cache-control", "no-store");
      return response;
    }

    // Self-hosted deployments without an email provider keep the immediate
    // change: there is no verification channel, and blocking would strand
    // operators. The auth credential is updated first so a failed domain
    // write cannot leave a login identity pointing at a stale address.
    await auth.changeEmail({
      currentEmail: context.user.email,
      newEmail,
    });
    await updateFlaremoUserEmail(context.db, context.user, newEmail);

    const response = c.json({ ok: true });
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return jsonError(c, error);
  }
});

accountApi.delete("/", zValidator("json", deleteAccountSchema), async (c) => {
  try {
    const context = await getBrowserRequestContext(c);
    if (isInstanceOwner(context.user)) {
      throw new ForbiddenError(
        "The owner account cannot be deleted through the app.",
      );
    }
    const input = c.req.valid("json");
    const { createFlareMoAuth } = await loadAuthFactory();
    const auth = createFlareMoAuth(c.env, context.db);
    // Self-destruction re-authenticates the caller with their current
    // password. Better Auth raises on a mismatch, which maps to a plain
    // "bad password" here, not a server fault.
    try {
      await auth.api.verifyPassword({
        body: { password: input.current_password },
        headers: c.req.raw.headers,
      });
    } catch {
      throw new ValidationError("The current password is incorrect.");
    }

    // Artifact cleanup fans out to thousands of Vectorize/R2 deletes for a
    // large member — run it through the queue's idempotent executor instead
    // of the request budget; inline only when no queue binding exists.
    const job = await createMemberRemovalJob(
      context.db,
      context.user.id,
      context.user.id,
    );
    if (c.env.MEMBER_REMOVAL_QUEUE) {
      await c.env.MEMBER_REMOVAL_QUEUE.send({ jobId: job.id });
      const response = c.json({ ok: true, job });
      response.headers.set("cache-control", "no-store");
      return response;
    }
    await updateMemberRemovalJob(context.db, job.id, {
      status: "removing",
      phase: "revoking_access",
      attempts: (job.attempts ?? 0) + 1,
    });
    // Snapshot out-of-D1 artifacts first: the batch removes the rows that
    // name the R2 objects and the vector id sources.
    const artifacts = await beginFlaremoMemberRemoval(
      context.db,
      context.user.id,
    );
    await cleanupFlaremoArtifacts(c.env, artifacts);
    await finalizeFlaremoMemberRemoval(context.db, context.user.id, artifacts);
    const completed = await updateMemberRemovalJob(context.db, job.id, {
      status: "completed",
      phase: "completed",
      completedAt: new Date().toISOString(),
    });

    const response = c.json({ ok: true, job: completed });
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return jsonError(c, error);
  }
});

function toPersonalAccessTokenDto(token: {
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
  permissions: unknown;
}) {
  return {
    id: token.id,
    name: token.name,
    start: token.start,
    prefix: token.prefix,
    enabled: token.enabled,
    expires_at: toIsoDate(token.expiresAt),
    created_at: token.createdAt.toISOString(),
    updated_at: token.updatedAt.toISOString(),
    last_request: toIsoDate(token.lastRequest),
    request_count: token.requestCount,
    // Legacy tokens stored no permissions and keep full access.
    scopes:
      memosPatScopesFromPermissions(
        parseStoredPermissions(token.permissions),
      ) ?? (["notes", "admin"] satisfies MemosPatScope[]),
    rate_limit_enabled: token.rateLimitEnabled,
    rate_limit_max: token.rateLimitMax,
    rate_limit_time_window: token.rateLimitTimeWindow,
  };
}

function toIsoDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * Permission statements live in D1 as a JSON string, but the plugin's own
 * create/update/verify responses already hand back the parsed object. Accept
 * both so the DTO reports the same scopes either way.
 */
function parseStoredPermissions(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
