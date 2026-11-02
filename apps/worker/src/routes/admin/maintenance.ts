import {
  beginFlaremoMemberRemoval,
  createMemberRemovalJob,
  ForbiddenError,
  failMemberRemovalJob,
  finalizeFlaremoMemberRemoval,
  getAuthUserIdByFlaremoUserId,
  getFlaremoUserById,
  getMemberRemovalJob,
  isTeamOwner,
  listMemberRemovalJobs,
  NotFoundError,
  rebuildEmbeddingIndexes,
  updateMemberRemovalJob,
  ValidationError,
} from "@flaremo/domain";
import type { Hono } from "hono";
import { cleanupFlaremoArtifacts } from "../../artifact-cleanup";
import {
  getBrowserRequestContext,
  type HonoBindings,
  loadAuthFactory,
} from "../../context";
import { createEmbeddingProvider, createVectorIndex } from "../../embedding";
import { jsonError } from "../../http";
import {
  ownerContext,
  teamAdminContext,
  teamAdminSessionContext,
  teamMembershipInfo,
} from "./context";

export function registerMaintenanceRoutes(app: Hono<HonoBindings>) {
  app.delete("/users/:id", async (c) => {
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
      // Peer protection: only the team owner removes administrators.
      const targetRole =
        (await teamMembershipInfo(context.db, id))?.role ?? null;
      if (targetRole === "admin" && !isTeamOwner(context.user)) {
        throw new ForbiddenError(
          "Only the team owner can remove an administrator.",
        );
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
      await updateMemberRemovalJob(context.db, job.id, {
        phase: "finalizing",
      });
      await finalizeFlaremoMemberRemoval(context.db, id, artifacts);
      const completed = await updateMemberRemovalJob(context.db, job.id, {
        status: "completed",
        phase: "completed",
        completedAt: new Date().toISOString(),
      });
      return c.json({ ok: true, job: completed });
    } catch (error) {
      if (jobId) {
        const context = await getBrowserRequestContext(c).catch(
          () => undefined,
        );
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

  app.get("/member-removal-jobs", async (c) => {
    try {
      const context = await teamAdminContext(c);
      return c.json({ jobs: await listMemberRemovalJobs(context.db) });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/member-removal-jobs/:id", async (c) => {
    try {
      const context = await teamAdminContext(c);
      const job = await getMemberRemovalJob(context.db, c.req.param("id"));
      if (!job) throw new NotFoundError("Removal job not found");
      return c.json({ job });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/member-removal-jobs/:id/retry", async (c) => {
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
  app.post("/embeddings/rebuild", async (c) => {
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

  app.post("/users/:id/reset-password", async (c) => {
    try {
      // Mints a password-reset token; browser session only.
      const context = await teamAdminSessionContext(c);
      const id = c.req.param("id");
      const member = await getFlaremoUserById(context.db, id);
      if (member?.status !== "active") {
        throw new NotFoundError("Active member not found");
      }
      // A reset token mints a credential — apply the same takeover guard as
      // role changes and member removal: administrators cannot touch the owner
      // or another administrator; only the owner can.
      if (id === "users/owner") {
        throw new ForbiddenError(
          "The owner password cannot be reset through the admin API.",
        );
      }
      const targetRole =
        (await teamMembershipInfo(context.db, id))?.role ?? null;
      if (targetRole === "admin" && !isTeamOwner(context.user)) {
        throw new ForbiddenError(
          "Only the owner can reset another administrator's password.",
        );
      }
      const authUserId = await getAuthUserIdByFlaremoUserId(context.db, id);
      if (!authUserId) {
        throw new NotFoundError("Member not found");
      }
      const { createFlareMoAuth } = await loadAuthFactory();
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
}
