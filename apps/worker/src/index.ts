import { createOpenApiDocument } from "@flaremo/contracts/openapi";
import { createCurrentOpenApiDocument } from "@flaremo/contracts/openapi-current";
import { createDb } from "@flaremo/db";
import {
  dispatchEmbeddingOutbox,
  dispatchMemosWebhookOutbox,
  getBranding,
  type PlanLimits,
  parseUserPlanLimits,
  SELF_HOST_UNLIMITED,
  type UserPlanLimits,
} from "@flaremo/domain";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getTrustedOrigins } from "./auth-env";
import {
  assertTrustedCookieMutation,
  getFlareMoAuthHandler,
  getFlareMoDb,
  getRequestContext,
  type HonoBindings,
} from "./context";
import { createEmbeddingProvider, createVectorIndex } from "./embedding";
import type { FlareMoEnv } from "./env";
import { jsonError } from "./http";
import { resolveOauthIntegration } from "./integrations/config";
import { betterAuthRateLimitBucket, rateLimitGuard } from "./rate-limit";

// Cron/queue maintenance surface moved to its own module; re-exported so the
// original import path (./index) keeps serving it verbatim.
export { runQueuedJobs, runScheduledMaintenance } from "./scheduled-tasks";

import { mountLazyRoute, mountLazySsrPages } from "./lazy-routes";
import { accountApi } from "./routes/account-api";
import { adminApi } from "./routes/admin-api";
import { appApi } from "./routes/app-api";
import { authApi } from "./routes/auth-api";
import { brandingApi } from "./routes/branding-api";
import { emailSettingsApi } from "./routes/email-settings-api";
import { memoryApi } from "./routes/memory-api";
import { memosApi } from "./routes/memos-api";
import { memosConnectApi } from "./routes/memos-connect";
import { isLegacyWireRequest, memosCurrentApi } from "./routes/memos-current";
import { memosFileApi } from "./routes/memos-file-api";
import { memosSocialApi } from "./routes/memos-social-api";
import { memosSseApi } from "./routes/memos-sse";
import { oauthSettingsApi } from "./routes/oauth-settings-api";
import { pluginsApi } from "./routes/plugins-api";
import { pluginsStoreApi } from "./routes/plugins-store-api";
import { projectsApi } from "./routes/projects-api";
import { publicApi } from "./routes/public-api";
import { tasksApi } from "./routes/tasks-api";
import { runQueuedJobs, runScheduledMaintenance } from "./scheduled-tasks";
import { isKnownFrontendPath } from "./spa-routes";

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

// The documents are pure data built from literals; caching them keeps
// /openapi.json from re-allocating a few thousand objects per request.
let legacyOpenApiDocument: ReturnType<typeof createOpenApiDocument> | undefined;
let currentOpenApiDocument:
  | ReturnType<typeof createCurrentOpenApiDocument>
  | undefined;

function getLegacyOpenApiDocument() {
  legacyOpenApiDocument ??= createOpenApiDocument();
  return legacyOpenApiDocument;
}

