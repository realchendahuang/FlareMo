import {
  articleDtoSchema,
  articleSummaryDtoSchema,
  projectDtoSchema,
  taskDtoSchema,
} from "@flaremo/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTestRuntime,
  fetchWorker,
  type TestRuntime,
} from "./test-support/runtime";
import { bootstrapAndSignIn } from "./test-support/sign-in";

/**
 * Response-level contract gate for the app API. The OpenAPI coverage test only
 * compares path + method, so these assertions validate the actual payloads
 * against the same zod schemas the clients are typed from.
 */
describe("app API response contract", () => {
  let runtime: TestRuntime | undefined;
  let cookie = "";

  afterEach(async () => {
    await runtime?.runtime.dispose();
    runtime = undefined;
  });

  const call = async (
    path: string,
    init: { method?: string; body?: unknown } = {},
  ) => {
    const headers: Record<string, string> = { cookie };
    let body: string | undefined;
    if (init.body !== undefined) {
      headers.origin = "http://flaremo.test";
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    return fetchWorker(
      new Request(`http://flaremo.test${path}`, {
        method: init.method ?? "GET",
        headers,
        body,
      }),
      runtime.env,
    );
  };

  it("keeps article payloads inside the contract", async () => {
    runtime = await createTestRuntime({ name: "flaremo-app-contract" });
    cookie = await bootstrapAndSignIn(runtime.env);

    const created = await call("/api/app/articles", {
      method: "POST",
      body: { title: "Contract article", content: "contract body" },
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { article: unknown };
    const article = articleDtoSchema.parse(createdBody.article);
    expect(article.status).toBe("draft");

    const list = await call("/api/app/articles");
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { articles: unknown[] };
    listBody.articles.forEach((entry) => {
      articleSummaryDtoSchema.parse(entry);
    });
    expect(listBody.articles).toHaveLength(1);

    const articleRouteId = article.id.replace(/^articles\//, "");
    const fetched = await call(`/api/app/articles/${articleRouteId}`);
    expect(fetched.status).toBe(200);
    const fetchedBody = (await fetched.json()) as { article: unknown };
    expect(articleDtoSchema.parse(fetchedBody.article).id).toBe(article.id);
  });

  it("keeps project and task payloads inside the contract", async () => {
    runtime = await createTestRuntime({ name: "flaremo-app-contract" });
    cookie = await bootstrapAndSignIn(runtime.env);

    const createdProject = await call("/api/app/projects", {
      method: "POST",
      body: { name: "Contract project" },
    });
    expect(createdProject.status).toBe(201);
    const project = projectDtoSchema.parse(
      ((await createdProject.json()) as { project: unknown }).project,
    );
    expect(project.task_count_total).toBe(0);

    const createdTask = await call("/api/app/tasks", {
      method: "POST",
      body: { project_id: project.id, title: "Contract task" },
    });
    expect(createdTask.status).toBe(201);
    const task = taskDtoSchema.parse(
      ((await createdTask.json()) as { task: unknown }).task,
    );
    expect(task.status).toBe("todo");
    expect(task.project_id).toBe(project.id);

    const tasks = await call("/api/app/tasks?page_size=10");
    expect(tasks.status).toBe(200);
    const taskList = (await tasks.json()) as { tasks: unknown[] };
    taskList.tasks.forEach((entry) => {
      taskDtoSchema.parse(entry);
    });
    expect(
      taskList.tasks.some((entry) => (entry as { id: string }).id === task.id),
    ).toBe(true);

    const projects = await call("/api/app/projects");
    expect(projects.status).toBe(200);
    const projectList = (await projects.json()) as { projects: unknown[] };
    projectList.projects.forEach((entry) => {
      projectDtoSchema.parse(entry);
    });
  });
});
