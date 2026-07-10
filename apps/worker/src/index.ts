import { createOpenApiDocument } from "@flaremo/contracts";
import { createDb } from "@flaremo/db";
import {
  finalizeAttachmentCleanup,
  listAttachmentCleanupCandidates,
} from "@flaremo/domain";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { HonoBindings } from "./context";
import { appApi } from "./routes/app-api";
import { mcpApi } from "./routes/mcp";
import { memosApi } from "./routes/memos-api";
import { publicApi } from "./routes/public-api";

const app = new Hono<HonoBindings>();

app.use(
  "/api/*",
  cors({
    origin: "*",
    allowHeaders: [
      "content-type",
      "cf-access-client-id",
      "cf-access-client-secret",
    ],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.route("/api/app", appApi);
app.route("/api/public", publicApi);
app.route("/api/v1", memosApi);
app.route("/api/v1", mcpApi);

app.get("/openapi.json", (c) => c.json(createOpenApiDocument()));
app.get("/api/v1/openapi.json", (c) => c.json(createOpenApiDocument()));

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: { message: "Not found" } }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

const handler = {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
    app.fetch(request, env, ctx),
  async scheduled(controller: ScheduledController, env: Env) {
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
    console.log(
      JSON.stringify({
        message: "attachment cleanup complete",
        count: candidates.length,
        scheduledTime: controller.scheduledTime,
      }),
    );
  },
} satisfies ExportedHandler<Env>;

export default handler;
