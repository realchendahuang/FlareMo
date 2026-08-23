import {
  createTaskSchema,
  listTasksQuerySchema,
  reorderTasksSchema,
  updateTaskSchema,
} from "@flaremo/contracts";
import type { TaskActor } from "@flaremo/domain";
import {
  createTask,
  getTask,
  hardDeleteTask,
  listTaskActivity,
  listTasks,
  reorderTasks,
  updateTask,
} from "@flaremo/domain";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import {
  getRequestContext,
  type HonoBindings,
  type ReturnTypeOfRequestContext,
} from "../context";
import { jsonError } from "../http";

export const tasksApi = new Hono<HonoBindings>();

function parseTaskId(value: string) {
  return `tasks/${value}`;
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
    return c.json({
      tasks: await listTasks(db, user, {
        projectId: query.project_id,
        status: query.status,
      }),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

tasksApi.post("/", zValidator("json", createTaskSchema), async (c) => {
  try {
    const context = await getRequestContext(c);
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

tasksApi.delete("/:id", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    await hardDeleteTask(db, user, parseTaskId(c.req.param("id")));
    return c.json({ ok: true });
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
