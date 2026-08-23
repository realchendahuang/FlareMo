import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "./index";

let mf: Miniflare;
let env: Env;
let sessionCookie: string;

const TEST_AUTH_SECRET =
  "test-better-auth-secret-that-is-never-used-in-production";
const TEST_BOOTSTRAP_SECRET =
  "test-bootstrap-secret-that-is-never-used-in-production";
const TEST_PASSWORD = "test-password-not-for-production-123";

describe("FlareMo projects API", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "flaremo-projects-api-test" },
      r2Buckets: { ATTACHMENTS: "flaremo-projects-api-attachments" },
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

    for (const name of [
      "0000_illegal_inhumans.sql",
      "0001_familiar_morph.sql",
      "0002_wooden_professor_monster.sql",
      "0003_equal_maximus.sql",
      "0004_complex_the_enforcers.sql",
      "0005_confused_masque.sql",
      "0007_flat_phil_sheldon.sql",
      "0008_legal_scarecrow.sql",
      "0009_neat_iron_fist.sql",
      "0010_deep_gateway.sql",
      "0011_daffy_ultron.sql",
      "0012_slow_nick_fury.sql",
      "0013_nosy_luke_cage.sql",
    ]) {
      await applyMigration(
        db,
        await readFile(
          resolve(import.meta.dirname, `../../../migrations/${name}`),
          "utf8",
        ),
      );
    }
    sessionCookie = await bootstrapAndSignIn();
  });

  afterEach(async () => {
    await mf.dispose();
  });

  function bareId(id: string) {
    return id.replace(/^projects\//, "");
  }
  function bareTaskId(id: string) {
    return id.replace(/^tasks\//, "");
  }

  it("creates, lists, edits, and deletes a project with task counts", async () => {
    const created = await json<{
      project: {
        id: string;
        task_count_total: number;
        task_count_open: number;
      };
    }>(
      await fetchApp("http://flaremo.test/api/app/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "FlareMo" }),
      }),
    );
    expect(created.project.task_count_total).toBe(0);

    const task = await json<{ task: { id: string } }>(
      await fetchApp("http://flaremo.test/api/app/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: created.project.id,
          title: "写文档",
        }),
      }),
    );
    expect(task.task.id.startsWith("tasks/")).toBe(true);

    const listed = await json<{
      projects: Array<{ id: string; task_count_open: number }>;
    }>(await fetchApp("http://flaremo.test/api/app/projects"));
    expect(listed.projects).toHaveLength(1);
    expect(listed.projects[0]?.task_count_open).toBe(1);

    const updated = await json<{ project: { name: string } }>(
      await fetchApp(
        `http://flaremo.test/api/app/projects/${bareId(created.project.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "FlareMo v2" }),
        },
      ),
    );
    expect(updated.project.name).toBe("FlareMo v2");

    const deleted = await json(
      await fetchApp(
        `http://flaremo.test/api/app/projects/${bareId(created.project.id)}`,
        { method: "DELETE" },
      ),
    );
    expect(deleted.ok).toBe(true);

    const remaining = await json<{ projects: Array<{ id: string }> }>(
      await fetchApp("http://flaremo.test/api/app/projects"),
    );
    expect(remaining.projects).toHaveLength(0);
  });

  it("updates a task status and records agent-labelled activity", async () => {
    const project = await json<{ project: { id: string } }>(
      await fetchApp("http://flaremo.test/api/app/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "FlareMo" }),
      }),
    );
    const task = await json<{ task: { id: string } }>(
      await fetchApp("http://flaremo.test/api/app/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: project.project.id,
          title: "跑测试",
        }),
      }),
    );

    await json(
      await fetchApp(
        `http://flaremo.test/api/app/tasks/${bareTaskId(task.task.id)}`,
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
        `http://flaremo.test/api/app/tasks/${bareTaskId(task.task.id)}/activity`,
      ),
    );
    expect(activity.activity.map((entry) => entry.action)).toContain(
      "status_changed",
    );
  });

  it("rejects unauthenticated access with 401", async () => {
    const response = await app.fetch(
      new Request("http://flaremo.test/api/app/projects"),
      env,
    );
    expect(response.status).toBe(401);
  });

  it("rejects a cross-origin unsafe cookie mutation with 403", async () => {
    const response = await app.fetch(
      new Request("http://flaremo.test/api/app/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          origin: "http://evil.example",
        },
        body: JSON.stringify({ name: "FlareMo" }),
      }),
      env,
    );
    expect(response.status).toBe(403);
  });
});

async function json<T = Record<string, unknown>>(response: Response) {
  expect(response.ok).toBe(true);
  return response.json() as Promise<T>;
}

async function applyMigration(db: D1Database, sql: string) {
  const statements = sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}

function fetchApp(
  input: string,
  init?: RequestInit,
  options: { authenticated?: boolean } = {},
) {
  const headers = new Headers(init?.headers);
  const path = new URL(input).pathname;
  if (options.authenticated !== false && path.startsWith("/api/app/")) {
    headers.set("cookie", sessionCookie);
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
