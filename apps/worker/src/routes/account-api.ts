import {
  getMemosPersonalAccessToken,
  listMemosPersonalAccessTokens,
  NotFoundError,
} from "@flaremo/domain";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { createFlareMoAuth, MEMOS_PAT_CONFIG_ID } from "../auth";
import { getBrowserRequestContext, type HonoBindings } from "../context";
import { jsonError } from "../http";

export const accountApi = new Hono<HonoBindings>();

const createPersonalAccessTokenSchema = z.object({
  name: z.string().trim().min(1).max(32),
  expires_in_days: z.number().int().min(1).max(365).nullable().optional(),
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
