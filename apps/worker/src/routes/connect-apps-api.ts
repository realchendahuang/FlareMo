import {
  type ConnectedAppsResponseDto,
  normalizeUserCode,
} from "@flaremo/contracts";
import {
  approveDeviceAuthorization,
  getConnectedAppKey,
  listConnectedApps,
  NotFoundError,
  revokeRefreshTokensForAccessKey,
} from "@flaremo/domain";
import { Hono } from "hono";
import { z } from "zod";
import { MEMOS_PAT_CONFIG_ID } from "../auth-env";
import {
  getBrowserRequestContext,
  type HonoBindings,
  loadAuthFactory,
} from "../context";
import { jsonError } from "../http";
import { zValidator } from "../validated";

/**
 * Owner-facing device-approval and connected-app endpoints. All of them require
 * a browser cookie session: a PAT must never approve another device or list the
 * app inventory. See docs/agent-access-design.md.
 */
export const connectAppsApi = new Hono<HonoBindings>();

const approveSchema = z.object({
  user_code: z.string().trim().min(1).max(32),
  scopes: z.array(z.enum(["notes", "admin"])).optional(),
});

connectAppsApi.post(
  "/approve",
  zValidator("json", approveSchema),
  async (c) => {
    try {
      const context = await getBrowserRequestContext(c);
      const input = c.req.valid("json");
      const result = await approveDeviceAuthorization(context.db, {
        userCode: normalizeUserCode(input.user_code),
        authUserId: context.authUserId,
        scopes: input.scopes,
      });
      return c.json(result, 200, { "cache-control": "no-store" });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

connectAppsApi.get("/apps", async (c) => {
  try {
    const context = await getBrowserRequestContext(c);
    const apps = await listConnectedApps(context.db, {
      authUserId: context.authUserId,
      patConfigId: MEMOS_PAT_CONFIG_ID,
    });
    return c.json<ConnectedAppsResponseDto>({ apps }, 200, {
      "cache-control": "no-store",
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

connectAppsApi.delete("/apps/:id", async (c) => {
  try {
    const context = await getBrowserRequestContext(c);
    const key = await getConnectedAppKey(context.db, {
      authUserId: context.authUserId,
      keyId: c.req.param("id"),
      patConfigId: MEMOS_PAT_CONFIG_ID,
    });
    if (!key) throw new NotFoundError("That connected app does not exist.");
    const { createFlareMoAuth } = await loadAuthFactory();
    const auth = createFlareMoAuth(c.env, context.db);
    await auth.api.updateApiKey({
      body: {
        configId: MEMOS_PAT_CONFIG_ID,
        keyId: key.id,
        userId: context.authUserId,
        enabled: false,
      },
    });
    await revokeRefreshTokensForAccessKey(context.db, key.id);
    return c.body(null, 204);
  } catch (error) {
    return jsonError(c, error);
  }
});