function getCurrentOpenApiDocument() {
  currentOpenApiDocument ??= createCurrentOpenApiDocument();
  return currentOpenApiDocument;
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
    // OAuth-aware: returns the runtime default auth unless the instance has
    // social providers configured, in which case a rebuilt instance carries
    // the provider credentials (cached by revision).
    const auth = await getFlareMoAuthHandler(c.env);
    return auth.handler(c.req.raw);
  });
  // Anonymous surface for the login page: which social providers the
  // instance has enabled (ids only — no client IDs, no secrets).
  app.get("/api/app/auth-providers", async (c) => {
    // Direct resolve (no TTL cache): the login page must reflect an owner's
    // fresh provider config on the next reload.
    const db = getFlareMoDb(c.env);
    const oauth = await resolveOauthIntegration(c.env, db);
    return c.json(
      { google: Boolean(oauth.google), github: Boolean(oauth.github) },
      200,
      { "Cache-Control": "no-store" },
    );
  });
  app.route("/api/app/branding", brandingApi);
  app.route("/api/app/plugins", pluginsApi);
  // Voice settings + capture (ASR) are the heavy low-traffic tree: lazily
  // imported so the isolate only pays the ASR module graph when voice is used.
  mountLazyRoute(app, "/api/app/capture", async () => {
    const { captureApi } = await import("./routes/capture-api");
    return captureApi;
  });
  mountLazyRoute(app, "/api/app/voice-settings", async () => {
    const { voiceSettingsApi } = await import("./routes/voice-settings-api");
    return voiceSettingsApi;
  });
  app.route("/api/app/account", accountApi);
  // Registered before adminApi so these owner settings routes win; paths
  // adminApi owns (/plugins GET/PUT) still fall through to it.
  app.route("/api/app/admin/plugins", pluginsStoreApi);
  app.route("/api/app/admin/email-settings", emailSettingsApi);
  app.route("/api/app/admin/oauth-settings", oauthSettingsApi);
  app.route("/api/app/admin", adminApi);
  app.route("/api/app/memory", memoryApi);
  app.route("/api/app/projects", projectsApi);
  // The articles API is a low-traffic tree with real sub-paths (`/:id`,
  // `/:id/publish`, …), so the wildcard registration is required. Lazy mounting
  // keeps the route module itself out of the isolate startup graph; the sub-app
  // shape is the `app.route()` contract (paths relative to the mount prefix),
  // which is what mountLazyRoute re-bases against.
  mountLazyRoute(app, "/api/app/articles", async () => {
    const { articlesApi } = await import("./routes/articles-api");
    return articlesApi;
  });
  app.route("/api/app/tasks", tasksApi);
  app.route("/api/app", appApi);
  app.route("/api/public", publicApi);
  // SSR public pages (share/article + sitemap/feed): the largest lazy win —
  // marked/shiki-core/sitemap/feed only parse when one of the five public page
  // paths is actually requested.
  //
  // Route lazy-mounting cannot reach everything, though, and it is worth being
  // precise about why. The `@flaremo/domain` barrel is statically imported by
  // this file for half a dozen unrelated symbols, and a value `export *` keeps
  // its whole subtree alive no matter which routes are lazy. So `cel-js` stays
  // on the startup graph by way of `memo-filter/environment`. `transliteration`
  // used to be pinned the same way, through `articles.ts`; that one is gone,
  // but only because `articles.ts` now defers the `slugify` import to call time
  // rather than because the route moved. Verified by walking the bundler's
  // static-import edges, not by reading a sourcemap — a module's code staying
  // in the uploaded file says nothing about whether it runs at startup.
  // Issue #138.
  mountLazySsrPages(app);
  app.get("/favicon.ico", async (c) => {
    // Only browsers without a <link rel="icon"> hit this; redirect to the
    // custom favicon when one is configured, else to the bundled asset.
    try {
      const branding = await getBranding(getFlareMoDb(c.env));
      if (branding.favicon) {
        return c.redirect(
          `/api/app/branding/favicon?v=${encodeURIComponent(branding.favicon.updated_at)}`,
          302,
        );
      }
    } catch {
      // Fall through to the bundled asset.
    }
    return c.redirect("/brand/flaremo-mark-light-300.png", 302);
  });
  app.route("/file", memosFileApi);
  // MCP surfaces + memory MCP: low-traffic tooling endpoints; the route trees
  // (and their module graphs) load on first MCP request instead of startup.
  mountLazyRoute(app, "/mcp", async () => {
    const { mcpStreamableApi } = await import("./routes/mcp");
    return mcpStreamableApi;
  });
  mountLazyRoute(app, "/memory/mcp", async () => {
    const { memoryMcpApi } = await import("./routes/memory-mcp");
    return memoryMcpApi;
  });
  app.route("/", memosConnectApi);
  app.route("/", memosSseApi);
  app.route("/api/v1", memosSocialApi);
  app.route("/api/v1", memosCurrentApi);
  app.route("/api/v1", memosApi);
  // The legacy JSON-RPC MCP is mcpApi.post("/mcp") mounted under /api/v1 in
  // the static layout (public path /api/v1/mcp). Proxying the whole /api/v1
  // prefix would shadow the later-registered /api/v1/openapi.json (Hono
  // matches registration order for wildcard mounts), so the proxy targets
  // exactly the one path the module serves. The path is re-based to /mcp —
  // the sub-app's own route — and the execution context is passed through
  // only when present (direct handler calls in tests omit it).
  app.post("/api/v1/mcp", (c) => {
    const url = new URL(c.req.url);
    url.pathname = "/mcp";
    const request = new Request(url, c.req.raw);
    return import("./routes/mcp")
      .then(({ mcpApi }) => {
        let ctx: unknown;
        try {
          ctx = c.executionCtx;
        } catch {
          ctx = undefined;
        }
        return mcpApi.fetch(request, c.env, ctx as never);
      })
      .catch((error) => jsonError(c, error));
  });

  app.get("/openapi.json", (c) =>
    c.json(
      isLegacyWireRequest(c)
        ? getLegacyOpenApiDocument()
        : getCurrentOpenApiDocument(),
    ),
  );
  app.get("/api/v1/openapi.json", async (c) => {
    try {
      await getRequestContext(c);
      return c.json(
        isLegacyWireRequest(c)
          ? getLegacyOpenApiDocument()
          : getCurrentOpenApiDocument(),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: { message: "Not found" } }, 404);
    }
    return c.env.ASSETS.fetch(c.req.raw).then(async (response) => {
      // `not_found_handling: "none"` (the default config since v0.23):
      // navigations that match no asset file reach this handler and the
      // ASSETS binding answers 404 with no body. Serve the SPA shell here —
      // 200 for known frontend routes, 404 for everything else — so unknown
      // URLs stop being soft-404s. Configs still on
      // "single-page-application" never get here for navigations and keep
      // the old behavior. Paths with a file extension stay plain 404s: a
      // missing script or image must not come back as HTML.
      if (
        response.status === 404 &&
        (c.req.method === "GET" || c.req.method === "HEAD") &&
        !/\.[A-Za-z0-9]+$/.test(c.req.path)
      ) {
        // Conditional headers would let ASSETS answer 304 for the shell,
        // which cannot carry the 404 status this path needs.
        const headers = new Headers(c.req.raw.headers);
        headers.delete("if-none-match");
        headers.delete("if-modified-since");
        const shell = await c.env.ASSETS.fetch(
          new Request(new URL("/", c.req.url), { headers }),
        );
        if (shell.ok) {
          return new Response(shell.body, {
            status: isKnownFrontendPath(c.req.path) ? 200 : 404,
            statusText: isKnownFrontendPath(c.req.path) ? "OK" : "Not Found",
            headers: shell.headers,
          });
        }
      }
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
      // Status semantics for SPA deep links: known frontend routes keep the
      // 200 shell, unknown paths return 404 (same shell) so crawlers do not
      // index soft-404s. The SPA renders its not-found UI either way. The
      // rewrite only touches HTML responses — exact asset files (robots.txt,
      // sw.js, brand marks, …) are exact ASSETS matches and keep their own
      // status and content type.
      const contentType = response.headers.get("content-type") ?? "";
      if (
        !isKnownFrontendPath(c.req.path) &&
        response.status === 200 &&
        contentType.startsWith("text/html")
      ) {
        return new Response(response.body, {
          status: 404,
          statusText: "Not Found",
          headers: response.headers,
        });
      }
      return response;
    });
  });

  return app;
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

