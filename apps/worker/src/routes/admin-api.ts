import {
  assertMemberQuota,
  beginFlaremoMemberRemoval,
  createFlaremoMemberWithLink,
  createMemberRemovalJob,
  deriveUniqueUsername,
  ForbiddenError,
  failMemberRemovalJob,
  finalizeFlaremoMemberRemoval,
  getAuthUserById,
  getAuthUserIdByFlaremoUserId,
  getFlaremoUserById,
  getMemberRemovalJob,
  getUserRegistrationAllowed,
  isOwner,
  isTeamAdmin,
  listFlaremoUsers,
  listMemberRemovalJobs,
  NotFoundError,
  rebuildEmbeddingIndexes,
  setUserRegistrationAllowed,
  updateFlaremoUserRole,
  updateMemberRemovalJob,
  ValidationError,
} from "@flaremo/domain";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { cleanupFlaremoArtifacts } from "../artifact-cleanup";
import { createFlareMoAuth } from "../auth";
import { getBrowserRequestContext, type HonoBindings } from "../context";
import { createEmbeddingProvider, createVectorIndex } from "../embedding";
import { jsonError } from "../http";

export const adminApi = new Hono<HonoBindings>();

const updateSettingsSchema = z.object({
  registration_open: z.boolean(),
});

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(320),
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
  if (!isOwner(context.user)) {
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
        // Administrators never choose or receive a member password. The
        // one-time reset token below is the activation credential.
        password: `${crypto.randomUUID()}-${crypto.randomUUID()}Aa1!`,
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
    const activationToken = await auth.createPasswordResetToken(result.user.id);
    return c.json(
      {
        id: member.id,
        email,
        name: member.name,
        username,
        role: member.role,
        status: member.status,
        created_at: member.createdAt,
        activation_path: `/reset?token=${encodeURIComponent(activationToken)}`,
        activation_expires_in_seconds: 60 * 60,
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
  let jobId: string | undefined;
  try {
    const context = await teamAdminContext(c);
    const id = c.req.param("id");
    if (id === context.user.id) {
      throw new ForbiddenError("You cannot remove yourself from the team.");
    }
    if (!/^users\//.test(id)) {
      throw new NotFoundError("Member not found");
    }

    const job = await createMemberRemovalJob(context.db, id, context.user.id);
    jobId = job.id;
    // Artifact cleanup fans out to thousands of Vectorize/R2 deletes for a
    // large member — far beyond the request subrequest budget. Hand the
    // idempotent executor to the queue; only queue-less minimal deployments
    // run it inline.
    if (c.env.MEMBER_REMOVAL_QUEUE) {
      await c.env.MEMBER_REMOVAL_QUEUE.send({ jobId: job.id });
      return c.json({ ok: true, job }, 202);
    }
    await updateMemberRemovalJob(context.db, job.id, {
      status: "removing",
      phase: "revoking_access",
      attempts: (job.attempts ?? 0) + 1,
    });
    const artifacts = await beginFlaremoMemberRemoval(context.db, id);
    await updateMemberRemovalJob(context.db, job.id, {
      phase: "cleaning_artifacts",
    });
    await cleanupFlaremoArtifacts(c.env, artifacts);
    await updateMemberRemovalJob(context.db, job.id, { phase: "finalizing" });
    await finalizeFlaremoMemberRemoval(context.db, id, artifacts);
    const completed = await updateMemberRemovalJob(context.db, job.id, {
      status: "completed",
      phase: "completed",
      completedAt: new Date().toISOString(),
    });
    return c.json({ ok: true, job: completed });
  } catch (error) {
    if (jobId) {
      const context = await getBrowserRequestContext(c).catch(() => undefined);
      if (context) {
        await failMemberRemovalJob(
          context.db,
          jobId,
          "member_removal_failed",
          error instanceof Error ? error.message : "Member removal failed",
        ).catch(() => undefined);
      }
    }
    return jsonError(c, error);
  }
});

adminApi.get("/member-removal-jobs", async (c) => {
  try {
    const context = await teamAdminContext(c);
    return c.json({ jobs: await listMemberRemovalJobs(context.db) });
  } catch (error) {
    return jsonError(c, error);
  }
});

adminApi.get("/member-removal-jobs/:id", async (c) => {
  try {
    const context = await teamAdminContext(c);
    const job = await getMemberRemovalJob(context.db, c.req.param("id"));
    if (!job) throw new NotFoundError("Removal job not found");
    return c.json({ job });
  } catch (error) {
    return jsonError(c, error);
  }
});

adminApi.post("/member-removal-jobs/:id/retry", async (c) => {
  try {
    const context = await teamAdminContext(c);
    const id = c.req.param("id");
    const job = await getMemberRemovalJob(context.db, id);
    if (!job) throw new NotFoundError("Removal job not found");
    if (job.status !== "failed") {
      throw new ForbiddenError("Only failed removal jobs can be retried.");
    }
    const retried = await updateMemberRemovalJob(context.db, id, {
      status: "queued",
      phase: "retry_queued",
      attempts: (job.attempts ?? 0) + 1,
      errorCode: null,
      errorMessage: null,
      completedAt: null,
    });
    await c.env.MEMBER_REMOVAL_QUEUE?.send({ jobId: id });
    return c.json({ job: retried }, 202);
  } catch (error) {
    return jsonError(c, error);
  }
});

// Owner-only recovery path: re-embed every memo and memory from D1 into the
// vector indexes. Used after model/dimension changes or index corruption;
// the ops runbook documents it as the outbox/repair trigger.
adminApi.post("/embeddings/rebuild", async (c) => {
  try {
    const context = await ownerContext(c);
    const provider = createEmbeddingProvider(c.env);
    const memosIndex = createVectorIndex(c.env, "memo");
    const memoriesIndex = createVectorIndex(c.env, "memory");
    if (!provider || !memosIndex || !memoriesIndex) {
      throw new ValidationError(
        "Embedding provider or vector indexes are not configured.",
      );
    }
    const result = await rebuildEmbeddingIndexes(context.db, {
      provider,
      memosIndex,
      memoriesIndex,
    });
    return c.json(result);
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
    // A reset token mints a credential — apply the same takeover guard as
    // role changes and member removal: admins cannot touch the owner, and
    // only the owner can reset another admin.
    if (id === "users/owner") {
      throw new ForbiddenError(
        "The owner password cannot be reset through the admin API.",
      );
    }
    if (member.role === "admin" && !isOwner(context.user)) {
      throw new ForbiddenError(
        "Only the owner can reset another administrator's password.",
      );
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
