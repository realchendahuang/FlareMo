import {
  chunkIdsForMemo,
  collectFlaremoAccountArtifacts,
  deleteFlaremoAccount,
  type FlaremoAccountArtifacts,
  ForbiddenError,
  getMemosPersonalAccessToken,
  isFlaremoUserEmailTaken,
  listMemosPersonalAccessTokens,
  memoryIdVector,
  NotFoundError,
  updateFlaremoUserEmail,
  ValidationError,
} from "@flaremo/domain";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { createFlareMoAuth, getPublicUrl, MEMOS_PAT_CONFIG_ID } from "../auth";
import { getBrowserRequestContext, type HonoBindings } from "../context";
import { resolveEmailConfig, sendEmailChangeVerificationEmail } from "../email";
import type { FlareMoEnv } from "../env";
import { jsonError } from "../http";

export const accountApi = new Hono<HonoBindings>();

const createPersonalAccessTokenSchema = z.object({
  name: z.string().trim().min(1).max(32),
  expires_in_days: z.number().int().min(1).max(365).nullable().optional(),
});

const changeEmailSchema = z.object({
  current_password: z.string().min(1).max(128),
  new_email: z.string().trim().email().max(320),
});

const deleteAccountSchema = z.object({
  current_password: z.string().min(1).max(128),
});

/**
 * Remove the account's out-of-D1 artifacts: R2 attachment objects and the
 * deterministic Vectorize vectors (deleteByIds no-ops unknown ids). The D1
 * rows themselves go through deleteFlaremoAccount. Bindings are optional —
 * deployments without R2/vectorize indexes skip the respective cleanup.
 */
async function deleteAccountArtifacts(
  env: FlareMoEnv,
  artifacts: FlaremoAccountArtifacts,
): Promise<void> {
  const keys = artifacts.attachmentR2Keys;
  if (env.ATTACHMENTS) {
    for (let index = 0; index < keys.length; index += 500) {
      await env.ATTACHMENTS.delete(keys.slice(index, index + 500));
    }
  }
  const memoVectorIds = artifacts.memoIds.flatMap((id) => chunkIdsForMemo(id));
  const memoryVectorIds = artifacts.memoryIds.map((id) => memoryIdVector(id));
  const vectorTargets: Array<{
    index: VectorizeIndex | undefined;
    ids: string[];
  }> = [
    { index: env.VECTORIZE_MEMOS, ids: memoVectorIds },
    { index: env.VECTORIZE_MEMORIES, ids: memoryVectorIds },
  ];
  for (const target of vectorTargets) {
    if (!target.index) continue;
    for (let offset = 0; offset < target.ids.length; offset += 500) {
      const batch = target.ids.slice(offset, offset + 500);
      if (batch.length === 0) continue;
      await target.index.deleteByIds(batch);
    }
  }
}

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
      const auth = createFlareMoAuth(c.env, context.db);
      const created = await auth.api.createApiKey({
        body: {
          configId: MEMOS_PAT_CONFIG_ID,
          userId: context.authUserId,
          name: input.name,
          expiresIn: input.expires_in_days
            ? input.expires_in_days * 24 * 60 * 60
            : null,
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

accountApi.post("/email", zValidator("json", changeEmailSchema), async (c) => {
  try {
    const context = await getBrowserRequestContext(c);
    const input = c.req.valid("json");
    const newEmail = input.new_email.trim().toLowerCase();
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

    // When a transactional-email provider is configured, the change only
    // takes effect after the NEW address confirms ownership through its
    // verification link, so a typo cannot lock the account out of every
    // future email flow.
    if (resolveEmailConfig(c.env).provider !== "none") {
      const existingAuthUser = await auth.findAuthUserByEmail(newEmail);
      if (existingAuthUser && existingAuthUser.id !== context.authUserId) {
        throw new ValidationError("That email is already in use.");
      }
      if (
        await isFlaremoUserEmailTaken(context.db, newEmail, context.user.id)
      ) {
        throw new ValidationError("That email is already in use.");
      }
      const token = await auth.createEmailChangeToken(
        context.authUserId,
        newEmail,
      );
      const sent = await sendEmailChangeVerificationEmail(c.env, {
        to: newEmail,
        token,
        publicUrl: getPublicUrl(c.env),
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
    if (context.user.role === "owner") {
      throw new ForbiddenError(
        "The owner account cannot be deleted through the app.",
      );
    }
    const input = c.req.valid("json");
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

    // Snapshot out-of-D1 artifacts first: the batch removes the rows that
    // name the R2 objects and the vector id sources.
    const artifacts = await collectFlaremoAccountArtifacts(
      context.db,
      context.user.id,
    );
    await deleteFlaremoAccount(context.db, context.user.id);
    await deleteAccountArtifacts(c.env, artifacts);

    const response = c.json({ ok: true });
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
    rate_limit_enabled: token.rateLimitEnabled,
    rate_limit_max: token.rateLimitMax,
    rate_limit_time_window: token.rateLimitTimeWindow,
  };
}

function toIsoDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
