import {
  assertMemberQuota,
  createFlaremoMemberWithLink,
  deleteFlaremoUser,
  deriveUniqueUsername,
  ForbiddenError,
  getAuthUserById,
  getAuthUserIdByFlaremoUserId,
  getUserRegistrationAllowed,
  listFlaremoUsers,
  NotFoundError,
  setUserRegistrationAllowed,
} from "@flaremo/domain";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { createFlareMoAuth } from "../auth";
import { getBrowserRequestContext, type HonoBindings } from "../context";
import { jsonError } from "../http";

export const adminApi = new Hono<HonoBindings>();

const updateSettingsSchema = z.object({
  registration_open: z.boolean(),
});

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(320),
  password: z.string().min(12).max(128),
});

async function ownerContext(c: Parameters<typeof getBrowserRequestContext>[0]) {
  const context = await getBrowserRequestContext(c);
  if (context.user.role !== "owner") {
    throw new ForbiddenError("Owner access is required.");
  }
  return context;
}

adminApi.get("/settings", async (c) => {
  try {
    const { db } = await ownerContext(c);
    return c.json({
      registration_open: await getUserRegistrationAllowed(db),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

adminApi.patch(
  "/settings",
  zValidator("json", updateSettingsSchema),
  async (c) => {
    try {
      const { db } = await ownerContext(c);
      const input = c.req.valid("json");
      await setUserRegistrationAllowed(db, input.registration_open);
      return c.json({
        registration_open: await getUserRegistrationAllowed(db),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

adminApi.get("/users", async (c) => {
  try {
    const { db } = await ownerContext(c);
    const users = await listFlaremoUsers(db);
    const rows = await Promise.all(
      users.map(async (user) => {
        const authUserId = await getAuthUserIdByFlaremoUserId(db, user.id);
        const authUser = authUserId
          ? await getAuthUserById(db, authUserId)
          : null;
        return {
          id: user.id,
          email: authUser?.email ?? user.email,
          name: user.name,
          username: authUser?.username ?? user.id.replace(/^users\//, ""),
          role: user.role,
          created_at: user.createdAt,
        };
      }),
    );
    return c.json({ users: rows });
  } catch (error) {
    return jsonError(c, error);
  }
});

adminApi.post("/users", zValidator("json", createUserSchema), async (c) => {
  try {
    const context = await ownerContext(c);
    const input = c.req.valid("json");
    const email = input.email;
    const username = await deriveUniqueUsername(context.db, email);
    // Pre-check before the Better Auth identity exists so a spent member
    // quota cannot orphan an auth user.
    await assertMemberQuota(context.db, context.limits);
    const auth = createFlareMoAuth(c.env, context.db, {
      allowBootstrapSignUp: true,
    });
    const result = await auth.api.signUpEmail({
      body: {
        email,
        name: input.name,
        password: input.password,
        username,
        displayUsername: input.name,
      },
    });
    const user = await createFlaremoMemberWithLink(
      context.db,
      {
        authUserId: result.user.id,
        email,
        name: input.name,
      },
      context.limits,
    );
    return c.json(
      {
        id: user.id,
        email,
        name: user.name,
        username,
        role: user.role,
        created_at: user.createdAt,
      },
      201,
    );
  } catch (error) {
    return jsonError(c, error);
  }
});

adminApi.delete("/users/:id", async (c) => {
  try {
    const context = await ownerContext(c);
    const id = c.req.param("id");
    if (id === context.user.id) {
      throw new ForbiddenError("You cannot delete your own account.");
    }
    if (!/^users\//.test(id)) {
      throw new NotFoundError("User not found");
    }
    await deleteFlaremoUser(context.db, id);
    return c.body(null, 200);
  } catch (error) {
    return jsonError(c, error);
  }
});

adminApi.post("/users/:id/reset-password", async (c) => {
  try {
    const context = await ownerContext(c);
    const id = c.req.param("id");
    const authUserId = await getAuthUserIdByFlaremoUserId(context.db, id);
    if (!authUserId) {
      throw new NotFoundError("User not found");
    }
    const auth = createFlareMoAuth(c.env, context.db);
    const token = await auth.createPasswordResetToken(authUserId);
    const response = c.json({
      token,
      reset_path: `/reset?token=${encodeURIComponent(token)}`,
      expires_in_seconds: 60 * 60,
    });
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return jsonError(c, error);
  }
});
