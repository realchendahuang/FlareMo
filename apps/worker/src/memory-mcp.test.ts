import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "./index";

let mf: Miniflare;
let env: Env;
let patToken: string;

const TEST_AUTH_SECRET =
  "test-better-auth-secret-that-is-never-used-in-production";
const TEST_BOOTSTRAP_SECRET =
  "test-bootstrap-secret-that-is-never-used-in-production";
const TEST_PASSWORD = "test-password-not-for-production-123";

describe("memory MCP endpoint", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "flaremo-memory-mcp-test" },
      r2Buckets: { ATTACHMENTS: "flaremo-memory-mcp-attachments" },
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
    patToken = await bootstrapAndCreatePat();
  });

  afterEach(async () => {
    await mf.dispose();
  });

  function mcpPost(body: unknown) {
    return app.fetch(
      new Request("http://flaremo.test/memory/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${patToken}`,
        },
        body: JSON.stringify(body),
      }),
      env,
    );
  }

  it("serves initialize and tools/list with the six memory tools", async () => {
    const init = await mcpPost({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26" },
    });
    expect(init.status).toBe(200);
    expect(await init.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { serverInfo: { name: "memory" } },
    });

    const list = await mcpPost({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const body = (await list.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      "memory_bootstrap",
      "memory_recall",
      "memory_remember",
      "memory_checkpoint",
      "memory_link",
      "memory_forget",
    ]);
  });

  it("rejects missing PAT with 401", async () => {
    const response = await app.fetch(
      new Request("http://flaremo.test/memory/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      env,
    );
    expect(response.status).toBe(401);
  });

  it("remembers, recalls, links, and forgets through the MCP", async () => {
    const remembered = await mcpPost({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "memory_remember",
        arguments: {
          content: "FlareMo 使用 D1 作为记忆事实源",
          type: "semantic",
          kind: "decision",
          scope_type: "project",
          scope_key: "github:realchendahuang/FlareMo",
          tier: "core",
          importance: 90,
          source_agent: "codex",
        },
      },
    });
    const rememberBody = (await remembered.json()) as {
      result: { structuredContent: { memory: { id: string } } };
    };
    expect(rememberBody.result.structuredContent.memory.id).toMatch(
      /^memories\//,
    );
    const memoryId = rememberBody.result.structuredContent.memory.id;

    const recalled = await mcpPost({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "memory_recall",
        arguments: {
          query: "记忆事实源",
          agent: "codex",
          project_key: "github:realchendahuang/FlareMo",
          limit: 8,
        },
      },
    });
    const recallBody = (await recalled.json()) as {
      result: { structuredContent: { result?: Array<{ content: string }> } };
    };
    // recall returns an array, normalized under structuredContent.result
    const items = recallBody.result.structuredContent.result ?? [];
    expect(items.some((item) => item.content.includes("D1"))).toBe(true);

    const forgot = await mcpPost({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "memory_forget",
        arguments: { memory_id: memoryId, reason: "superseded" },
      },
    });
    const forgetBody = (await forgot.json()) as {
      result: { structuredContent: { status: string } };
    };
    expect(forgetBody.result.structuredContent.status).toBe("superseded");
  });

  it("rejects a secret-bearing memory write via the MCP", async () => {
    const response = await mcpPost({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "memory_remember",
        arguments: { content: "authorization: Bearer secret-token" },
      },
    });
    const body = (await response.json()) as {
      result: {
        isError: boolean;
        structuredContent: { error: { message: string } };
      };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.message).toContain(
      "MEMORY_SECRET_REJECTED",
    );
  });

  it("forbids an agent from locking a memory", async () => {
    const response = await mcpPost({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "memory_remember",
        arguments: { content: "x", verification: "locked" },
      },
    });
    const body = (await response.json()) as {
      result: { isError: boolean };
    };
    expect(body.result.isError).toBe(true);
  });
});

async function applyMigration(db: D1Database, sql: string) {
  const statements = sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}

async function bootstrapAndCreatePat() {
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
  const cookie = extractCookieHeader(signIn);

  const pat = await app.fetch(
    new Request("http://flaremo.test/api/app/account/personal-access-tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: "http://flaremo.test",
      },
      body: JSON.stringify({ name: "test-pat", expires_in_days: 30 }),
    }),
    env,
  );
  expect(pat.status).toBe(201);
  const body = (await pat.json()) as { token: string };
  return body.token;
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
  return cookies.join("; ");
}
