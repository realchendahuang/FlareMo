import {
  createProjectSchema,
  listProjectsQuerySchema,
  updateProjectSchema,
} from "@flaremo/contracts";
import {
  archiveProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  listTasks,
  parseResourceName,
  restoreProject,
  updateProject,
} from "@flaremo/domain";
import { Hono } from "hono";
import { getRequestContext, type HonoBindings } from "../context";
import { jsonError } from "../http";
import { rateLimitGuard } from "../rate-limit";
import { zValidator } from "../validated";

export const projectsApi = new Hono<HonoBindings>();

// `/api/app/*` routes take a bare resource id in the URL path; the shared
// helper prepends the namespaced prefix (and passes namespaced names through).
function parseProjectId(value: string) {
  return parseResourceName(value, "projects");
}

projectsApi.get(
  "/",
  zValidator("query", listProjectsQuerySchema),
  async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const query = c.req.valid("query");
      return c.json({
        projects: await listProjects(db, user, {
          status: query.status,
          query: query.query,
          includeDeleted: query.include_deleted,
        }),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

projectsApi.post("/", zValidator("json", createProjectSchema), async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const throttled = await rateLimitGuard(c, "projects", user.id);
    if (throttled) return throttled;
    return c.json(
      { project: await createProject(db, user, c.req.valid("json")) },
      201,
    );
  } catch (error) {
    return jsonError(c, error);
  }
});

projectsApi.get("/:id", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    return c.json({
      project: await getProject(db, user, parseProjectId(c.req.param("id"))),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

projectsApi.patch(
  "/:id",
  zValidator("json", updateProjectSchema),
  async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const throttled = await rateLimitGuard(c, "projects", user.id);
      if (throttled) return throttled;
      return c.json({
        project: await updateProject(
          db,
          user,
          parseProjectId(c.req.param("id")),
          c.req.valid("json"),
        ),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

projectsApi.post("/:id/archive", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const throttled = await rateLimitGuard(c, "projects", user.id);
    if (throttled) return throttled;
    return c.json({
      project: await archiveProject(
        db,
        user,
        parseProjectId(c.req.param("id")),
        true,
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

projectsApi.post("/:id/unarchive", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const throttled = await rateLimitGuard(c, "projects", user.id);
    if (throttled) return throttled;
    return c.json({
      project: await archiveProject(
        db,
        user,
        parseProjectId(c.req.param("id")),
        false,
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

// DELETE moves the project (and its still-live tasks) to the recycle bin;
// the physical delete happens in the daily trash purge.
projectsApi.delete("/:id", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const throttled = await rateLimitGuard(c, "projects", user.id);
    if (throttled) return throttled;
    await deleteProject(db, user, parseProjectId(c.req.param("id")));
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, error);
  }
});

// Restore pulls a soft-deleted project — and the tasks deleted together with
// it — out of the recycle bin.
projectsApi.post("/:id/restore", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const throttled = await rateLimitGuard(c, "projects", user.id);
    if (throttled) return throttled;
    return c.json({
      project: await restoreProject(
        db,
        user,
        parseProjectId(c.req.param("id")),
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

projectsApi.get("/:id/tasks", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const projectId = parseProjectId(c.req.param("id"));
    const result = await listTasks(db, user, { projectId });
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
