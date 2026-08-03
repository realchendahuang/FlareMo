import { createDb } from "@flaremo/db";
import {
  claimOwnerBootstrap,
  completeOwnerBootstrap,
  getAuthBootstrapStatus,
  markOwnerBootstrapRecoveryRequired,
} from "@flaremo/domain";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { createFlareMoAuth, getBootstrapSecret } from "../auth";
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
