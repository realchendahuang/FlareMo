import {
  ACCESS_TOKEN_TTL_DAYS,
  APP_CLIENT_TYPES,
  type AppClientType,
  DEVICE_CODE_GRANT_TYPE,
  type DeviceTokenErrorDto,
  type MemosPatScope,
  REFRESH_TOKEN_GRANT_TYPE,
} from "@flaremo/contracts";
import {
  attachAccessKey,
  createDeviceAuthorization,
  createRefreshToken,
  DeviceFlowError,
  getAppClientName,
  redeemDeviceAuthorization,
  revokeRefreshTokensForAccessKey,
  validateRefreshToken,
} from "@flaremo/domain";
import { Hono } from "hono";
import { z } from "zod";
import { getPublicUrl, MEMOS_PAT_CONFIG_ID } from "../auth-env";
import { getFlareMoDb, type HonoBindings, loadAuthFactory } from "../context";
import { jsonError } from "../http";
import { createMemosPersonalAccessToken } from "../memos-compat/pat";
import { checkRateLimit } from "../rate-limit";
import { zValidator } from "../validated";

/**
 * Public device-authorization endpoints (RFC 8628). These carry no session: the
 * client asks for codes, the user approves the pairing code in the browser, and
 * the client exchanges the device code for a token. See
 * docs/agent-access-design.md.
 */
export const connectApi = new Hono<HonoBindings>();

const deviceRequestSchema = z.object({
  client_name: z.string().trim().min(1).max(80),
  client_type: z.enum(APP_CLIENT_TYPES),
  scopes: z.array(z.enum(["notes", "admin"])).optional(),
});

/** Token endpoint bodies arrive as JSON (ours) or form-urlencoded (RFC 8628). */
async function readTokenBody(c: {
  req: {
    header: (name: string) => string | undefined;
    parseBody: () => Promise<Record<string, unknown>>;
  };
}): Promise<Record<string, string>> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await c.req.parseBody();
    return Object.fromEntries(
      Object.entries(form).map(([key, value]) => [key, String(value)]),
    );
  }
  return {};
}

function tokenError(
  status: 400 | 429,
  error: DeviceTokenErrorDto["error"],
  description?: string,
) {
  return Response.json(
    { error, ...(description ? { error_description: description } : {}) },
    { status, headers: { "cache-control": "no-store" } },
  );
}

