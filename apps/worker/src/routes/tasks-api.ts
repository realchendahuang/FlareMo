import {
  createTaskSchema,
  listTasksQuerySchema,
  memoTaskSummariesQuerySchema,
  reorderTasksSchema,
  taskReminderCountsQuerySchema,
  updateTaskSchema,
} from "@flaremo/contracts";
import type { TaskActor } from "@flaremo/domain";
import {
  createTask,
  deleteTask,
  getTask,
  getTaskReminderCounts,
  listTaskActivity,
  listTasks,
  listTasksForSourceMemos,
  parseResourceName,
  reorderTasks,
  restoreTask,
  updateTask,
  ValidationError,
} from "@flaremo/domain";
import type { Context } from "hono";
import { Hono } from "hono";
import {
  getRequestContext,
  type HonoBindings,
  type ReturnTypeOfRequestContext,
} from "../context";
import { jsonError } from "../http";
import { rateLimitGuard } from "../rate-limit";
import { zValidator } from "../validated";

export const tasksApi = new Hono<HonoBindings>();

// `/api/app/*` routes take a bare resource id in the URL path; the shared
// helper prepends the namespaced prefix (and passes namespaced names through).
function parseTaskId(value: string) {
  return parseResourceName(value, "tasks");
}

// Agents write through the same route as the browser, so the actor is derived
// from the credential: a PAT is an agent (labelled with a short token hint so
// the activity trail stays attributable), a cookie session is the owner.
function resolveActor(
  c: Context<HonoBindings>,
  credential: ReturnTypeOfRequestContext["credential"],
): TaskActor {
  if (credential !== "pat") return { type: "user" };
  const token = c.req.raw.headers.get("authorization")?.trim() ?? "";
  const hint = token.startsWith("memos_pat_")
    ? token.slice("memos_pat_".length, "memos_pat_".length + 8)
    : null;
  return { type: "agent", name: hint ? `pat:${hint}` : undefined };
}

tasksApi.get("/", zValidator("query", listTasksQuerySchema), async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const query = c.req.valid("query");
    const result = await listTasks(db, user, {
      projectId: query.project_id,
      status: query.status,
      priority: query.priority,
      dueFrom: query.due_from,
      dueTo: query.due_to,
      sourceMemoId: query.source_memo_id,
      includeDeleted: query.include_deleted,
      pageSize: query.page_size,
      pageToken: query.page_token,
    });
    return c.json({
      tasks: result.tasks,
      ...(result.nextPageToken
        ? { next_page_token: result.nextPageToken }
        : {}),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

tasksApi.post("/", zValidator("json", createTaskSchema), async (c) => {
  try {
    const context = await getRequestContext(c);
    const throttled = await rateLimitGuard(c, "tasks", context.user.id);
    if (throttled) return throttled;
    return c.json(
      {
        task: await createTask(
          context.db,
          context.user,
          resolveActor(c, context.credential),
          c.req.valid("json"),
        ),
      },
      201,
    );
  } catch (error) {
    return jsonError(c, error);
  }
});

tasksApi.post("/reorder", zValidator("json", reorderTasksSchema), async (c) => {
  try {
    const context = await getRequestContext(c);
    const throttled = await rateLimitGuard(c, "tasks", context.user.id);
    if (throttled) return throttled;
    const { project_id, task_ids } = c.req.valid("json");
    return c.json({
      tasks: await reorderTasks(
        context.db,
        context.user,
        resolveActor(c, context.credential),
        project_id,
        task_ids,
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

// Static routes must be registered before `/:id` or Hono treats "reminders"
// and "badges" as task ids.
tasksApi.get(
  "/reminders",
  zValidator("query", taskReminderCountsQuerySchema),
  async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      return c.json(
        await getTaskReminderCounts(db, user, c.req.valid("query").date),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

tasksApi.get(
  "/badges",
  zValidator("query", memoTaskSummariesQuerySchema),
  async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const memoIds = c.req
        .valid("query")
        .memo_ids.split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      if (memoIds.length > 100) {
        throw new ValidationError("At most 100 memo ids are allowed.");
      }
      return c.json({
        tasks: await listTasksForSourceMemos(db, user, memoIds),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

tasksApi.get("/:id", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    return c.json({
      task: await getTask(db, user, parseTaskId(c.req.param("id"))),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

tasksApi.patch("/:id", zValidator("json", updateTaskSchema), async (c) => {
  try {
    const context = await getRequestContext(c);
    const throttled = await rateLimitGuard(c, "tasks", context.user.id);
    if (throttled) return throttled;
    return c.json({
      task: await updateTask(
        context.db,
        context.user,
        resolveActor(c, context.credential),
        parseTaskId(c.req.param("id")),
        c.req.valid("json"),
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

// DELETE moves the task to the recycle bin; the physical delete happens in
// the daily trash purge.
tasksApi.delete("/:id", async (c) => {
  try {
    const context = await getRequestContext(c);
    const throttled = await rateLimitGuard(c, "tasks", context.user.id);
    if (throttled) return throttled;
    await deleteTask(context.db, context.user, parseTaskId(c.req.param("id")));
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, error);
  }
});

// Restore pulls a soft-deleted task out of the recycle bin.
tasksApi.post("/:id/restore", async (c) => {
  try {
    const context = await getRequestContext(c);
    const throttled = await rateLimitGuard(c, "tasks", context.user.id);
    if (throttled) return throttled;
    return c.json({
      task: await restoreTask(
        context.db,
        context.user,
        parseTaskId(c.req.param("id")),
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

tasksApi.get("/:id/activity", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    return c.json({
      activity: await listTaskActivity(
        db,
        user,
        parseTaskId(c.req.param("id")),
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});
