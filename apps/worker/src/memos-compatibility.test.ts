import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FLAREMO_API_VERSION } from "@flaremo/contracts";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "./index";

let mf: Miniflare;
let env: Env;

describe("Memos-compatible API contract", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: {
        DB: "flaremo-memos-compat-test",
      },
      r2Buckets: {
        ATTACHMENTS: "flaremo-memos-compat-attachments-test",
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

    await applyMigration(
      db,
      await readFile(
        resolve(
          import.meta.dirname,
          "../../../migrations/0000_illegal_inhumans.sql",
        ),
        "utf8",
      ),
    );
    await applyMigration(
      db,
      await readFile(
        resolve(
          import.meta.dirname,
          "../../../migrations/0001_familiar_morph.sql",
        ),
        "utf8",
      ),
    );
    await applyMigration(
      db,
      await readFile(
        resolve(
          import.meta.dirname,
          "../../../migrations/0002_wooden_professor_monster.sql",
        ),
        "utf8",
      ),
    );
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("keeps core memo DTO shape stable", async () => {
    const created = await json(
      await fetchApp("http://flaremo.test/api/v1/memos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "contract memo #compat",
          visibility: "protected",
          payload: {
            tags: ["compat"],
            property: { has_link: true },
          },
        }),
      }),
      201,
    );

    expect(created).toMatchObject({
      name: expect.stringMatching(/^memos\//),
      id: expect.any(String),
      content: "contract memo #compat",
      visibility: "protected",
      state: "normal",
      pinned: false,
      creator: expect.stringMatching(/^users\//),
      payload: {
        tags: ["compat"],
      },
    });
    expect(created.create_time).toEqual(expect.any(String));
    expect(created.update_time).toEqual(expect.any(String));
    expect(created.display_time).toEqual(expect.any(String));

    const listed = await json(
      await fetchApp("http://flaremo.test/api/v1/memos?tag=compat"),
    );
    expect(listed.memos).toHaveLength(1);
    expect(listed.memos[0].name).toBe(created.name);

    const updated = await json(
      await fetchApp(`http://flaremo.test/api/v1/${created.name}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned: true, visibility: "public" }),
      }),
    );
    expect(updated.pinned).toBe(true);
    expect(updated.visibility).toBe("public");
  });

  it("covers the complete memo CRUD contract and field mutations", async () => {
    const created = await json(
      await fetchApp("http://flaremo.test/api/v1/memos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "complete CRUD #alpha",
          visibility: "private",
          source: "compat-fixture",
          payload: { tags: ["alpha"], client_id: "fixture-client" },
        }),
      }),
      201,
    );

    const fetched = await json(
      await fetchApp(`http://flaremo.test/api/v1/${created.name}`),
    );
    expect(fetched).toEqual(created);

    const updated = await json(
      await fetchApp(`http://flaremo.test/api/v1/${created.name}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "updated CRUD #beta",
          visibility: "protected",
          status: "archived",
          pinned: true,
          payload: { tags: ["beta"], client_id: "updated-client" },
        }),
      }),
    );
    expect(updated).toMatchObject({
      name: created.name,
      id: created.id,
      content: "updated CRUD #beta",
      visibility: "protected",
      state: "archived",
      pinned: true,
      creator: created.creator,
      payload: { tags: ["beta"], client_id: "updated-client" },
    });
    expect(Date.parse(updated.update_time)).toBeGreaterThanOrEqual(
      Date.parse(created.update_time),
    );

    const trashed = await json(
      await fetchApp(`http://flaremo.test/api/v1/${created.name}`, {
        method: "DELETE",
      }),
    );
    expect(trashed).toMatchObject({
      name: created.name,
      state: "trashed",
      pinned: true,
    });

    const hardDeleted = await json(
      await fetchApp(`http://flaremo.test/api/v1/${created.name}?hard=true`, {
        method: "DELETE",
      }),
    );
    expect(hardDeleted).toEqual({ ok: true });
    expect(
      (await fetchApp(`http://flaremo.test/api/v1/${created.name}`)).status,
    ).toBe(404);
  });

  it("combines state, visibility, pinned, tag, pagination, and ordering", async () => {
    const normalAlpha = await createMemoWith({
      content: "normal alpha #alpha",
      visibility: "private",
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const publicAlpha = await createMemoWith({
      content: "public alpha #alpha",
      visibility: "public",
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const archivedBeta = await createMemoWith({
      content: "archived beta #beta",
      visibility: "protected",
    });

    await json(
      await fetchApp(`http://flaremo.test/api/v1/${publicAlpha.name}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned: true }),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 2));
    await json(
      await fetchApp(`http://flaremo.test/api/v1/${archivedBeta.name}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "archived",
          content: "archived beta revised #beta",
        }),
      }),
    );

    const alpha = await listMemos("state=normal&tag=alpha");
    expect(alpha.memos.map((memo: { name: string }) => memo.name)).toEqual([
      publicAlpha.name,
      normalAlpha.name,
    ]);
    expect(
      alpha.memos.every(
        (memo: { payload: { tags?: string[] }; state: string }) =>
          memo.state === "normal" && memo.payload.tags?.includes("alpha"),
      ),
    ).toBe(true);

    const archived = await listMemos("state=archived&tag=beta");
    expect(archived.memos).toHaveLength(1);
    expect(archived.memos[0]).toMatchObject({
      name: archivedBeta.name,
      state: "archived",
      visibility: "protected",
      pinned: false,
    });

    for (const orderBy of [
      "created_at asc",
      "created_at desc",
      "updated_at asc",
      "updated_at desc",
    ]) {
      const names: string[] = [];
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          include_deleted: "true",
          order_by: orderBy,
          page_size: "1",
        });
        if (pageToken) params.set("page_token", pageToken);
        const page = await listMemos(params.toString());
        names.push(...page.memos.map((memo: { name: string }) => memo.name));
        pageToken = page.next_page_token;
      } while (pageToken);

      expect(new Set(names)).toEqual(
        new Set([normalAlpha.name, publicAlpha.name, archivedBeta.name]),
      );
      expect(names[0]).toBe(publicAlpha.name);
    }

    const firstPage = await listMemos(
      "include_deleted=true&page_size=1&order_by=created_at%20asc",
    );
    const mismatchedToken = await fetchApp(
      `http://flaremo.test/api/v1/memos?include_deleted=true&page_size=1&order_by=created_at%20desc&page_token=${encodeURIComponent(firstPage.next_page_token)}`,
    );
    expect(mismatchedToken.status).toBe(400);
  });

  it("roundtrips attachments through export and import", async () => {
    const memo = await createMemo("exportable memo #bundle");
    const formData = new FormData();
    formData.set("memo", memo.name);
    formData.set(
      "file",
      new File(["bundle attachment"], "bundle.txt", { type: "text/plain" }),
    );

    const attachment = await json(
      await fetchApp("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        body: formData,
      }),
      201,
    );

    const bundle = await json(
      await fetchApp("http://flaremo.test/api/v1/export"),
    );
    const exportedAttachment = bundle.attachments.find(
      (item: { name: string }) => item.name === attachment.name,
    );
    expect(exportedAttachment).toMatchObject({
      name: attachment.name,
      filename: "bundle.txt",
      content_type: "text/plain",
      data_base64: "YnVuZGxlIGF0dGFjaG1lbnQ=",
    });

    const imported = await json(
      await fetchApp("http://flaremo.test/api/v1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bundle),
      }),
    );
    expect(imported.imported_memos).toBeGreaterThanOrEqual(1);
    expect(imported.imported_attachments).toBeGreaterThanOrEqual(1);

    const objectsAfterDuplicate = await env.ATTACHMENTS.list();
    const skipped = await json(
      await fetchApp("http://flaremo.test/api/v1/import?conflict=skip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bundle),
      }),
    );
    expect(skipped.imported_memos).toBe(0);
    expect(skipped.skipped_memos).toBeGreaterThanOrEqual(1);
    expect(skipped.imported_attachments).toBe(0);
    expect((await env.ATTACHMENTS.list()).objects).toHaveLength(
      objectsAfterDuplicate.objects.length,
    );

    const overwritten = await json(
      await fetchApp("http://flaremo.test/api/v1/import?conflict=overwrite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bundle),
      }),
    );
    expect(overwritten.overwritten_memos).toBeGreaterThanOrEqual(1);
    expect(overwritten.imported_attachments).toBeGreaterThanOrEqual(1);
    expect((await env.ATTACHMENTS.list()).objects).toHaveLength(
      objectsAfterDuplicate.objects.length,
    );
  });

  it("documents every supported public path in OpenAPI", async () => {
    const openapi = await json(
      await fetchApp("http://flaremo.test/openapi.json"),
    );
    expect(openapi.info.version).toBe(FLAREMO_API_VERSION);
    const paths = Object.keys(openapi.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/api/v1/memos",
        "/api/v1/memos/{id}",
        "/api/v1/memos/{id}/attachments",
        "/api/v1/memos/{id}/context",
        "/api/v1/memos/{id}/relation-context",
        "/api/v1/memos/{id}/relations",
        "/api/v1/memos/{id}/revisions",
        "/api/v1/memos/{id}/revisions/restore",
        "/api/v1/memos/{id}/shares",
        "/api/v1/shares/{share_id}",
        "/api/public/shares/{token}",
        "/api/public/shares/{token}/attachments/{id}/blob",
        "/api/v1/attachments",
        "/api/v1/attachments/{id}",
        "/api/v1/attachments/{id}/blob",
        "/api/v1/export",
        "/api/v1/import",
        "/api/v1/mcp",
        "/openapi.json",
      ]),
    );
  });

  it("keeps public share attachments isolated by share token", async () => {
    const sharedMemo = await createMemo("share isolation memo");
    const sharedFormData = new FormData();
    sharedFormData.set("memo", sharedMemo.name);
    sharedFormData.set(
      "file",
      new File(["shared"], "shared.txt", { type: "text/plain" }),
    );

    const sharedAttachment = await json(
      await fetchApp("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        body: sharedFormData,
      }),
      201,
    );
    expect(sharedAttachment.name).toMatch(/^attachments\//);

    const share = await json(
      await fetchApp(`http://flaremo.test/api/v1/${sharedMemo.name}/shares`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      201,
    );

    const privateMemo = await createMemo("private attachment memo");
    const privateFormData = new FormData();
    privateFormData.set("memo", privateMemo.name);
    privateFormData.set(
      "file",
      new File(["private"], "private.txt", { type: "text/plain" }),
    );
    const privateAttachment = await json(
      await fetchApp("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        body: privateFormData,
      }),
      201,
    );

    const publicShare = await json(
      await fetchApp(`http://flaremo.test/api/public/shares/${share.token}`),
    );
    expect(publicShare.attachments[0].download_url).toContain(
      sharedAttachment.id,
    );

    const sharedBlob = await fetchApp(
      `http://flaremo.test${publicShare.attachments[0].download_url}`,
    );
    expect(sharedBlob.status).toBe(200);
    expect(await sharedBlob.text()).toBe("shared");

    const privateBlob = await fetchApp(
      `http://flaremo.test/api/public/shares/${share.token}/attachments/${privateAttachment.id}/blob`,
    );
    expect(privateBlob.status).toBe(404);
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
    201,
  );
}

async function createMemoWith(input: {
  content: string;
  visibility: "private" | "protected" | "public";
}) {
  return json(
    await fetchApp("http://flaremo.test/api/v1/memos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
    201,
  );
}

async function listMemos(query: string) {
  return json<{
    memos: Array<Record<string, unknown>>;
    next_page_token?: string;
  }>(await fetchApp(`http://flaremo.test/api/v1/memos?${query}`));
}

async function json<T = Record<string, unknown>>(
  response: Response,
  status = 200,
) {
  expect(response.status).toBe(status);
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
