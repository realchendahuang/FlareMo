import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "./index";

let mf: Miniflare;
let env: Env;

describe("FlareMo Worker API", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-06-27",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: {
        DB: "flaremo-test",
      },
      r2Buckets: {
        ATTACHMENTS: "flaremo-attachments-test",
      },
    });

    const db = await mf.getD1Database("DB");
    const r2 = await mf.getR2Bucket("ATTACHMENTS");
    env = {
      DB: db,
      ATTACHMENTS: r2,
      ASSETS: {
        fetch: async () => new Response("asset", { status: 200 }),
      } as Fetcher,
      FLAREMO_SINGLE_USER_EMAIL: "owner@example.com",
      FLAREMO_SINGLE_USER_NAME: "Owner",
    };

    const migration = await readFile(
      resolve(
        import.meta.dirname,
        "../../../migrations/0000_illegal_inhumans.sql",
      ),
      "utf8",
    );
    const cleanup = await readFile(
      resolve(
        import.meta.dirname,
        "../../../migrations/0001_familiar_morph.sql",
      ),
      "utf8",
    );
    await applyMigration(db, migration);
    await applyMigration(db, cleanup);
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("supports memo CRUD, tag filtering, trash, OpenAPI, and MCP", async () => {
    const created = await json(
      await fetchApp("http://flaremo.test/api/v1/memos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "hello #idea",
          visibility: "private",
          payload: { tags: ["idea"] },
        }),
      }),
    );

    expect(created.name).toMatch(/^memos\//);

    const byTag = await json(
      await fetchApp("http://flaremo.test/api/v1/memos?tag=idea"),
    );
    expect(byTag.memos).toHaveLength(1);

    const openapi = await json(
      await fetchApp("http://flaremo.test/openapi.json"),
    );
    expect(openapi.paths["/api/v1/memos"]).toBeTruthy();

    const mcpTools = await json(
      await fetchApp("http://flaremo.test/api/v1/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect(
      mcpTools.result.tools.map((tool: { name: string }) => tool.name),
    ).toContain("create_memo");

    const trashed = await json(
      await fetchApp(`http://flaremo.test/api/v1/${created.name}`, {
        method: "DELETE",
      }),
    );
    expect(trashed.state).toBe("trashed");
  });

  it("paginates memos with page tokens", async () => {
    await createMemo("page first");
    await new Promise((resolve) => setTimeout(resolve, 2));
    await createMemo("page second");
    await new Promise((resolve) => setTimeout(resolve, 2));
    await createMemo("page third");

    const firstPage = await json(
      await fetchApp(
        "http://flaremo.test/api/v1/memos?page_size=2&order_by=created_at asc",
      ),
    );
    expect(firstPage.memos).toHaveLength(2);
    expect(
      firstPage.memos.map((memo: { content: string }) => memo.content),
    ).toEqual(["page first", "page second"]);
    expect(firstPage.next_page_token).toBeTruthy();

    const secondPage = await json(
      await fetchApp(
        `http://flaremo.test/api/v1/memos?page_size=2&order_by=created_at asc&page_token=${encodeURIComponent(firstPage.next_page_token)}`,
      ),
    );
    expect(
      secondPage.memos.map((memo: { content: string }) => memo.content),
    ).toEqual(["page third"]);
    expect(secondPage.next_page_token).toBeUndefined();
  });

  it("uploads, binds, downloads, and deletes attachments through R2 and D1", async () => {
    const memo = await createMemo("with file");

    const formData = new FormData();
    formData.set("memo", memo.name);
    formData.set(
      "file",
      new File(["hello attachment"], "hello.txt", { type: "text/plain" }),
    );
    const attachment = await json(
      await fetchApp("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        body: formData,
      }),
    );
    expect(attachment.name).toMatch(/^attachments\//);

    const bound = await json(
      await fetchApp(`http://flaremo.test/api/v1/${memo.name}/attachments`),
    );
    expect(bound.attachments).toHaveLength(1);

    const blob = await fetchApp(
      `http://flaremo.test/api/v1/${attachment.name}/blob`,
    );
    expect(await blob.text()).toBe("hello attachment");

    const deleted = await json(
      await fetchApp(`http://flaremo.test/api/v1/${attachment.name}`, {
        method: "DELETE",
      }),
    );
    expect(deleted.ok).toBe(true);
  });

  it("creates relations, shares, and export/import bundles", async () => {
    const first = await createMemo("first");
    const second = await createMemo("second");

    const relations = await json(
      await fetchApp(`http://flaremo.test/api/v1/${first.name}/relations`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          relations: [{ related_memo: second.name, type: "reference" }],
        }),
      }),
    );
    expect(relations.relations).toHaveLength(1);

    const share = await json(
      await fetchApp(`http://flaremo.test/api/v1/${first.name}/shares`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(share.token).toBeTruthy();

    const bundle = await json(
      await fetchApp("http://flaremo.test/api/v1/export"),
    );
    expect(bundle.memos.length).toBeGreaterThanOrEqual(2);

    const result = await json(
      await fetchApp("http://flaremo.test/api/v1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bundle),
      }),
    );
    expect(result.imported_memos).toBeGreaterThanOrEqual(2);
  });

  it("serves public share content and attachments by token only", async () => {
    const memo = await createMemo("shareable memo #public");
    const formData = new FormData();
    formData.set("memo", memo.name);
    formData.set(
      "file",
      new File(["shared attachment"], "shared.txt", { type: "text/plain" }),
    );
    await json(
      await fetchApp("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        body: formData,
      }),
    );

    const share = await json(
      await fetchApp(`http://flaremo.test/api/v1/${memo.name}/shares`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    const publicShare = await json(
      await fetchApp(`http://flaremo.test/api/public/shares/${share.token}`),
    );
    expect(publicShare.memo.content).toBe("shareable memo #public");
    expect(publicShare.share.token).toBeUndefined();
    expect(publicShare.attachments[0].download_url).toContain(
      `/api/public/shares/${share.token}/attachments/`,
    );

    const blob = await fetchApp(
      `http://flaremo.test${publicShare.attachments[0].download_url}`,
    );
    expect(blob.ok).toBe(true);
    expect(await blob.text()).toBe("shared attachment");

    const otherMemo = await createMemo("not shared");
    const otherFormData = new FormData();
    otherFormData.set("memo", otherMemo.name);
    otherFormData.set(
      "file",
      new File(["not shared"], "private.txt", { type: "text/plain" }),
    );
    const otherAttachment = await json(
      await fetchApp("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        body: otherFormData,
      }),
    );
    const forbiddenBlob = await fetchApp(
      `http://flaremo.test/api/public/shares/${share.token}/attachments/${otherAttachment.id}/blob`,
    );
    expect(forbiddenBlob.status).toBe(404);

    await json(
      await fetchApp(`http://flaremo.test/api/v1/${memo.name}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      }),
    );
    const archivedShare = await fetchApp(
      `http://flaremo.test/api/public/shares/${share.token}`,
    );
    expect(archivedShare.status).toBe(404);
  });
});

function fetchApp(input: string, init?: RequestInit) {
  return app.fetch(new Request(input, init), env);
}

async function createMemo(content: string) {
  return json(
    await fetchApp("http://flaremo.test/api/v1/memos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }),
  );
}

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
