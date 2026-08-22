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

describe("FlareMo memory API", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "flaremo-memory-api-test" },
      r2Buckets: { ATTACHMENTS: "flaremo-memory-api-attachments" },
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
    return id.replace(/^memories\//, "");
  }

  it("creates, lists, edits, confirms, locks, and archives a memory", async () => {
    const created = await json<{
      memory: { id: string; verification: string };
    }>(
      await fetchApp("http://flaremo.test/api/app/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "FlareMo 使用 D1 作为事实源",
          type: "semantic",
          kind: "fact",
          scope_type: "global",
          tier: "core",
          importance: 90,
        }),
      }),
    );
    expect(created.memory.verification).toBe("confirmed");

    const listed = await json<{ memories: Array<{ id: string }> }>(
      await fetchApp("http://flaremo.test/api/app/memory"),
    );
    expect(listed.memories).toHaveLength(1);

    const updated = await json<{ memory: { content: string } }>(
      await fetchApp(
        `http://flaremo.test/api/app/memory/${bareId(created.memory.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "FlareMo 使用 D1 作为唯一事实源" }),
        },
      ),
    );
    expect(updated.memory.content).toBe("FlareMo 使用 D1 作为唯一事实源");

    await json(
      await fetchApp(
        `http://flaremo.test/api/app/memory/${bareId(created.memory.id)}/lock`,
        { method: "POST" },
      ),
    );

    const locked = await json<{ memory: { verification: string } }>(
      await fetchApp(
        `http://flaremo.test/api/app/memory/${bareId(created.memory.id)}`,
      ),
    );
    expect(locked.memory.verification).toBe("locked");

    await json(
      await fetchApp(
        `http://flaremo.test/api/app/memory/${bareId(created.memory.id)}/archive`,
        { method: "POST" },
      ),
    );

    const archived = await json<{ memories: Array<{ id: string }> }>(
      await fetchApp("http://flaremo.test/api/app/memory?status=archived"),
    );
    expect(archived.memories).toHaveLength(1);
  });

  it("records revisions on edit and exposes them", async () => {
    const created = await json<{ memory: { id: string } }>(
      await fetchApp("http://flaremo.test/api/app/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "原始内容" }),
      }),
    );
    await fetchApp(
      `http://flaremo.test/api/app/memory/${bareId(created.memory.id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "修改后的内容" }),
      },
    );

    const revisions = await json<{ revisions: Array<{ content: string }> }>(
      await fetchApp(
        `http://flaremo.test/api/app/memory/${bareId(created.memory.id)}/revisions`,
      ),
    );
    expect(revisions.revisions).toHaveLength(1);
    expect(revisions.revisions[0]?.content).toBe("原始内容");
  });

  it("rejects unauthenticated access with 401", async () => {
    const response = await app.fetch(
      new Request("http://flaremo.test/api/app/memory"),
      env,
    );
    expect(response.status).toBe(401);
  });

  it("rejects a secret-bearing memory with MEMORY_SECRET_REJECTED", async () => {
    const response = await fetchApp("http://flaremo.test/api/app/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "token: memos_pat_abc123" }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain("MEMORY_SECRET_REJECTED");
  });

  it("hard deletes via DELETE", async () => {
    const created = await json<{ memory: { id: string } }>(
      await fetchApp("http://flaremo.test/api/app/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "将被删除" }),
      }),
    );
    const deleted = await json(
      await fetchApp(
        `http://flaremo.test/api/app/memory/${bareId(created.memory.id)}`,
        { method: "DELETE" },
      ),
    );
    expect(deleted.ok).toBe(true);

    const listed = await json<{ memories: Array<{ id: string }> }>(
      await fetchApp("http://flaremo.test/api/app/memory"),
    );
    expect(listed.memories).toHaveLength(0);
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
