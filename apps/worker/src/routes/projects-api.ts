import {
  createProjectSchema,
  listProjectsQuerySchema,
  updateProjectSchema,
} from "@flaremo/contracts";
import {
  archiveProject,
  createProject,
  getProject,
  hardDeleteProject,
  listProjects,
  listTasks,
  updateProject,
} from "@flaremo/domain";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getRequestContext, type HonoBindings } from "../context";
import { jsonError } from "../http";

export const projectsApi = new Hono<HonoBindings>();

// `/api/app/*` routes take a bare resource id in the URL path and prepend the
// namespaced prefix here, mirroring how memory-api.ts rebuilds `memories/${id}`.
function parseProjectId(value: string) {
  return `projects/${value}`;
}

projectsApi.get(
  "/",
  zValidator("query", listProjectsQuerySchema),
  async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const query = c.req.valid("query");
      return c.json({ projects: await listProjects(db, user, query) });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

projectsApi.post("/", zValidator("json", createProjectSchema), async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
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

projectsApi.delete("/:id", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    await hardDeleteProject(db, user, parseProjectId(c.req.param("id")));
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, error);
  }
});

projectsApi.get("/:id/tasks", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const projectId = parseProjectId(c.req.param("id"));
    return c.json({ tasks: await listTasks(db, user, { projectId }) });
  } catch (error) {
    return jsonError(c, error);
  }
});
