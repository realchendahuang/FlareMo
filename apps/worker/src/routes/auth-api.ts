import { createDb } from "@flaremo/db";
import {
  claimOwnerBootstrap,
  completeOwnerBootstrap,
  getAuthBootstrapStatus,
  getOwnerAuthUserId,
  listMemosPersonalAccessTokens,
  markOwnerBootstrapRecoveryRequired,
  reconcileOwnerBootstrap,
} from "@flaremo/domain";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
  createFlareMoAuth,
  getBootstrapSecret,
  getRecoverySecret,
} from "../auth";
import type { HonoBindings } from "../context";
import { jsonError } from "../http";

export const authApi = new Hono<HonoBindings>();

const bootstrapSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(
      /^[A-Za-z0-9_]+$/,
      "Username may contain letters, numbers, and underscores.",
    ),
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(320),
  password: z.string().min(12).max(128),
});

const operatorRecoverySchema = z.object({
  new_password: z.string().min(12).max(128),
});

authApi.get("/bootstrap/status", async (c) => {
  const db = createDb(c.env.DB);
  const status = await getAuthBootstrapStatus(db);
  let authConfigured = false;
  try {
    createFlareMoAuth(c.env, db);
    authConfigured = true;
  } catch {
    authConfigured = false;
  }

  return c.json({
    initialized: status.initialized,
    state: status.state,
    setup_available:
      status.state === "ready" &&
      Boolean(getBootstrapSecret(c.env)) &&
      authConfigured,
  });
});

authApi.post("/bootstrap", zValidator("json", bootstrapSchema), async (c) => {
  const bootstrapSecret = getBootstrapSecret(c.env);
  if (!bootstrapSecret) {
    return c.json(
      { error: { message: "Initial setup is not configured." } },
      503,
    );
  }

  const suppliedSecret = c.req.header("x-flaremo-bootstrap-secret");
  if (!(await secretsMatch(suppliedSecret, bootstrapSecret))) {
    return c.json(
      { error: { message: "Initial setup is not authorized." } },
      403,
    );
  }

  const db = createDb(c.env.DB);
  let auth: ReturnType<typeof createFlareMoAuth>;
  try {
    auth = createFlareMoAuth(c.env, db, { allowBootstrapSignUp: true });
  } catch {
    return c.json(
      { error: { message: "Native authentication is not configured." } },
      503,
    );
  }

  const status = await getAuthBootstrapStatus(db);
  if (status.state !== "ready") {
    return c.json(
      {
        error: {
          message:
            "Initial setup is unavailable. Contact the administrator for recovery.",
        },
      },
      409,
    );
  }

  try {
    await claimOwnerBootstrap(db);
  } catch (error) {
    // A concurrent request can pass the initial status check before the
    // winner persists its singleton claim. Preserve the public 409 contract
    // instead of letting that expected conflict surface as a generic 500.
    return jsonError(c, error);
  }
  const input = c.req.valid("json");
  try {
    const result = await auth.api.signUpEmail({
      body: {
        email: input.email,
        name: input.name,
        password: input.password,
        username: input.username,
        displayUsername: input.username,
      },
    });
    await completeOwnerBootstrap(db, {
      authUserId: result.user.id,
      singleUser: { email: input.email, name: input.name },
    });
    return c.json({ ok: true }, 201);
  } catch {
    // At this point an auth identity may already have been created. Keep the
    // singleton fail-closed and require an intentional operator recovery
    // rather than risking a second owner initialization.
    await markOwnerBootstrapRecoveryRequired(db).catch(() => undefined);
    console.error(
      JSON.stringify({
        level: "error",
        message: "FlareMo owner bootstrap requires operator recovery",
      }),
    );
    return c.json(
      {
        error: {
          message:
            "Initial setup could not finish. Contact the administrator for recovery.",
        },
      },
      500,
    );
  }
});

/**
 * Break-glass recovery for an already completed single-user instance.
 *
 * This is deliberately not a public "forgot password" flow: no email
 * provider is configured yet, and the endpoint is disabled unless a separate
 * recovery secret is explicitly present. It preserves the existing owner
 * mapping and enters Better Auth's own one-time reset/password hashing flow.
 * Rotate or remove FLAREMO_RECOVERY_SECRET immediately after use.
 */
authApi.post(
  "/recover",
  zValidator("json", operatorRecoverySchema),
  async (c) => {
    const recoverySecret = getRecoverySecret(c.env);
    if (!recoverySecret) {
      return c.json(
        { error: { message: "Operator recovery is not configured." } },
        503,
      );
    }

    const suppliedSecret = c.req.header("x-flaremo-recovery-secret");
    if (!(await secretsMatch(suppliedSecret, recoverySecret))) {
      return c.json(
        { error: { message: "Operator recovery is not authorized." } },
        403,
      );
    }

    const db = createDb(c.env.DB);
    const authUserId = await getOwnerAuthUserId(db);
    if (!authUserId) {
      return c.json(
        {
          error: {
            message:
              "Operator recovery requires a completed single-user bootstrap.",
          },
        },
        409,
      );
    }

    const input = c.req.valid("json");
    try {
      const auth = createFlareMoAuth(c.env, db);
      // Password reset invalidates browser sessions through Better Auth. PATs
      // are a separate credential class, so revoke every existing Memos PAT
      // before changing the password as well.
      for (const token of await listMemosPersonalAccessTokens(db, authUserId)) {
        if (!token.enabled) continue;
        await auth.api.updateApiKey({
          body: {
            configId: "memos",
            keyId: token.id,
            userId: authUserId,
            enabled: false,
          },
        });
      }
      await auth.operatorResetPassword({
        authUserId,
        newPassword: input.new_password,
      });
      console.log(
        JSON.stringify({
          level: "info",
          message: "FlareMo operator password recovery completed",
        }),
      );
      return c.json({ ok: true });
    } catch {
      console.error(
        JSON.stringify({
          level: "error",
          message: "FlareMo operator password recovery failed",
        }),
      );
      return c.json(
        { error: { message: "Operator recovery could not complete." } },
        500,
      );
    }
  },
);

/**
 * Reconcile a partial owner bootstrap without accepting credentials or
 * caller-supplied identity data. The separate recovery secret keeps this
 * operator-only path closed by default and prevents it from becoming a second
 * signup flow.
 */
authApi.post("/recover-bootstrap", async (c) => {
  const recoverySecret = getRecoverySecret(c.env);
  if (!recoverySecret) {
    return c.json(
      { error: { message: "Operator recovery is not configured." } },
      503,
    );
  }

  const suppliedSecret = c.req.header("x-flaremo-recovery-secret");
  if (!(await secretsMatch(suppliedSecret, recoverySecret))) {
    return c.json(
      { error: { message: "Operator recovery is not authorized." } },
      403,
    );
  }

  const db = createDb(c.env.DB);
  try {
    await reconcileOwnerBootstrap(db);
    console.log(
      JSON.stringify({
        level: "info",
        message: "FlareMo owner bootstrap recovery completed",
      }),
    );
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, error);
  }
});

async function secretsMatch(
  supplied: string | undefined,
  expected: string,
): Promise<boolean> {
  if (!supplied) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}
