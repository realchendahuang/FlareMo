import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ListMemosResponse, MemoStatsResponse } from "@flaremo/contracts";
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
      compatibilityDate: "2026-07-10",
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
    const v020 = await readFile(
      resolve(
        import.meta.dirname,
        "../../../migrations/0002_wooden_professor_monster.sql",
      ),
      "utf8",
    );
    await applyMigration(db, migration);
    await applyMigration(db, cleanup);
    await applyMigration(db, v020);
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

  it("initializes the single owner idempotently under concurrent requests", async () => {
    const [memosResponse, statsResponse] = await Promise.all([
      fetchApp("http://flaremo.test/api/app/memos"),
      fetchApp("http://flaremo.test/api/app/stats?time_zone=UTC"),
    ]);
    expect(memosResponse.status).toBe(200);
    expect(statsResponse.status).toBe(200);
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

  it("returns app memos with inline attachments and accurate stats", async () => {
    const memo = await json<{ name: string }>(
      await fetchApp("http://flaremo.test/api/app/memos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "frontend hardening #exact",
          payload: { tags: ["exact"] },
        }),
      }),
    );
    await json(
      await fetchApp("http://flaremo.test/api/app/memos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "similar tag #exactly",
          payload: { tags: ["exactly"] },
        }),
      }),
    );

    const formData = new FormData();
    formData.set("memo", memo.name);
    formData.set(
      "file",
      new File(["inline attachment"], "inline.txt", { type: "text/plain" }),
    );
    await json(
      await fetchApp("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        body: formData,
      }),
    );

    const list = await json<ListMemosResponse>(
      await fetchApp(
        "http://flaremo.test/api/app/memos?state=normal&tag=exact&page_size=30",
      ),
    );
    expect(list.memos).toHaveLength(1);
    expect(list.memos[0].attachments).toHaveLength(1);
    expect(list.memos[0].attachments[0].filename).toBe("inline.txt");

    const stats = await json<MemoStatsResponse>(
      await fetchApp(
        "http://flaremo.test/api/app/stats?time_zone=Asia%2FShanghai",
      ),
    );
    expect(stats.counts).toEqual({
      normal: 2,
      archived: 0,
      trashed: 0,
      total: 2,
    });
    expect(stats.tags).toEqual([
      { name: "exact", count: 1 },
      { name: "exactly", count: 1 },
    ]);
    expect(stats.activity).toHaveLength(84);
    expect(
      stats.activity.reduce(
        (total: number, day: { count: number }) => total + day.count,
        0,
      ),
    ).toBe(2);
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

  it("searches content and exposes revisions, backlinks, and share lifecycle", async () => {
    const original = await createMemo("needle-lantern original #history");
    const backlink = await createMemo("memo linking to the original");

    const search = await json(
      await fetchApp("http://flaremo.test/api/v1/memos?q=needle-lantern"),
    );
    expect(search.memos.map((memo: { name: string }) => memo.name)).toEqual([
      original.name,
    ]);

    await json(
      await fetchApp(`http://flaremo.test/api/v1/${backlink.name}/relations`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          relations: [{ related_memo: original.name, type: "reference" }],
        }),
      }),
    );
    await json(
      await fetchApp(`http://flaremo.test/api/v1/${original.name}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "updated content" }),
      }),
    );

    const context = await json(
      await fetchApp(
        `http://flaremo.test/api/app/memos/${encodeURIComponent(original.id)}`,
      ),
    );
    expect(context.memo.content).toBe("updated content");
    expect(context.backlinks[0].memo.name).toBe(backlink.name);
    expect(context.revisions[0].content).toBe(
      "needle-lantern original #history",
    );

    const restored = await json(
      await fetchApp(
        `http://flaremo.test/api/v1/${original.name}/revisions/restore`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ revision: context.revisions[0].name }),
        },
      ),
    );
    expect(restored.content).toBe("needle-lantern original #history");

    const share = await json(
      await fetchApp(`http://flaremo.test/api/v1/${original.name}/shares`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    const shares = await json(
      await fetchApp(`http://flaremo.test/api/v1/${original.name}/shares`),
    );
    expect(shares.shares).toHaveLength(1);
    const revoked = await json(
      await fetchApp(`http://flaremo.test/api/v1/shares/${share.id}`, {
        method: "DELETE",
      }),
    );
    expect(revoked.revoked_at).toEqual(expect.any(String));
    expect(
      await fetchApp(`http://flaremo.test/api/public/shares/${share.token}`),
    ).toMatchObject({ status: 404 });
  });

  it("supports byte ranges, hard-delete cleanup, and scheduled orphan cleanup", async () => {
    const memo = await createMemo("attachment lifecycle");
    const formData = new FormData();
    formData.set("memo", memo.name);
    formData.set(
      "file",
      new File(["0123456789"], "range.txt", { type: "text/plain" }),
    );
    const attachment = await json(
      await fetchApp("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        body: formData,
      }),
    );

    const partial = await fetchApp(
      `http://flaremo.test/api/v1/${attachment.name}/blob?disposition=inline`,
      { headers: { range: "bytes=2-5" } },
    );
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await partial.text()).toBe("2345");

    await json(
      await fetchApp(`http://flaremo.test/api/app/memos/${memo.id}?hard=true`, {
        method: "DELETE",
      }),
    );
    expect(
      await fetchApp(`http://flaremo.test/api/v1/${attachment.name}`),
    ).toMatchObject({ status: 404 });

    const orphanData = new FormData();
    orphanData.set(
      "file",
      new File(["orphan"], "orphan.txt", { type: "text/plain" }),
    );
    const orphan = await json(
      await fetchApp("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        body: orphanData,
      }),
    );
    await app.scheduled(
      {
        scheduledTime: Date.now() + 2 * 24 * 60 * 60 * 1_000,
      } as ScheduledController,
      env,
    );
    expect(
      await fetchApp(`http://flaremo.test/api/v1/${orphan.name}`),
    ).toMatchObject({ status: 404 });
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
