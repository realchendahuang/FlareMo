import {
  assertMemberQuota,
  beginFlaremoMemberRemoval,
  createFlaremoMemberWithLink,
  deriveUniqueUsername,
  ForbiddenError,
  finalizeFlaremoMemberRemoval,
  getAuthUserById,
  getAuthUserIdByFlaremoUserId,
  getFlaremoUserById,
  getUserRegistrationAllowed,
  isTeamAdmin,
  listFlaremoUsers,
  NotFoundError,
  setUserRegistrationAllowed,
  updateFlaremoUserRole,
} from "@flaremo/domain";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { cleanupFlaremoArtifacts } from "../artifact-cleanup";
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

const updateUserRoleSchema = z.object({
  role: z.enum(["admin", "member"]),
});

async function teamAdminContext(
  c: Parameters<typeof getBrowserRequestContext>[0],
) {
  const context = await getBrowserRequestContext(c);
  if (!isTeamAdmin(context.user)) {
    throw new ForbiddenError("Team administrator access is required.");
  }
  return context;
}

async function ownerContext(c: Parameters<typeof getBrowserRequestContext>[0]) {
  const context = await getBrowserRequestContext(c);
  if (context.user.role !== "owner") {
    throw new ForbiddenError("Owner access is required.");
  }
  return context;
}

// Kept as a compatibility endpoint for existing deployments and clients. The
// team-management UI does not expose this switch; adding members is the normal
// team-mode path and registration remains closed by default.
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
      await setUserRegistrationAllowed(
        db,
        c.req.valid("json").registration_open,
      );
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
    const { db } = await teamAdminContext(c);
    const members = await listFlaremoUsers(db);
    const rows = await Promise.all(
      members.map(async (member) => {
        const authUserId = await getAuthUserIdByFlaremoUserId(db, member.id);
        const authUser = authUserId
          ? await getAuthUserById(db, authUserId)
          : null;
        return {
          id: member.id,
          email: authUser?.email ?? member.email,
          name: member.name,
          username: authUser?.username ?? member.id.replace(/^users\//, ""),
          role: member.role,
          status: member.status,
          created_at: member.createdAt,
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
    const context = await teamAdminContext(c);
    const input = c.req.valid("json");
    const email = input.email;
    const username = await deriveUniqueUsername(context.db, email);
    // Check before Better Auth creates an identity so quota failures cannot
    // leave an orphaned login account.
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
    const member = await createFlaremoMemberWithLink(
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
        id: member.id,
        email,
        name: member.name,
        username,
        role: member.role,
        status: member.status,
        created_at: member.createdAt,
      },
      201,
    );
  } catch (error) {
    return jsonError(c, error);
  }
});

adminApi.patch(
  "/users/:id/role",
  zValidator("json", updateUserRoleSchema),
  async (c) => {
    try {
      const context = await teamAdminContext(c);
      const member = await updateFlaremoUserRole(
        context.db,
        c.req.param("id"),
        c.req.valid("json").role,
      );
      const authUserId = await getAuthUserIdByFlaremoUserId(
        context.db,
        member.id,
      );
      const authUser = authUserId
        ? await getAuthUserById(context.db, authUserId)
        : null;
      return c.json({
        id: member.id,
        email: authUser?.email ?? member.email,
        name: member.name,
        username: authUser?.username ?? member.id.replace(/^users\//, ""),
        role: member.role,
        status: member.status,
        created_at: member.createdAt,
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

adminApi.delete("/users/:id", async (c) => {
  try {
    const context = await teamAdminContext(c);
    const id = c.req.param("id");
    if (id === context.user.id) {
      throw new ForbiddenError("You cannot remove yourself from the team.");
    }
    if (!/^users\//.test(id)) {
      throw new NotFoundError("Member not found");
    }

    // Access is revoked before external cleanup starts. If R2 or Vectorize is
    // temporarily unavailable, retrying this endpoint safely resumes cleanup.
    const artifacts = await beginFlaremoMemberRemoval(context.db, id);
    await cleanupFlaremoArtifacts(c.env, artifacts);
    await finalizeFlaremoMemberRemoval(context.db, id, artifacts);
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, error);
  }
});

adminApi.post("/users/:id/reset-password", async (c) => {
  try {
    const context = await teamAdminContext(c);
    const id = c.req.param("id");
    const member = await getFlaremoUserById(context.db, id);
    if (member?.status !== "active") {
      throw new NotFoundError("Active member not found");
    }
    const authUserId = await getAuthUserIdByFlaremoUserId(context.db, id);
    if (!authUserId) {
      throw new NotFoundError("Member not found");
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
