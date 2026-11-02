import {
  compileInputSchema,
  createMemorySchema,
  listMemoriesQuerySchema,
  resolveProposalInputSchema,
  updateMemorySchema,
} from "@flaremo/contracts";
import {
  archiveMemory,
  compileCoreMemory,
  confirmMemory,
  createMemory,
  createMemoryInputToWrite,
  getLatestCompileArchive,
  getMemory,
  getMemoryLineage,
  hardDeleteMemory,
  listMemories,
  listMemoryEvidence,
  listMemoryRelations,
  listMemoryReview,
  listMemoryRevisions,
  lockMemory,
  type MemoryActor,
  pinMemory,
  promoteMemoryToMemo,
  resolveProposal,
  restoreMemory,
  splitMemoryKey,
  unlockMemory,
  unpinMemory,
  updateMemory,
} from "@flaremo/domain";
import { Hono } from "hono";
import { z } from "zod";
import { getBrowserRequestContext, type HonoBindings } from "../context";
import { jsonError } from "../http";
import { zValidator } from "../validated";

export const memoryApi = new Hono<HonoBindings>();

// The web-facing memory API is a user-management surface: it always runs as
// the owner through a cookie session, never as an agent PAT. Agents reach the
// same domain services through `/memory/mcp`.
const USER_ACTOR: MemoryActor = { type: "user" };

// `/api/app/*` routes take a bare resource id in the URL path (matching the
// memo routes) and prepend the namespaced prefix here, mirroring how
// app-api.ts rebuilds `memos/${id}`.
function parseMemoryId(value: string) {
  return value.startsWith("memories/") ? value : `memories/${value}`;
}

memoryApi.get("/", zValidator("query", listMemoriesQuerySchema), async (c) => {
  try {
    const { db, user } = await getBrowserRequestContext(c);
    const query = c.req.valid("query");
    const { memories, nextPageToken } = await listMemories(db, user, {
      q: query.q,
      type: query.type,
      kind: query.kind,
      scopeType: query.scope_type,
      scopeKey: query.scope_key,
      factKey: query.fact_key,
      tier: query.tier,
      verification: query.verification,
      status: query.status,
      sourceAgent: query.source_agent,
      needsReview: query.needs_review,
      asOf: query.as_of,
      pageSize: query.page_size,
      pageToken: query.page_token,
    });
    return c.json({
      memories,
      ...(nextPageToken ? { next_page_token: nextPageToken } : {}),
    });
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

memoryApi.get(
  "/compile",
  zValidator("query", compileInputSchema),
  async (c) => {
    try {
      const { db, user } = await getBrowserRequestContext(c);
      const compiled = await compileCoreMemory(db, user, c.req.valid("query"));
      return c.json({ compiled });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

// Lens (§五.4): the deterministic recompute *and* the last actual injection
// read back from the archive. When the two differ, the archive wins — it is
// what an agent really carried, the preview is only a re-derivation.
memoryApi.get("/lens", zValidator("query", compileInputSchema), async (c) => {
  try {
    const { db, user } = await getBrowserRequestContext(c);
    const input = c.req.valid("query");
    const [latestArchive, compiled] = await Promise.all([
      getLatestCompileArchive(db, user.id, input),
      compileCoreMemory(db, user, input),
    ]);
    return c.json({
      latest_archive: latestArchive,
      preview: compiled,
      matches_archive: latestArchive
        ? latestArchive.payload === compiled.system_prompt_payload
        : null,
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

memoryApi.post("/", zValidator("json", createMemorySchema), async (c) => {
  try {
    const { db, user, userLimits } = await getBrowserRequestContext(c);
    const result = await createMemory(
      db,
      user,
      USER_ACTOR,
      createMemoryInputToWrite(c.req.valid("json")),
      { userLimits, userId: user.id },
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

memoryApi.post("/:id/pin", async (c) => {
  try {
    const { db, user } = await getBrowserRequestContext(c);
    return c.json({
      memory: await pinMemory(
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

memoryApi.post("/:id/unpin", async (c) => {
  try {
    const { db, user } = await getBrowserRequestContext(c);
    return c.json({
      memory: await unpinMemory(
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

memoryApi.post("/:id/restore", async (c) => {
  try {
    const { db, user } = await getBrowserRequestContext(c);
    return c.json({
      memory: await restoreMemory(
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

memoryApi.post(
  "/proposals/:id/resolve",
  zValidator("json", resolveProposalInputSchema),
  async (c) => {
    try {
      const { db, user } = await getBrowserRequestContext(c);
      const result = await resolveProposal(
        db,
        user,
        USER_ACTOR,
        parseMemoryId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json(result);
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

memoryApi.post(
  "/:id/split-key",
  zValidator(
    "json",
    z.object({
      new_fact_key: z.string().trim().max(256).nullable().optional(),
    }),
  ),
  async (c) => {
    try {
      const { db, user } = await getBrowserRequestContext(c);
      const body = c.req.valid("json");
      const memory = await splitMemoryKey(
        db,
        user,
        USER_ACTOR,
        parseMemoryId(c.req.param("id")),
        body.new_fact_key ?? null,
      );
      return c.json({ memory });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

memoryApi.post("/:id/promote", async (c) => {
  try {
    const { db, user, userLimits } = await getBrowserRequestContext(c);
    const result = await promoteMemoryToMemo(
      db,
      user,
      USER_ACTOR,
      parseMemoryId(c.req.param("id")),
      { userLimits, userId: user.id },
    );
    return c.json(result, 201);
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

memoryApi.get("/:id/evidence", async (c) => {
  try {
    const { db, user } = await getBrowserRequestContext(c);
    return c.json({
      evidence: await listMemoryEvidence(
        db,
        user,
        parseMemoryId(c.req.param("id")),
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

memoryApi.get("/:id/lineage", async (c) => {
  try {
    const { db, user } = await getBrowserRequestContext(c);
    const lineage = await getMemoryLineage(
      db,
      user,
      parseMemoryId(c.req.param("id")),
    );
    return c.json({ lineage });
  } catch (error) {
    return jsonError(c, error);
  }
});