connectApi.post(
  "/connect/device",
  zValidator("json", deviceRequestSchema),
  async (c) => {
    const throttled = await checkRateLimit(
      c.env.RATE_LIMITER,
      "connect-device",
      c.req.raw,
    );
    if (throttled) {
      return c.json(
        {
          error: "slow_down",
          error_description: "Too many pairing requests. Try again shortly.",
        },
        429,
        { "cache-control": "no-store" },
      );
    }
    const input = c.req.valid("json");
    try {
      const db = getFlareMoDb(c.env);
      const result = await createDeviceAuthorization(db, {
        clientName: input.client_name,
        clientType: input.client_type as AppClientType,
        scopes: input.scopes as MemosPatScope[] | undefined,
      });
      const publicUrl = getPublicUrl(c.env);
      return c.json(
        {
          device_code: result.deviceCode,
          user_code: result.userCode,
          verification_uri: `${publicUrl}/connect`,
          verification_uri_complete: `${publicUrl}/connect?code=${encodeURIComponent(result.userCode)}`,
          expires_in: Math.round(
            (Date.parse(result.expiresAt) - Date.now()) / 1000,
          ),
          interval: result.intervalSeconds,
        },
        200,
        { "cache-control": "no-store" },
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

connectApi.post("/connect/token", async (c) => {
  let body: Record<string, string>;
  try {
    body = await readTokenBody(c as never);
  } catch {
    body = {};
  }
  if (Object.keys(body).length === 0) {
    // JSON clients (DSH plugin) send `application/json`; accept that too.
    const json = (await c.req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (json && typeof json === "object") {
      body = Object.fromEntries(
        Object.entries(json).map(([key, value]) => [key, String(value)]),
      );
    }
  }
  const grantType = body.grant_type;
  const db = getFlareMoDb(c.env);

  if (grantType === DEVICE_CODE_GRANT_TYPE) {
    const deviceCode = body.device_code;
    if (!deviceCode) {
      return tokenError(400, "invalid_request", "device_code is required.");
    }
    const throttled = await checkRateLimit(
      c.env.RATE_LIMITER,
      "connect-token",
      c.req.raw,
      deviceCode.slice(0, 16),
    );
    if (throttled) {
      return c.json(
        {
          error: "slow_down",
          error_description: "Polling faster than the advertised interval.",
        },
        429,
        { "cache-control": "no-store" },
      );
    }
    try {
      const redeemed = await redeemDeviceAuthorization(db, deviceCode);
      const { createFlareMoAuth } = await loadAuthFactory();
      const auth = createFlareMoAuth(c.env, db);
      const clientName =
        (await getAppClientName(db, redeemed.clientId)) ?? "Connected app";
      const accessToken = await createMemosPersonalAccessToken(auth, {
        userId: redeemed.authUserId,
        name: `${clientName} (device)`,
        expiresInDays: ACCESS_TOKEN_TTL_DAYS,
        scopes: redeemed.scopes,
      });
      const refresh = await createRefreshToken(db, {
        clientId: redeemed.clientId,
        authUserId: redeemed.authUserId,
        accessKeyId: accessToken.id,
        scopes: redeemed.scopes,
      });
      return c.json(
        {
          access_token: accessToken.key,
          token_type: "Bearer",
          expires_in: ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60,
          refresh_token: refresh.token,
          scope: redeemed.scopes.join(" "),
        },
        200,
        { "cache-control": "no-store" },
      );
    } catch (error) {
      if (error instanceof DeviceFlowError) {
        return tokenError(400, error.code, error.message);
      }
      return jsonError(c, error);
    }
  }

  if (grantType === REFRESH_TOKEN_GRANT_TYPE) {
    const refreshToken = body.refresh_token;
    if (!refreshToken) {
      return tokenError(400, "invalid_request", "refresh_token is required.");
    }
    try {
      const validated = await validateRefreshToken(db, refreshToken);
      const { createFlareMoAuth } = await loadAuthFactory();
      const auth = createFlareMoAuth(c.env, db);
      const clientName =
        (await getAppClientName(db, validated.clientId)) ?? "Connected app";
      const accessToken = await createMemosPersonalAccessToken(auth, {
        userId: validated.authUserId,
        name: `${clientName} (device)`,
        expiresInDays: ACCESS_TOKEN_TTL_DAYS,
        scopes: validated.scopes,
      });
      // Rotation: the previous access token and refresh token stop working.
      if (validated.accessKeyId !== null) {
        await auth.api
          .updateApiKey({
            body: {
              configId: MEMOS_PAT_CONFIG_ID,
              keyId: validated.accessKeyId,
              userId: validated.authUserId,
              enabled: false,
            },
          })
          .catch(() => undefined);
        await revokeRefreshTokensForAccessKey(db, validated.accessKeyId);
      }
      const refresh = await createRefreshToken(db, {
        clientId: validated.clientId,
        authUserId: validated.authUserId,
        accessKeyId: accessToken.id,
        scopes: validated.scopes,
      });
      await attachAccessKey(db, {
        refreshTokenId: refresh.id,
        accessKeyId: accessToken.id,
      });
      return c.json(
        {
          access_token: accessToken.key,
          token_type: "Bearer",
          expires_in: ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60,
          refresh_token: refresh.token,
          scope: validated.scopes.join(" "),
        },
        200,
        { "cache-control": "no-store" },
      );
    } catch (error) {
      if (error instanceof DeviceFlowError) {
        return tokenError(400, error.code, error.message);
      }
      return jsonError(c, error);
    }
  }

  return tokenError(
    400,
    "unsupported_grant_type",
    "Only device_code and refresh_token grants are supported.",
  );
});
