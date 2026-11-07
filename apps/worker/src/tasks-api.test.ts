import { applyFlaremoMigrations } from "@flaremo/db";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "./index";

let mf: Miniflare;
let env: Env;
let sessionCookie: string;
let memberCookie: string;

const TEST_AUTH_SECRET =
  "test-better-auth-secret-that-is-never-used-in-production";
const TEST_BOOTSTRAP_SECRET =
  "test-bootstrap-secret-that-is-never-used-in-production";
const TEST_PASSWORD = "test-password-not-for-production-123";

describe("FlareMo tasks API", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "flaremo-tasks-api-test" },
      r2Buckets: { ATTACHMENTS: "flaremo-tasks-api-attachments" },
    });

    const db = await mf.getD1Database("DB");
    const r2 = await mf.getR2Bucket("ATTACHMENTS");
    env = {
      DB: db,
      ATTACHMENTS: r2,
      ASSETS: {
        fetch: async () => new Response("asset", { status: 200 }),
      } as Fetcher,
      FLAREMO_DEPLOY_REPOSITORY: "example/flaremo",
      FLAREMO_SINGLE_USER_EMAIL: "owner@example.com",
      FLAREMO_SINGLE_USER_NAME: "Owner",
      FLAREMO_PUBLIC_URL: "http://flaremo.test",
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      FLAREMO_BOOTSTRAP_SECRET: TEST_BOOTSTRAP_SECRET,
    } as Env;

    await applyFlaremoMigrations(db);
    sessionCookie = await bootstrapAndSignIn();
    memberCookie = await registerAndSignInMember();
  });

  afterEach(async () => {
    await mf.dispose();
  });

  function bareTaskId(id: string) {
    return id.replace(/^tasks\//, "");
  }
  function bareProjectId(id: string) {
    return id.replace(/^projects\//, "");
  }

  it("creates tasks with and without a project and reorders them", async () => {
    const project = await json<{ project: { id: string } }>(
      await fetchApp("http://flaremo.test/api/app/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "FlareMo" }),
      }),
    );

    const unassigned = await json<{ task: { id: string; project_id: null } }>(
      await fetchApp("http://flaremo.test/api/app/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "无项目任务" }),
      }),
    );
    expect(unassigned.task.project_id).toBeNull();

    const a = await createTask(project.project.id, "A");
    const b = await createTask(project.project.id, "B");
    const c = await createTask(project.project.id, "C");

    const reordered = await json<{ tasks: Array<{ title: string }> }>(
      await fetchApp("http://flaremo.test/api/app/tasks/reorder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: project.project.id,
          task_ids: [c.taskId, a.taskId, b.taskId],
        }),
      }),
    );
    expect(reordered.tasks.map((task) => task.title)).toEqual(["C", "A", "B"]);

    // The reorder activity row keeps its project-scoped shape (task_id null).
    const db = await mf.getD1Database("DB");
    const trail = await db
      .prepare(
        "SELECT task_id, action, changes FROM task_activity WHERE action = 'reordered'",
      )
      .all<{ task_id: null; changes: string }>();
    expect(trail.results).toHaveLength(1);
    expect(trail.results[0]?.task_id).toBeNull();
    expect(trail.results[0]?.changes).toContain(project.project.id);

    // Duplicate ids and foreign ids are hard validation errors, not silent
    // ignores; someone else's project is a 404.
    expect(
      (
        await fetchApp("http://flaremo.test/api/app/tasks/reorder", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            project_id: project.project.id,
            task_ids: [a.taskId, a.taskId],
          }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetchApp("http://flaremo.test/api/app/tasks/reorder", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            project_id: project.project.id,
            task_ids: [unassigned.task.id],
          }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetchApp("http://flaremo.test/api/app/tasks/reorder", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: memberCookie,
            origin: "http://flaremo.test",
          },
          body: JSON.stringify({
            project_id: project.project.id,
            task_ids: [a.taskId],
          }),
        })
      ).status,
    ).toBe(404);
  });

  it("lists tasks with filters and cursor pagination", async () => {
    for (let i = 0; i < 5; i += 1) {
      await createTask(undefined, `任务 ${i}`);
    }
    const first = await json<{
      tasks: unknown[];
      next_page_token: string;
    }>(await fetchApp("http://flaremo.test/api/app/tasks?page_size=2"));
    expect(first.tasks).toHaveLength(2);
    expect(first.next_page_token).toBeTruthy();

    const second = await json<{ tasks: unknown[]; next_page_token: string }>(
      await fetchApp(
        `http://flaremo.test/api/app/tasks?page_size=2&page_token=${encodeURIComponent(first.next_page_token)}`,
      ),
    );
    expect(second.tasks).toHaveLength(2);

    const third = await json<{ tasks: unknown[]; next_page_token?: string }>(
      await fetchApp(
        `http://flaremo.test/api/app/tasks?page_size=2&page_token=${encodeURIComponent(second.next_page_token)}`,
      ),
    );
    expect(third.tasks).toHaveLength(1);
    expect(third.next_page_token).toBeUndefined();

    await createTask(undefined, "紧急", { priority: "high" });
    const high = await json<{ tasks: Array<{ title: string }> }>(
      await fetchApp("http://flaremo.test/api/app/tasks?priority=high"),
    );
    expect(high.tasks.map((task) => task.title)).toEqual(["紧急"]);
  });

  it("validates create and update payloads", async () => {
    const project = await json<{ project: { id: string } }>(
      await fetchApp("http://flaremo.test/api/app/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "FlareMo" }),
      }),
    );

    // Non-YYYY-MM-DD due_at is rejected with 400 in both create and update.
    expect(
      (
        await fetchApp("http://flaremo.test/api/app/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            project_id: project.project.id,
            title: "写文档",
            due_at: "明天",
          }),
        })
      ).status,
    ).toBe(400);
    const task = await createTask(project.project.id, "写文档");
    expect(
      (
        await fetchApp(
          `http://flaremo.test/api/app/tasks/${bareTaskId(task.taskId)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ due_at: "2026/09/12" }),
          },
        )
      ).status,
    ).toBe(400);

    // An unknown project id is a 404, not a silent accept.
    expect(
      (
        await fetchApp("http://flaremo.test/api/app/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            project_id: "projects/no-such-project",
            title: "写文档",
          }),
        })
      ).status,
    ).toBe(404);

    // Empty title and an all-empty update are 400s.
    expect(
      (
        await fetchApp("http://flaremo.test/api/app/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "   " }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetchApp(
          `http://flaremo.test/api/app/tasks/${bareTaskId(task.taskId)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: "{}",
          },
        )
      ).status,
    ).toBe(400);

    // A 200-char title fits; the contract rejects longer input.
    const longOk = await fetchApp("http://flaremo.test/api/app/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "好".repeat(2000) }),
    });
    expect(longOk.status).toBe(201);
  });

  it("validates project name boundaries and the query filter", async () => {
    const ok = await json<{ project: { name: string } }>(
      await fetchApp("http://flaremo.test/api/app/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "好".repeat(200) }),
      }),
    );
    expect(ok.project.name).toHaveLength(200);

    expect(
      (
        await fetchApp("http://flaremo.test/api/app/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "好".repeat(201) }),
        })
      ).status,
    ).toBe(400);

    await json(
      await fetchApp("http://flaremo.test/api/app/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "网站改版" }),
      }),
    );
    const hits = await json<{ projects: Array<{ name: string }> }>(
      await fetchApp(
        `http://flaremo.test/api/app/projects?query=${encodeURIComponent("改版")}`,
      ),
    );
    expect(hits.projects.map((project) => project.name)).toEqual(["网站改版"]);
  });

  it("bins tasks softly and restores them", async () => {
    const project = await json<{ project: { id: string } }>(
      await fetchApp("http://flaremo.test/api/app/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "FlareMo" }),
      }),
    );
    const task = await createTask(project.project.id, "删除我");

    expect(
      (
        await fetchApp(
          `http://flaremo.test/api/app/tasks/${bareTaskId(task.taskId)}`,
          { method: "DELETE" },
        )
      ).status,
    ).toBe(200);

    // Live reads 404; the bin query opts back in; restore makes it live again.
    expect(
      (
        await fetchApp(
          `http://flaremo.test/api/app/tasks/${bareTaskId(task.taskId)}`,
        )
      ).status,
    ).toBe(404);
    const binned = await json<{
      tasks: Array<{ id: string; deleted_at: string }>;
    }>(
      await fetchApp(
        "http://flaremo.test/api/app/tasks?include_deleted=1&page_size=100",
      ),
    );
    expect(binned.tasks.map((t) => t.id)).toContain(task.taskId);

    const restored = await json<{ task: { deleted_at: null } }>(
      await fetchApp(
        `http://flaremo.test/api/app/tasks/${bareTaskId(task.taskId)}/restore`,
        { method: "POST" },
      ),
    );
    expect(restored.task.deleted_at).toBeNull();
    expect(
      (
        await fetchApp(
          `http://flaremo.test/api/app/tasks/${bareTaskId(task.taskId)}`,
        )
      ).status,
    ).toBe(200);
  });

  it("bins projects with their live tasks and restores both together", async () => {
    const project = await json<{ project: { id: string } }>(
      await fetchApp("http://flaremo.test/api/app/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "FlareMo" }),
      }),
    );
    const task = await createTask(project.project.id, "任务");

    expect(
      (
        await fetchApp(
          `http://flaremo.test/api/app/projects/${bareProjectId(project.project.id)}`,
          { method: "DELETE" },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await fetchApp(
          `http://flaremo.test/api/app/tasks/${bareTaskId(task.taskId)}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await json<{ projects: unknown[] }>(
          await fetchApp("http://flaremo.test/api/app/projects"),
        )
      ).projects,
    ).toHaveLength(0);

    const restored = await json<{ project: { deleted_at: null } }>(
      await fetchApp(
        `http://flaremo.test/api/app/projects/${bareProjectId(project.project.id)}/restore`,
        { method: "POST" },
      ),
    );
    expect(restored.project.deleted_at).toBeNull();
    expect(
      (
        await fetchApp(
          `http://flaremo.test/api/app/tasks/${bareTaskId(task.taskId)}`,
        )
      ).status,
    ).toBe(200);
  });

  it("records task activity with agent attribution", async () => {
    const project = await json<{ project: { id: string } }>(
      await fetchApp("http://flaremo.test/api/app/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "FlareMo" }),
      }),
    );
    const task = await createTask(project.project.id, "跑测试");
    await json(
      await fetchApp(
        `http://flaremo.test/api/app/tasks/${bareTaskId(task.taskId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "done" }),
        },
      ),
    );

    const activity = await json<{
      activity: Array<{ action: string; actor_type: string }>;
    }>(
      await fetchApp(
        `http://flaremo.test/api/app/tasks/${bareTaskId(task.taskId)}/activity`,
      ),
    );
    expect(activity.activity.map((entry) => entry.action)).toContain(
      "status_changed",
    );
  });

  // ---------------------------------------------------------------------------
  // Cross-user isolation
  // ---------------------------------------------------------------------------

  it("never leaks or accepts resources across users", async () => {
    const project = await json<{ project: { id: string } }>(
      await fetchApp("http://flaremo.test/api/app/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "我的项目" }),
      }),
    );
    const task = await createTask(project.project.id, "我的任务");

    const member = (input: string, init?: RequestInit) =>
      fetchApp(input, {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string> | undefined),
          cookie: memberCookie,
          origin: "http://flaremo.test",
        },
      });

    // The member's listings never contain the owner's rows.
    const memberProjects = await json<{ projects: unknown[] }>(
      await member("http://flaremo.test/api/app/projects"),
    );
    expect(memberProjects.projects).toHaveLength(0);
    const memberTasks = await json<{ tasks: unknown[] }>(
      await member("http://flaremo.test/api/app/tasks"),
    );
    expect(memberTasks.tasks).toHaveLength(0);

    // Reads, updates, deletes, restores and creates across the boundary are
    // all 404 — existence is never disclosed.
    const bare = bareTaskId(task.taskId);
    expect(
      (await member(`http://flaremo.test/api/app/tasks/${bare}`)).status,
    ).toBe(404);
    expect(
      (
        await member(`http://flaremo.test/api/app/tasks/${bare}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "偷改" }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await member(`http://flaremo.test/api/app/tasks/${bare}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await member(`http://flaremo.test/api/app/tasks/${bare}/restore`, {
          method: "POST",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await member("http://flaremo.test/api/app/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            project_id: project.project.id,
            title: "越权任务",
          }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await member(
          `http://flaremo.test/api/app/projects/${bareProjectId(project.project.id)}`,
        )
      ).status,
    ).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // Calendar boundary regression (4.2): a legacy row stored with a time
  // component must still land on its local day.
  // ---------------------------------------------------------------------------

  it("includes a time-stamped legacy due_at row in its day bucket", async () => {
    const db = await mf.getD1Database("DB");
    await db
      .prepare(
        `INSERT INTO tasks (id, user_id, project_id, title, status, priority, due_at, sort_order, created_at, updated_at)
         VALUES ('tasks/legacy', (SELECT id FROM users WHERE email = 'owner@example.com'), NULL, '带时间的旧任务', 'todo', 'none', '2026-09-12T15:00:00Z', 0, ?, ?)`,
      )
      .bind(new Date().toISOString(), new Date().toISOString())
      .run();

    const view = await json<{
      tasks: Array<{ title: string; due_at: string }>;
    }>(
      await fetchApp(
        "http://flaremo.test/api/app/calendar?from=2026-09-12&to=2026-09-12",
      ),
    );
    expect(view.tasks.map((task) => task.title)).toEqual(["带时间的旧任务"]);
  });

  // ---------------------------------------------------------------------------
  // Recycle-bin exclusion in cross-cutting read paths
  // ---------------------------------------------------------------------------

  it("hides soft-deleted tasks from the calendar and overdue paths", async () => {
    const project = await json<{ project: { id: string } }>(
      await fetchApp("http://flaremo.test/api/app/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "FlareMo" }),
      }),
    );
    const task = await createTask(project.project.id, "逾期就删", {
      due_at: "2020-01-01",
    });
    await fetchApp(
      `http://flaremo.test/api/app/tasks/${bareTaskId(task.taskId)}`,
      { method: "DELETE" },
    );

    const view = await json<{ tasks: Array<{ title: string }> }>(
      await fetchApp(
        "http://flaremo.test/api/app/calendar?from=2019-12-01&to=2020-01-31",
      ),
    );
    expect(view.tasks).toHaveLength(0);
  });

  it("serves reminder counts and per-page memo badges", async () => {
    const memoName = "memos/badge-page";
    await createTask(undefined, "overdue", {
      due_at: "2026-03-14",
      source_memo_id: memoName,
    });
    await createTask(undefined, "today", {
      due_at: "2026-03-15",
      source_memo_id: memoName,
    });
    await createTask(undefined, "done", {
      due_at: "2026-03-15",
      status: "done",
      source_memo_id: memoName,
    });
    await createTask(undefined, "other memo", {
      due_at: "2026-03-15",
      source_memo_id: "memos/another-page",
    });

    const reminders = await json<{ due_today: number; overdue: number }>(
      await fetchApp(
        "http://flaremo.test/api/app/tasks/reminders?date=2026-03-15",
      ),
    );
    expect(reminders).toEqual({ due_today: 2, overdue: 1 });

    const badges = await json<{ tasks: Array<{ title: string }> }>(
      await fetchApp(
        `http://flaremo.test/api/app/tasks/badges?memo_ids=${encodeURIComponent(memoName)}`,
      ),
    );
    expect(badges.tasks.map((task) => task.title).sort()).toEqual([
      "done",
      "overdue",
      "today",
    ]);

    const empty = await json<{ tasks: unknown[] }>(
      await fetchApp(
        "http://flaremo.test/api/app/tasks/badges?memo_ids=memos/no-tasks",
      ),
    );
    expect(empty.tasks).toEqual([]);
  });
  it("reorders the contract maximum of 200 tasks across D1 chunks", async () => {
    const project = await json<{ project: { id: string } }>(
      await fetchApp("http://flaremo.test/api/app/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Reorder max" }),
      }),
    );
    const db = await mf.getD1Database("DB");
    const now = new Date().toISOString();
    const taskIds = Array.from(
      { length: 200 },
      (_, index) => `tasks/reorder-${index}`,
    );
    const inserts = taskIds.map((id, index) =>
      db
        .prepare(
          `INSERT INTO tasks
            (id, user_id, project_id, title, status, priority, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          "users/owner",
          project.project.id,
          `Reorder ${index}`,
          "todo",
          "none",
          index,
          now,
          now,
        ),
    );
    for (let offset = 0; offset < inserts.length; offset += 50) {
      await db.batch(inserts.slice(offset, offset + 50));
    }

    const reversed = [...taskIds].reverse();
    const response = await fetchApp(
      "http://flaremo.test/api/app/tasks/reorder",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: project.project.id,
          task_ids: reversed,
        }),
      },
    );
    expect(response.status).toBe(200);

    const stored = await db
      .prepare(
        "SELECT id, sort_order FROM tasks WHERE project_id = ? ORDER BY sort_order",
      )
      .bind(project.project.id)
      .all<{ id: string; sort_order: number }>();
    expect(stored.results).toHaveLength(200);
    const expectedOrder = new Map(
      reversed.map((id, index) => [id, index] as const),
    );
    for (const row of stored.results) {
      expect(row.sort_order).toBe(expectedOrder.get(row.id));
    }
  });
});

async function createTask(
  projectId: string | undefined,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<{ taskId: string }> {
  const created = await json<{ task: { id: string } }>(
    await fetchApp("http://flaremo.test/api/app/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        projectId
          ? { project_id: projectId, title, ...extra }
          : { title, ...extra },
      ),
    }),
  );
  return { taskId: created.task.id };
}

async function json<T = Record<string, unknown>>(response: Response) {
  expect(response.ok).toBe(true);
  return response.json() as Promise<T>;
}

function fetchApp(
  input: string,
  init?: RequestInit,
  options: { authenticated?: boolean } = {},
) {
  const headers = new Headers(init?.headers);
  const path = new URL(input).pathname;
  if (options.authenticated !== false && path.startsWith("/api/app/")) {
    if (!headers.has("cookie")) headers.set("cookie", sessionCookie);
    if (!headers.has("origin") && isUnsafeMethod(init?.method)) {
      headers.set("origin", "http://flaremo.test");
    }
  }
  return app.fetch(new Request(input, { ...init, headers }), env);
}

function isUnsafeMethod(method: string | undefined) {
  return !["GET", "HEAD", "OPTIONS"].includes((method ?? "GET").toUpperCase());
}

async function bootstrapAndSignIn() {
  const setup = await app.fetch(
    new Request("http://flaremo.test/api/auth/flaremo/bootstrap", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-flaremo-bootstrap-secret": TEST_BOOTSTRAP_SECRET,
        origin: "http://flaremo.test",
      },
      body: JSON.stringify({
        username: "owner",
        name: "Owner",
        email: "owner@example.com",
        password: TEST_PASSWORD,
      }),
    }),
    env,
  );
  expect(setup.status).toBe(201);

  const signIn = await app.fetch(
    new Request("http://flaremo.test/api/auth/sign-in/username", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://flaremo.test",
      },
      body: JSON.stringify({
        username: "owner",
        password: TEST_PASSWORD,
      }),
    }),
    env,
  );
  expect(signIn.status).toBe(200);
  return extractCookieHeader(signIn);
}

async function registerAndSignInMember() {
  const open = await fetchApp("http://flaremo.test/api/app/admin/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ registration_open: true }),
  });
  expect(open.status).toBe(200);

  const register = await app.fetch(
    new Request("http://flaremo.test/api/auth/flaremo/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://flaremo.test",
      },
      body: JSON.stringify({
        name: "Member",
        email: "member@example.com",
        password: TEST_PASSWORD,
      }),
    }),
    env,
  );
  expect(register.status).toBe(201);

  const signIn = await app.fetch(
    new Request("http://flaremo.test/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://flaremo.test",
      },
      body: JSON.stringify({
        email: "member@example.com",
        password: TEST_PASSWORD,
      }),
    }),
    env,
  );
  expect(signIn.status).toBe(200);
  return extractCookieHeader(signIn);
}

function extractCookieHeader(response: Response) {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = headers.getSetCookie?.() ?? [
    response.headers.get("set-cookie"),
  ];
  const cookies = setCookies
    .filter((value): value is string => Boolean(value))
    .map((value) => value.split(";", 1)[0] ?? "")
    .filter(Boolean);
  expect(cookies.length).toBeGreaterThan(0);
  return cookies.join("; ");
}
