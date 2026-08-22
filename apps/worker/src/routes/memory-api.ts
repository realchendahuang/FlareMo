import {
  createMemorySchema,
  listMemoriesQuerySchema,
  updateMemorySchema,
} from "@flaremo/contracts";
import {
  archiveMemory,
  confirmMemory,
  createMemory,
  createMemoryInputToWrite,
  getMemory,
  hardDeleteMemory,
  listMemories,
  listMemoryRelations,
  listMemoryReview,
  listMemoryRevisions,
  lockMemory,
  type MemoryActor,
  unlockMemory,
  updateMemory,
} from "@flaremo/domain";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getBrowserRequestContext, type HonoBindings } from "../context";
import { jsonError } from "../http";

export const memoryApi = new Hono<HonoBindings>();

// The web-facing memory API is a user-management surface: it always runs as
// the owner through a cookie session, never as an agent PAT. Agents reach the
// same domain services through `/memory/mcp`.
const USER_ACTOR: MemoryActor = { type: "user" };

// `/api/app/*` routes take a bare resource id in the URL path (matching the
// memo routes) and prepend the namespaced prefix here, mirroring how
// app-api.ts rebuilds `memos/${id}`.
function parseMemoryId(value: string) {
  return `memories/${value}`;
}

memoryApi.get("/", zValidator("query", listMemoriesQuerySchema), async (c) => {
  try {
    const { db, user } = await getBrowserRequestContext(c);
    const query = c.req.valid("query");
    const memories = await listMemories(db, user, {
      q: query.q,
      type: query.type,
      kind: query.kind,
      scopeType: query.scope_type,
      scopeKey: query.scope_key,
      tier: query.tier,
      verification: query.verification,
      status: query.status,
      sourceAgent: query.source_agent,
      needsReview: query.needs_review,
    });
    return c.json({ memories });
  } catch (error) {
    return jsonError(c, error);
  }
});

memoryApi.get("/review", async (c) => {
  try {
    const { db, user } = await getBrowserRequestContext(c);
    return c.json({ memories: await listMemoryReview(db, user) });
  } catch (error) {
    return jsonError(c, error);
  }
});

memoryApi.post("/", zValidator("json", createMemorySchema), async (c) => {
  try {
    const { db, user } = await getBrowserRequestContext(c);
    const result = await createMemory(
      db,
      user,
      USER_ACTOR,
      createMemoryInputToWrite(c.req.valid("json")),
    );
    return c.json(result, result.duplicate ? 200 : 201);
  } catch (error) {
    return jsonError(c, error);
  }
});

memoryApi.get("/:id", async (c) => {
  try {
    const { db, user } = await getBrowserRequestContext(c);
    return c.json({
      memory: await getMemory(db, user, parseMemoryId(c.req.param("id"))),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

memoryApi.patch("/:id", zValidator("json", updateMemorySchema), async (c) => {
  try {
    const { db, user } = await getBrowserRequestContext(c);
    const memory = await updateMemory(
      db,
      user,
      USER_ACTOR,
      parseMemoryId(c.req.param("id")),
      c.req.valid("json"),
    );
    return c.json({ memory });
  } catch (error) {
    return jsonError(c, error);
  }
});

memoryApi.delete("/:id", async (c) => {
  try {
    const { db, user } = await getBrowserRequestContext(c);
    await hardDeleteMemory(
      db,
      user,
      USER_ACTOR,
      parseMemoryId(c.req.param("id")),
    );
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, error);
  }
});

memoryApi.post("/:id/confirm", async (c) => {
  try {
    const { db, user } = await getBrowserRequestContext(c);
    return c.json({
      memory: await confirmMemory(
        db,
        user,
        USER_ACTOR,
        parseMemoryId(c.req.param("id")),
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

memoryApi.post("/:id/lock", async (c) => {
  try {
    const { db, user } = await getBrowserRequestContext(c);
    return c.json({
      memory: await lockMemory(
        db,
        user,
        USER_ACTOR,
        parseMemoryId(c.req.param("id")),
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

memoryApi.post("/:id/unlock", async (c) => {
  try {
    const { db, user } = await getBrowserRequestContext(c);
    return c.json({
      memory: await unlockMemory(
        db,
        user,
        USER_ACTOR,
        parseMemoryId(c.req.param("id")),
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

memoryApi.post("/:id/archive", async (c) => {
  try {
    const { db, user } = await getBrowserRequestContext(c);
    return c.json({
      memory: await archiveMemory(
        db,
        user,
        USER_ACTOR,
        parseMemoryId(c.req.param("id")),
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

memoryApi.get("/:id/revisions", async (c) => {
  try {
    const { db, user } = await getBrowserRequestContext(c);
    return c.json({
      revisions: await listMemoryRevisions(
        db,
        user,
        parseMemoryId(c.req.param("id")),
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

memoryApi.get("/:id/relations", async (c) => {
  try {
    const { db, user } = await getBrowserRequestContext(c);
    return c.json({
      relations: await listMemoryRelations(
        db,
        user,
        parseMemoryId(c.req.param("id")),
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});
