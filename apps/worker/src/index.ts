import {
  createCurrentOpenApiDocument,
  createOpenApiDocument,
} from "@flaremo/contracts";
import { createDb } from "@flaremo/db";
import {
  beginFlaremoMemberRemoval,
  claimMemberRemovalJob,
  createDailyReviewNotifications,
  deleteExpiredDataTasks,
  dispatchEmbeddingOutbox,
  dispatchMemosWebhookOutbox,
  expireStaleDataTasks,
  failMemberRemovalJob,
  finalizeAttachmentCleanupForIds,
  finalizeFlaremoMemberRemoval,
  getQueuedMemberRemovalJobsByIds,
  listAttachmentCleanupCandidates,
  listQueuedMemberRemovalJobs,
  type PlanLimits,
  parseUserPlanLimits,
  requeueStaleMemberRemovalJobs,
  SELF_HOST_UNLIMITED,
  type UserPlanLimits,
  updateMemberRemovalJob,
} from "@flaremo/domain";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { cleanupFlaremoArtifacts } from "./artifact-cleanup";
import { getTrustedOrigins } from "./auth";
import {
  assertTrustedCookieMutation,
  getFlareMoRuntime,
  getRequestContext,
  type HonoBindings,
} from "./context";
import { createEmbeddingProvider, createVectorIndex } from "./embedding";
import type { FlareMoEnv } from "./env";
import { jsonError } from "./http";
import { betterAuthRateLimitBucket, rateLimitGuard } from "./rate-limit";
import { accountApi } from "./routes/account-api";
import { adminApi } from "./routes/admin-api";
import { appApi } from "./routes/app-api";
import { authApi } from "./routes/auth-api";
import { mcpApi, mcpStreamableApi } from "./routes/mcp";
import { memoryApi } from "./routes/memory-api";
import { memoryMcpApi } from "./routes/memory-mcp";
import { memosApi } from "./routes/memos-api";
import { memosConnectApi } from "./routes/memos-connect-api";
import {
  isLegacyWireRequest,
  memosCurrentApi,
} from "./routes/memos-current-api";
import { memosFileApi } from "./routes/memos-file-api";
import { memosSocialApi } from "./routes/memos-social-api";
import { memosSseApi } from "./routes/memos-sse";
import { projectsApi } from "./routes/projects-api";
import { publicApi } from "./routes/public-api";
import { tasksApi } from "./routes/tasks-api";

/**
 * Kernel assembly entry. Every call returns a fresh Hono instance so hosts
 * (the default worker, tests, or an external composition shell) can mount
 * extra middleware/routes without mutating shared state.
 *
 * The default limits resolver is the self-hosted unlimited plan; an external
 * composition shell may inject a subscription-backed resolver without this
 * file knowing anything about billing.
 */
export type FlareMoAppOptions = {
  resolvePlanLimits?: (env: FlareMoEnv) => Promise<PlanLimits> | PlanLimits;
  /**
   * Per-user limits for shared deployments (e.g. public sign-up instances).
   * Defaults to the FLAREMO_USER_LIMITS_JSON env payload, which is user-agnostic.
   * External composition shells may resolve per-user plans here; subscription concepts stay
   * outside the kernel — this only ever returns numbers-or-null.
   */
  resolveUserPlanLimits?: (
    env: FlareMoEnv,
    userId: string,
  ) => Promise<UserPlanLimits | null> | UserPlanLimits | null;
};

type ResolvedFlareMoOptions = Required<FlareMoAppOptions>;

function resolveFlareMoOptions(
  options: FlareMoAppOptions,
): ResolvedFlareMoOptions {
  return {
    resolvePlanLimits:
      options.resolvePlanLimits ?? ((_env: FlareMoEnv) => SELF_HOST_UNLIMITED),
    resolveUserPlanLimits:
      options.resolveUserPlanLimits ??
      ((env: FlareMoEnv) => parseUserPlanLimits(env.FLAREMO_USER_LIMITS_JSON)),
  };
}