function logBackgroundTaskFailure(task: string, error: unknown) {
  console.error(
    JSON.stringify({
      message: "Background task failed",
      task,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

/**
 * The limits half of runScheduledMaintenance's options, resolved once per
 * scheduled lifecycle event. Queue jobs do not run the maintenance passes
 * that consume these limits.
 */
async function maintenanceOptions(
  env: FlareMoEnv,
  resolvedOptions: ResolvedFlareMoOptions,
  hasCustomUserPlanLimits: boolean,
) {
  return {
    limits: await resolvedOptions.resolvePlanLimits(env),
    userLimits: hasCustomUserPlanLimits
      ? null
      : parseUserPlanLimits(env.FLAREMO_USER_LIMITS_JSON),
    resolveUserLimits: hasCustomUserPlanLimits
      ? (userId: string) => resolvedOptions.resolveUserPlanLimits(env, userId)
      : undefined,
  };
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
      // Outbox sweeps are maintenance: mutating requests trigger them (they
      // are the ones that can enqueue work), so reads skip the fixed
      // per-request query tax. The daily cron sweeps whatever reads missed.
      const method = request.method.toUpperCase();
      if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        const db = getFlareMoDb(env);
        // `ExecutionContext` is part of the Worker handler contract. Keeping
        // this post-response work on `waitUntil` avoids changing the route-only
        // test semantics for direct handler calls without a Worker runtime.
        ctx?.waitUntil(
          dispatchMemosWebhookOutbox(db).catch((error) =>
            logBackgroundTaskFailure("memos_webhook_outbox", error),
          ),
        );
        ctx?.waitUntil(
          dispatchRequestEmbeddingOutbox(
            env,
            resolvedOptions,
            hasCustomUserPlanLimits,
          ).catch((error) =>
            logBackgroundTaskFailure("embedding_outbox", error),
          ),
        );
      }
      return response;
    },
    async scheduled(controller, env) {
      await runScheduledMaintenance(
        env,
        controller.scheduledTime,
        await maintenanceOptions(env, resolvedOptions, hasCustomUserPlanLimits),
      );
    },
    async queue(batch, env) {
      // Two message shapes share the consumer: {jobId} (member removal) and
      // {taskId} (data export). Both run through the same idempotent
      // executor as scheduled maintenance so retries cannot diverge from the
      // daily recovery path. The queue path intentionally runs only these
      // message-selected jobs; the scheduled handler owns the full sweep.
      // A malformed body can never become valid on retry — drop it here so
      // the batch ack removes the poison message instead of looping.
      const removalJobIds: string[] = [];
      const exportTaskIds: string[] = [];
      for (const message of batch.messages) {
        const body = message.body as { jobId?: unknown; taskId?: unknown };
        if (typeof body?.jobId === "string" && body.jobId) {
          removalJobIds.push(body.jobId);
        } else if (typeof body?.taskId === "string" && body.taskId) {
          exportTaskIds.push(body.taskId);
        } else {
          console.warn(
            JSON.stringify({ message: "Discarded malformed queue message" }),
          );
        }
      }
      await runQueuedJobs(env, {
        removalJobIds,
        exportTaskIds,
      });
      for (const message of batch.messages) message.ack();
    },
  };
}

export default createFlareMoWorker();
