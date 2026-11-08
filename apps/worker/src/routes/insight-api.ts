import {
  createMemoInsightSchema,
  type ListMemoInsightsResponse,
  listMemoInsightsQuerySchema,
  type MemoInsightResponse,
  type WriteMemoInsightInput,
  writeMemoInsightSchema,
} from "@flaremo/contracts";
import type { FlareMoDb, UserRow } from "@flaremo/db";
import {
  completeInsight,
  createInsight,
  deleteInsight,
  ForbiddenError,
  failInsight,
  getInsight,
  listPendingInsights,
  parseResourceName,
  updateStatus,
} from "@flaremo/domain";
import { Hono } from "hono";
import {
  getBrowserRequestContext,
  getRequestContext,
  type HonoBindings,
  type ReturnTypeOfRequestContext,
} from "../context";
import { jsonError } from "../http";
import { rateLimitGuard } from "../rate-limit";
import { zValidator } from "../validated";

/**
 * AI insight contract endpoints. See docs/agent-access-design.md §9.
 *
 * FlareMo never runs the model: a browser (or PAT) creates a task, an external
 * executor pulls pending tasks with its PAT, and writes the result back. Every
 * read and write is scoped to the caller's own rows. The credential split is
 * deliberate —
 *
 *   create / read / list   browser session or PAT
 *   write back             PAT only (the executor surface)
 *   delete derived result  browser session only
 */
export const insightApi = new Hono<HonoBindings>();

function parseInsightId(value: string) {
  return parseResourceName(value, "insights");
}

/**
 * Writing a result back belongs to an executor, which authenticates with a
 * PAT: a browser cookie must not impersonate one (the web UI only creates
 * tasks and reads results). Deleting a derived result is the browser's
 * counterpart of this boundary.
 */
function assertExecutor(context: ReturnTypeOfRequestContext) {
  if (context.credential !== "pat") {
    throw new ForbiddenError(
      "Insight execution requires a personal access token.",
    );
  }
}

/**
 * Map the executor's write-back body onto the state machine (§9.4). Keeping the
 * transitions in the domain service means every caller gets the same guard;
 * this switch only picks which service the requested state needs.
 */
async function writeBack(
  db: FlareMoDb,
  user: UserRow,
  id: string,
  body: WriteMemoInsightInput,
) {
  switch (body.status) {
    case "done":
      return completeInsight(db, user, id, {
        result: body.result,
        executor: body.executor,
      });
    case "failed":
      return failInsight(db, user, id, {
        error: body.error,
        executor: body.executor,
      });
    default:
      // `pending` is the documented retry reset; `running` claims the task.
      return updateStatus(db, user, id, body.status, {
        executor: body.executor,
      });
  }
}

insightApi.post("/", zValidator("json", createMemoInsightSchema), async (c) => {
  try {
    const context = await getRequestContext(c);
    const throttled = await rateLimitGuard(c, "insights", context.user.id);
    if (throttled) return throttled;
    const insight = await createInsight(
      context.db,
      context.user,
      c.req.valid("json"),
    );
    return c.json<MemoInsightResponse>({ insight }, 201);
  } catch (error) {
    return jsonError(c, error);
  }
});

insightApi.get(
  "/",
  zValidator("query", listMemoInsightsQuerySchema),
  async (c) => {
    try {
      const context = await getRequestContext(c);
      // Readable by the browser too — the web history view lists the caller's
      // own insights; an executor's PAT pull uses the same endpoint.
      const insights = await listPendingInsights(
        context.db,
        context.user,
        c.req.valid("query"),
      );
      return c.json<ListMemoInsightsResponse>({ insights });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

insightApi.get("/:id", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const insight = await getInsight(
      db,
      user,
      parseInsightId(c.req.param("id")),
    );
    return c.json<MemoInsightResponse>({ insight });
  } catch (error) {
    return jsonError(c, error);
  }
});

insightApi.put(
  "/:id",
  zValidator("json", writeMemoInsightSchema),
  async (c) => {
    try {
      const context = await getRequestContext(c);
      assertExecutor(context);
      const throttled = await rateLimitGuard(c, "insights", context.user.id);
      if (throttled) return throttled;
      const insight = await writeBack(
        context.db,
        context.user,
        parseInsightId(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json<MemoInsightResponse>({ insight });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

insightApi.delete("/:id", async (c) => {
  try {
    const context = await getBrowserRequestContext(c);
    await deleteInsight(
      context.db,
      context.user,
      parseInsightId(c.req.param("id")),
    );
    return c.body(null, 204);
  } catch (error) {
    return jsonError(c, error);
  }
});