export function createFlareMoApp(
  options: FlareMoAppOptions = {},
): Hono<HonoBindings> {
  const { resolvePlanLimits, resolveUserPlanLimits } =
    resolveFlareMoOptions(options);
  const app = new Hono<HonoBindings>();

  app.use("*", async (c, next) => {
    c.set("planLimits", await resolvePlanLimits(c.env));
    c.set("resolveUserPlanLimits", resolveUserPlanLimits);
    await next();
  });

  app.use(
    "/api/*",
    cors({
      origin: (origin, c) => {
        try {
          return getTrustedOrigins(c.env).includes(origin) ? origin : undefined;
        } catch {
          return undefined;
        }
      },
      credentials: true,
      allowHeaders: [
        "content-type",
        "authorization",
        // Access remains an optional outer policy during migration. Keep its
        // established service-token headers available to trusted CORS origins;
        // they never replace the FlareMo session/PAT check below the edge.
        "cf-access-client-id",
        "cf-access-client-secret",
        "x-flaremo-bootstrap-secret",
      ],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.use(
    "/mcp",
    cors({
      origin: (origin, c) => {
        try {
          return getTrustedOrigins(c.env).includes(origin) ? origin : undefined;
        } catch {
          return undefined;
        }
      },
      credentials: false,
      allowHeaders: [
        "content-type",
        "authorization",
        "accept",
        "mcp-session-id",
      ],
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    }),
  );

  app.use(
    "/memos.api.v1.*",
    cors({
      origin: (origin, c) => {
        try {
          return getTrustedOrigins(c.env).includes(origin) ? origin : undefined;
        } catch {
          return undefined;
        }
      },
      credentials: true,
      allowHeaders: [
        "content-type",
        "authorization",
        "accept",
        "connect-protocol-version",
        "grpc-accept-encoding",
        "grpc-encoding",
        "grpc-timeout",
        "x-grpc-web",
        "x-user-agent",
      ],
      exposeHeaders: ["grpc-status", "grpc-message", "grpc-status-details-bin"],
      allowMethods: ["POST", "OPTIONS"],
    }),
  );

  // Better Auth's own handler also mutates the browser session. Keep its
  // endpoints under the same exact-origin contract as the application routes;
  // the handler's trustedOrigins setting is not a substitute for requiring an
  // Origin header on unsafe cookie requests.
  app.use("/api/auth/*", async (c, next) => {
    try {
      assertTrustedCookieMutation(c);
      return await next();
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.route("/api/auth/flaremo", authApi);
  app.all("/api/auth/*", async (c) => {
    // Edge-throttle Better Auth's credential endpoints (sign-in, sign-up,
    // password reset) per client IP. The bucket is null for session reads
    // and other non-credential paths.
    const bucket = betterAuthRateLimitBucket(new URL(c.req.raw.url).pathname);
    if (bucket) {
      const throttled = await rateLimitGuard(c, bucket);
      if (throttled) return throttled;
    }
    return getFlareMoRuntime(c.env).auth.handler(c.req.raw);
  });
  app.route("/api/app/account", accountApi);
  app.route("/api/app/admin", adminApi);
  app.route("/api/app/memory", memoryApi);
  app.route("/api/app/projects", projectsApi);
  app.route("/api/app/tasks", tasksApi);
  app.route("/api/app", appApi);
  app.route("/api/public", publicApi);
  app.route("/file", memosFileApi);
  app.route("/mcp", mcpStreamableApi);
  app.route("/memory/mcp", memoryMcpApi);
  app.route("/", memosConnectApi);
  app.route("/", memosSseApi);
  app.route("/api/v1", memosSocialApi);
  app.route("/api/v1", memosCurrentApi);
  app.route("/api/v1", memosApi);
  app.route("/api/v1", mcpApi);

  app.get("/openapi.json", (c) =>
    c.json(
      isLegacyWireRequest(c)
        ? createOpenApiDocument()
        : createCurrentOpenApiDocument(),
    ),
  );
  app.get("/api/v1/openapi.json", async (c) => {
    try {
      await getRequestContext(c);
      return c.json(
        isLegacyWireRequest(c)
          ? createOpenApiDocument()
          : createCurrentOpenApiDocument(),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: { message: "Not found" } }, 404);
    }
    return c.env.ASSETS.fetch(c.req.raw).then((response) => {
      // Vite asset filenames contain a content hash. They are safe to cache
      // for a year; HTML and application routes remain revalidated normally.
      if (/^\/assets\/[A-Za-z0-9._-]+-[A-Za-z0-9]{8,}\./.test(c.req.path)) {
        const headers = new Headers(response.headers);
        headers.set("cache-control", "public, max-age=31536000, immutable");
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }
      return response;
    });
  });

  return app;
}

/**
 * Daily maintenance run: dispatch webhook + embedding outboxes, clean up
 * orphaned attachments and expired data-transfer tasks, and file "on this
 * day" review notifications. Exported so a shared-instance shell (hosted
 * composition) can drive the exact same sequence without mirroring it.
 */
export async function runScheduledMaintenance(
  env: FlareMoEnv,
  scheduledTime: number,
  options: {
    limits?: PlanLimits;
    userLimits?: UserPlanLimits | null;
    resolveUserLimits?: (
      userId: string,
    ) => Promise<UserPlanLimits | null> | UserPlanLimits | null;
    removalJobIds?: string[];
  } = {},
): Promise<void> {
  const db = createDb(env.DB);
  await requeueStaleMemberRemovalJobs(db, scheduledTime);
  const removalJobs = options.removalJobIds
    ? await getQueuedMemberRemovalJobsByIds(db, options.removalJobIds)
    : await listQueuedMemberRemovalJobs(db);
  for (const job of removalJobs) {
    try {
      if (!(await claimMemberRemovalJob(db, job.id))) continue;
      await updateMemberRemovalJob(db, job.id, {
        attempts: (job.attempts ?? 0) + 1,
      });
      const artifacts = await beginFlaremoMemberRemoval(db, job.memberId);
      await updateMemberRemovalJob(db, job.id, { phase: "cleaning_artifacts" });
      await cleanupFlaremoArtifacts(env, artifacts);
      await finalizeFlaremoMemberRemoval(db, job.memberId, artifacts);
      await updateMemberRemovalJob(db, job.id, {
        status: "completed",
        phase: "completed",
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      await failMemberRemovalJob(
        db,
        job.id,
        "scheduled_member_removal_failed",
        error instanceof Error ? error.message : "Member removal failed",
      ).catch(() => undefined);
      // Propagate the failure so Queue does not acknowledge the batch. The
      // platform can then apply its configured retry policy.
      if (options.removalJobIds) throw error;
    }
  }
  await dispatchMemosWebhookOutbox(db);
  await dispatchEmbeddingOutbox(db, {
    provider: createEmbeddingProvider(env),
    memosIndex: createVectorIndex(env, "memo"),
    memoriesIndex: createVectorIndex(env, "memory"),
    limits: options.limits ?? SELF_HOST_UNLIMITED,
    userLimits:
      options.userLimits === undefined
        ? parseUserPlanLimits(env.FLAREMO_USER_LIMITS_JSON)
        : options.userLimits,
    resolveUserLimits: options.resolveUserLimits,
  });
  const cutoff = new Date(scheduledTime - 24 * 60 * 60 * 1_000).toISOString();
  const candidates = await listAttachmentCleanupCandidates(db, cutoff);
  const objectKeys = candidates.map((attachment) => attachment.r2Key);
  if (objectKeys.length > 0) {
    await env.ATTACHMENTS.delete(objectKeys);
  }
  await finalizeAttachmentCleanupForIds(
    db,
    candidates.map((attachment) => attachment.id),
  );
  // Reconcile data-transfer tasks: expire stale queued/running tasks whose
  // lease lapsed (interrupted request), then garbage-collect completed task
  // rows older than the TTL along with their R2 export artifacts.
  const staleCount = await expireStaleDataTasks(db);
  const expiredIds = await deleteExpiredDataTasks(db);
  for (const id of expiredIds) {
    const prefix = `exports/${id}`;
    let cursor: string | undefined;
    do {
      const listing = await env.ATTACHMENTS.list({ prefix, cursor });
      const keys = listing.objects.map((object) => object.key);
      if (keys.length > 0) await env.ATTACHMENTS.delete(keys);
      cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor);
  }
  // Daily review reach-out: file one idempotent inbox row per user when the
  // UTC calendar day has "on this day" history. The source-event unique
  // index absorbs cron retries, so a repeat run for the same date is a no-op.
  const reviewDate = new Date(scheduledTime).toISOString().slice(0, 10);
  const reviewNotificationCount = await createDailyReviewNotifications(db, {
    date: reviewDate,
  });
  console.log(
    JSON.stringify({
      message: "attachment cleanup complete",
      count: candidates.length,
      staleTaskCount: staleCount,
      expiredTaskCount: expiredIds.length,
      reviewNotificationCount,
      scheduledTime,
    }),
  );
}

async function dispatchRequestEmbeddingOutbox(
  env: FlareMoEnv,
  options: ResolvedFlareMoOptions,
  hasCustomUserPlanLimits: boolean,
) {
  await dispatchEmbeddingOutbox(createDb(env.DB), {
    provider: createEmbeddingProvider(env),
    memosIndex: createVectorIndex(env, "memo"),
    memoriesIndex: createVectorIndex(env, "memory"),
    limits: await options.resolvePlanLimits(env),
    userLimits: hasCustomUserPlanLimits
      ? null
      : parseUserPlanLimits(env.FLAREMO_USER_LIMITS_JSON),
    resolveUserLimits: hasCustomUserPlanLimits
      ? (userId) => options.resolveUserPlanLimits(env, userId)
      : undefined,
  });
}

/**
 * Build the complete Worker lifecycle for an installation of FlareMo.
 *
 * `createFlareMoApp` intentionally only assembles HTTP routes so tests and
 * advanced hosts can mount it. Production entrypoints should use this factory:
 * it keeps request outbox dispatch and Cron maintenance coupled to the same
 * plan-limit policy as the HTTP application.
 */
export function createFlareMoWorker(
  options: FlareMoAppOptions = {},
): ExportedHandler<FlareMoEnv> {
  const resolvedOptions = resolveFlareMoOptions(options);
  const hasCustomUserPlanLimits = options.resolveUserPlanLimits !== undefined;
  // The Hono app closes only over the resolved options — route modules are
  // constants and everything else reads c.env per request — so one instance
  // serves every request of this isolate instead of rebuilding the full
  // middleware and route table per request.
  const app = createFlareMoApp(resolvedOptions);

  return {
    async fetch(request, env, ctx) {
      const response = await app.fetch(request, env, ctx);
      const db = createDb(env.DB);
      // `ExecutionContext` is part of the Worker handler contract. Keeping
      // this post-response work on `waitUntil` avoids changing the route-only
      // test semantics for direct handler calls without a Worker runtime.
      ctx?.waitUntil(dispatchMemosWebhookOutbox(db).catch(() => undefined));
      ctx?.waitUntil(
        dispatchRequestEmbeddingOutbox(
          env,
          resolvedOptions,
          hasCustomUserPlanLimits,
        ).catch(() => undefined),
      );
      return response;
    },
    async scheduled(controller, env) {
      await runScheduledMaintenance(env, controller.scheduledTime, {
        limits: await resolvedOptions.resolvePlanLimits(env),
        userLimits: hasCustomUserPlanLimits
          ? null
          : parseUserPlanLimits(env.FLAREMO_USER_LIMITS_JSON),
        resolveUserLimits: hasCustomUserPlanLimits
          ? (userId) => resolvedOptions.resolveUserPlanLimits(env, userId)
          : undefined,
      });
    },
    async queue(batch, env) {
      // The queue shares the same idempotent executor as scheduled maintenance
      // so retries cannot diverge from the daily recovery path.
      await runScheduledMaintenance(env, Date.now(), {
        limits: await resolvedOptions.resolvePlanLimits(env),
        userLimits: hasCustomUserPlanLimits
          ? null
          : parseUserPlanLimits(env.FLAREMO_USER_LIMITS_JSON),
        resolveUserLimits: hasCustomUserPlanLimits
          ? (userId) => resolvedOptions.resolveUserPlanLimits(env, userId)
          : undefined,
        // A malformed body can never become valid on retry — drop it here so
        // the batch ack removes the poison message instead of looping.
        removalJobIds: batch.messages.flatMap((message) => {
          const jobId = (message.body as { jobId?: unknown }).jobId;
          if (typeof jobId !== "string" || !jobId) {
            console.warn(
              JSON.stringify({
                message: "Discarded malformed member-removal queue message",
              }),
            );
            return [];
          }
          return [jobId];
        }),
      });
      for (const message of batch.messages) message.ack();
    },
  };
}

export default createFlareMoWorker();
