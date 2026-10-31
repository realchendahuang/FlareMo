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

    const window = calendarWindow();
    const view = await json<{
      notes: Array<{ date: string; count: number }>;
      note_tasks: Array<{ date: string; count: number }>;
      tasks: Array<{ due_at: string | null; title: string; status: string }>;
    }>(
      await fetchApp(
        `http://flaremo.test/api/app/calendar?from=${window.from}&to=${window.to}`,
      ),
    );

    expect(view.notes.some((note) => note.count >= 1)).toBe(true);
    expect(view.notes.every((note) => withinWindow(note.date, window))).toBe(
      true,
    );
    expect(
      view.tasks.find((task) => task.title === "9 月 12 日要开周会"),
    ).toMatchObject({ due_at: "2026-09-12" });

    // The unchecked task list is counted exactly once for its day. The memo
    // above predates stamping, so this proves the content scan fallback too.
    const todayDate = new Date().toISOString().slice(0, 10);
    if (withinWindow(todayDate, window)) {
      expect(view.note_tasks).toEqual([{ date: todayDate, count: 1 }]);
    }

    // Day bucketing follows the client's time zone: with tz = getTimezoneOffset()
    // (e.g. -480 for UTC+8) the note lands on its local day, not the UTC day.
    // Use the test machine's own offset, whatever zone it runs in.
    const machineTz = new Date().getTimezoneOffset();
    const mzView = await json<{
      notes: Array<{ date: string; count: number }>;
    }>(
      await fetchApp(
        `http://flaremo.test/api/app/calendar?from=${window.from}&to=${window.to}&tz=${machineTz}`,
      ),
    );
    const localToday = new Date(Date.now() - machineTz * 60_000)
      .toISOString()
      .slice(0, 10);
    if (withinWindow(localToday, window)) {
      const localNote = mzView.notes.find((note) => note.date === localToday);
      expect(localNote?.count).toBeGreaterThan(0);
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
        `http://flaremo.test/api/app/tasks/${bareId(weekly?.id)}`,
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

  it("returns 24-hour activity buckets for a given date", async () => {
    await json(
      await fetchApp("http://flaremo.test/api/app/memos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "一条小时测试笔记" }),
      }),
    );

    // The endpoint's `date` is a *local* calendar date (it is paired with
    // `tz` below), so it has to be formatted in local time. Deriving it from
    // `toISOString()` instead picks the UTC date, and between local midnight
    // and 08:00 in any negative-offset-of-UTC zone such as Asia/Shanghai the
    // two differ — the memo just written then falls outside the window the
    // test asks about, and the assertion below fails for several hours a day.
    const today = new Intl.DateTimeFormat("en-CA").format(new Date());
    const tz = new Date().getTimezoneOffset();
    const res = await fetchApp(
      `http://flaremo.test/api/app/stats/hourly?date=${today}&tz=${tz}`,
    );
    expect(res.status).toBe(200);
    const data = await json<{ hours: Array<{ hour: number; count: number }> }>(
      res,
    );
    expect(data.hours).toHaveLength(24);
    expect(data.hours[0]?.hour).toBe(0);
    expect(data.hours[23]?.hour).toBe(23);
    const totalCount = data.hours.reduce((acc, h) => acc + h.count, 0);
    expect(totalCount).toBeGreaterThanOrEqual(1);

    const unauthenticated = await fetchApp(
      `http://flaremo.test/api/app/stats/hourly?date=${today}`,
      undefined,
      { authenticated: false },
    );
    expect(unauthenticated.status).toBe(401);
  });

  it("rejects an hourly range longer than a month", async () => {
    const res = await fetchApp(
      "http://flaremo.test/api/app/stats/hourly?from=2020-01-01&to=2026-01-01",
    );
    expect(res.status).toBe(400);
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

// Scheduled tasks in this suite are pinned to fixed September dates while
// the notes are stamped with the current time. Anchor the query window on the
// union of the two, so the test keeps asserting after September instead of
// expiring on a calendar boundary: it failed from 2026-10-01 onward, and the
// note_tasks guard below was masking the same calendar assumption there.
const SEPTEMBER_START = "2026-09-01";
const SEPTEMBER_END = "2026-09-30";

type DateWindow = { from: string; to: string };

function calendarWindow(now = new Date()): DateWindow {
  const utcToday = now.toISOString().slice(0, 10);
  return {
    from: utcToday < SEPTEMBER_START ? utcToday : SEPTEMBER_START,
    to: utcToday > SEPTEMBER_END ? utcToday : SEPTEMBER_END,
  };
}

function withinWindow(key: string, window: DateWindow): boolean {
  return key >= window.from && key <= window.to;
}
