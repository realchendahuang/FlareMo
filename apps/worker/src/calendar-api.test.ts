import { applyFlaremoMigrations } from "@flaremo/db";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "./index";

function bareId(id: string) {
  return id.replace(/^tasks\//, "");
}

let mf: Miniflare;
let env: Env;
let sessionCookie: string;

const TEST_AUTH_SECRET =
  "test-better-auth-secret-that-is-never-used-in-production";
const TEST_BOOTSTRAP_SECRET =
  "test-bootstrap-secret-that-is-never-used-in-production";
const TEST_PASSWORD = "test-password-not-for-production-123";

describe("FlareMo calendar API", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "flaremo-calendar-api-test" },
      r2Buckets: { ATTACHMENTS: "flaremo-calendar-api-attachments" },
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
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("aggregates notes per day and tasks by due date", async () => {
    await json(
      await fetchApp("http://flaremo.test/api/app/memos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "#test 写在 9 月 12 日" }),
      }),
    );
    // A note written today carries an unchecked Markdown task item.
    await json(
      await fetchApp("http://flaremo.test/api/app/memos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "#today\n- [ ] 修理车库门",
        }),
      }),
    );

    const project = await json<{ project: { id: string } }>(
      await fetchApp("http://flaremo.test/api/app/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "日程" }),
      }),
    );
    await json<{ tasks: unknown[] }>(
      await fetchApp("http://flaremo.test/api/app/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: project.project.id,
          title: "9 月 12 日要开周会",
          due_at: "2026-09-12",
        }),
      }),
    );
    await json<{ tasks: unknown[] }>(
      await fetchApp("http://flaremo.test/api/app/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: project.project.id,
          title: "9 月 13 日交周报",
          due_at: "2026-09-13",
        }),
      }),
    );

    const view = await json<{
      notes: Array<{ date: string; count: number }>;
      note_tasks: Array<{ date: string; count: number }>;
      tasks: Array<{ due_at: string | null; title: string; status: string }>;
    }>(
      await fetchApp(
        "http://flaremo.test/api/app/calendar?from=2026-09-01&to=2026-09-30",
      ),
    );

    expect(view.notes.some((note) => note.count >= 1)).toBe(true);
    expect(
      view.notes.every(
        (note) => note.date >= "2026-09-01" && note.date <= "2026-09-30",
      ),
    ).toBe(true);
    expect(
      view.tasks.find((task) => task.title === "9 月 12 日要开周会"),
    ).toMatchObject({ due_at: "2026-09-12" });

    // The unchecked task list is counted exactly once for its day. The memo
    // above predates stamping, so this proves the content scan fallback too.
    const todayDate = new Date().toISOString().slice(0, 10);
    if (todayDate >= "2026-09-01" && todayDate <= "2026-09-30") {
      expect(view.note_tasks).toEqual([{ date: todayDate, count: 1 }]);
    }

    // A task whose due date falls outside the window stays out.
    const narrow = await json<{ tasks: Array<{ title: string }> }>(
      await fetchApp(
        "http://flaremo.test/api/app/calendar?from=2026-09-12&to=2026-09-12",
      ),
    );
    expect(narrow.tasks.map((task) => task.title)).toEqual([
      "9 月 12 日要开周会",
    ]);

    // Scheduled items leave the open list once marked done.
    const listed = await json<{
      tasks: Array<{ id: string; status: string; title: string }>;
    }>(await fetchApp("http://flaremo.test/api/app/tasks"));
    const weekly = listed.tasks.find(
      (task) => task.title === "9 月 12 日要开周会",
    );
    expect(weekly).toBeDefined();
    await json(
      await fetchApp(
        `http://flaremo.test/api/app/tasks/${bareId(weekly!.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "done" }),
        },
      ),
    );
    const after = await json<{
      tasks: Array<{ title: string; status: string }>;
    }>(
      await fetchApp(
        "http://flaremo.test/api/app/calendar?from=2026-09-01&to=2026-09-30",
      ),
    );
    expect(
      after.tasks.find((task) => task.title === "9 月 12 日要开周会"),
    ).toMatchObject({ status: "done" });
  });

  it("rejects invalid ranges and unauthenticated access", async () => {
    const reversed = await fetchApp(
      "http://flaremo.test/api/app/calendar?from=2026-10-01&to=2026-09-01",
    );
    expect(reversed.status).toBe(400);

    const unauthenticated = await fetchApp(
      "http://flaremo.test/api/app/calendar?from=2026-09-01&to=2026-09-30",
      undefined,
      { authenticated: false },
    );
    expect(unauthenticated.status).toBe(401);
  });
});

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
