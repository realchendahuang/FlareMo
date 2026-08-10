import {
  createCurrentOpenApiDocument,
  createOpenApiDocument,
} from "@flaremo/contracts";
import { createDb } from "@flaremo/db";
import {
  deleteExpiredDataTasks,
  dispatchMemosWebhookOutbox,
  expireStaleDataTasks,
  finalizeAttachmentCleanup,
  listAttachmentCleanupCandidates,
} from "@flaremo/domain";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createFlareMoAuth, getTrustedOrigins } from "./auth";
import {
  assertTrustedCookieMutation,
  getRequestContext,
  type HonoBindings,
} from "./context";
import type { FlareMoEnv } from "./env";
import { jsonError } from "./http";
import { accountApi } from "./routes/account-api";
import { appApi } from "./routes/app-api";
import { authApi } from "./routes/auth-api";
import { mcpApi, mcpStreamableApi } from "./routes/mcp";
import { memosApi } from "./routes/memos-api";
import { memosConnectApi } from "./routes/memos-connect-api";
import {
  isLegacyWireRequest,
  memosCurrentApi,
} from "./routes/memos-current-api";
import { memosFileApi } from "./routes/memos-file-api";
import { memosSocialApi } from "./routes/memos-social-api";
import { memosSseApi } from "./routes/memos-sse";
import { publicApi } from "./routes/public-api";

const app = new Hono<HonoBindings>();

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
    allowHeaders: ["content-type", "authorization", "accept", "mcp-session-id"],
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
app.all("/api/auth/*", (c) => createFlareMoAuth(c.env).handler(c.req.raw));
app.route("/api/app/account", accountApi);
app.route("/api/app", appApi);
app.route("/api/public", publicApi);
app.route("/file", memosFileApi);
app.route("/mcp", mcpStreamableApi);
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
  return c.env.ASSETS.fetch(c.req.raw);
});

const handler = {
  async fetch(request: Request, env: FlareMoEnv, ctx?: ExecutionContext) {
    const response = await app.fetch(request, env, ctx);
    ctx?.waitUntil(
      dispatchMemosWebhookOutbox(createDb(env.DB)).catch(() => undefined),
    );
    return response;
  },
  async scheduled(controller: ScheduledController, env: FlareMoEnv) {
    await dispatchMemosWebhookOutbox(createDb(env.DB));
    const db = createDb(env.DB);
    const cutoff = new Date(
      controller.scheduledTime - 24 * 60 * 60 * 1_000,
    ).toISOString();
    const candidates = await listAttachmentCleanupCandidates(db, cutoff);
    const objectKeys = candidates.map((attachment) => attachment.r2Key);
    if (objectKeys.length > 0) {
      await env.ATTACHMENTS.delete(objectKeys);
    }
    for (const attachment of candidates) {
      await finalizeAttachmentCleanup(db, attachment.id);
    }
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
    console.log(
      JSON.stringify({
        message: "attachment cleanup complete",
        count: candidates.length,
        staleTaskCount: staleCount,
        expiredTaskCount: expiredIds.length,
        scheduledTime: controller.scheduledTime,
      }),
    );
  },
} satisfies ExportedHandler<FlareMoEnv>;

export default handler;
