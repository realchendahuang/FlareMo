import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  DeleteTagResponse,
  ListMemosResponse,
  MemoContextResponse,
  MemoStatsResponse,
  RenameTagResponse,
  TagHierarchyResponse,
} from "@flaremo/contracts";
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
      FLAREMO_DEPLOY_REPOSITORY: "example/flaremo",
      FLAREMO_SINGLE_USER_EMAIL: "owner@example.com",
      FLAREMO_SINGLE_USER_NAME: "Owner",
      FLAREMO_PUBLIC_URL: "http://flaremo.test",
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      FLAREMO_BOOTSTRAP_SECRET: TEST_BOOTSTRAP_SECRET,
    } as Env;

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
    const offlineCapture = await readFile(
      resolve(
        import.meta.dirname,
        "../../../migrations/0003_equal_maximus.sql",
      ),
      "utf8",
    );
    const offlineAttachments = await readFile(
      resolve(
        import.meta.dirname,
        "../../../migrations/0004_complex_the_enforcers.sql",
      ),
      "utf8",
    );
    const nativeAuth = await readFile(
      resolve(
        import.meta.dirname,
        "../../../migrations/0005_confused_masque.sql",
      ),
      "utf8",
    );
    const sseEvents = await readFile(
      resolve(
        import.meta.dirname,
        "../../../migrations/0007_flat_phil_sheldon.sql",
      ),
      "utf8",
    );
    const userServiceParity = await readFile(
      resolve(
        import.meta.dirname,
        "../../../migrations/0008_legal_scarecrow.sql",
      ),
      "utf8",
    );
    const webhookOutbox = await readFile(
      resolve(
        import.meta.dirname,
        "../../../migrations/0009_neat_iron_fist.sql",
      ),
      "utf8",
    );
    const dataTasks = await readFile(
      resolve(import.meta.dirname, "../../../migrations/0010_deep_gateway.sql"),
      "utf8",
    );
    await applyMigration(db, migration);
    await applyMigration(db, cleanup);
    await applyMigration(db, v020);
    await applyMigration(db, offlineCapture);
    await applyMigration(db, offlineAttachments);
    await applyMigration(db, nativeAuth);
    await applyMigration(db, sseEvents);
    await applyMigration(db, userServiceParity);
    await applyMigration(db, webhookOutbox);
    await applyMigration(db, dataTasks);
    sessionCookie = await bootstrapAndSignIn();
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
      await fetchApp("http://flaremo.test/openapi.json", {
        headers: { "x-flaremo-wire": "legacy" },
      }),
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

  it("supports full-text query filters while preserving explicit state", async () => {
    const normal = await createMemo<{ id: string; name: string }>(
      "scope-marker timeline",
    );
    const archived = await createMemo<{ id: string; name: string }>(
      "scope-marker archive",
    );
    const trashed = await createMemo<{ id: string; name: string }>(
      "scope-marker trash",
    );
    await json(
      await fetchApp(`http://flaremo.test/api/v1/${archived.name}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      }),
    );
    await json(
      await fetchApp(`http://flaremo.test/api/v1/${trashed.name}`, {
        method: "DELETE",
      }),
    );

    const pinned = await createMemo<{ id: string; name: string }>(
      "pinned-marker",
    );
    await json(
      await fetchApp(`http://flaremo.test/api/v1/${pinned.name}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned: true }),
      }),
    );

    const withAttachment = await createMemo<{ id: string; name: string }>(
      "attachment-marker",
    );
    const formData = new FormData();
    formData.set("memo", withAttachment.name);
    formData.set(
      "file",
      new File(["filter attachment"], "filter.txt", { type: "text/plain" }),
    );
    await json(
      await fetchApp("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        body: formData,
      }),
    );

    const beforeRange = await createMemo<{ id: string; name: string }>(
      "date-window-marker before",
    );
    const inRange = await createMemo<{ id: string; name: string }>(
      "date-window-marker in",
    );
    await env.DB.prepare("UPDATE memos SET created_at = ? WHERE id = ?")
      .bind("2026-03-31T23:59:59.999Z", beforeRange.name)
      .run();
    await env.DB.prepare("UPDATE memos SET created_at = ? WHERE id = ?")
      .bind("2026-04-01T12:00:00.000Z", inRange.name)
      .run();

    const literal = await createMemo<{ id: string; name: string }>(
      "literal before:2026-02-30",
    );

    const listByQuery = async (q: string, path = "/api/app/memos") => {
      const separator = path.includes("?") ? "&" : "?";
      return json<ListMemosResponse>(
        await fetchApp(
          `http://flaremo.test${path}${separator}q=${encodeURIComponent(q)}`,
        ),
      );
    };

    expect(
      (await listByQuery("scope-marker in:timeline")).memos.map(
        (memo) => memo.name,
      ),
    ).toEqual([normal.name]);
    expect(
      (await listByQuery("scope-marker")).memos.map((memo) => memo.name),
    ).toEqual(expect.arrayContaining([normal.name, archived.name]));
    expect(
      (await listByQuery("scope-marker")).memos.map((memo) => memo.name),
    ).not.toContain(trashed.name);
    expect(
      (await listByQuery("scope-marker in:archive")).memos.map(
        (memo) => memo.name,
      ),
    ).toEqual([archived.name]);
    expect(
      (await listByQuery("scope-marker in:trash")).memos.map(
        (memo) => memo.name,
      ),
    ).toEqual([trashed.name]);
    expect(
      (await listByQuery("pinned-marker is:pinned")).memos.map(
        (memo) => memo.name,
      ),
    ).toEqual([pinned.name]);
    expect(
      (await listByQuery("attachment-marker has:attachment")).memos.map(
        (memo) => memo.name,
      ),
    ).toEqual([withAttachment.name]);
    expect(
      (
        await listByQuery(
          "date-window-marker after:2026-04-01 before:2026-04-02",
        )
      ).memos.map((memo) => memo.name),
    ).toEqual([inRange.name]);
    expect(
      (await listByQuery("literal before:2026-02-30")).memos.map(
        (memo) => memo.name,
      ),
    ).toEqual([literal.name]);
    expect(
      (
        await listByQuery(
          "scope-marker in:archive",
          "/api/v1/memos?state=normal",
        )
      ).memos.map((memo) => memo.name),
    ).toEqual([normal.name]);
  });

  it("initializes the single owner idempotently under concurrent requests", async () => {
    const [memosResponse, statsResponse] = await Promise.all([
      fetchApp("http://flaremo.test/api/app/memos"),
      fetchApp("http://flaremo.test/api/app/stats?time_zone=UTC"),
    ]);
    expect(memosResponse.status).toBe(200);
    expect(statsResponse.status).toBe(200);
  });

  it("replays an offline memo submission without creating a duplicate", async () => {
    const clientId = "offline-retry-8ec6d4b4-8d49-4cf6-8cb0-14cfe64d9d7c";
    const first = await json<{ id: string; name: string; content: string }>(
      await fetchApp("http://flaremo.test/api/app/memos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "Saved while offline",
          payload: { client_id: clientId },
        }),
      }),
    );
    const updated = await json<{ payload: { client_id?: string } }>(
      await fetchApp(`http://flaremo.test/api/app/memos/${first.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: { tags: ["offline"] } }),
      }),
    );
    expect(updated.payload.client_id).toBe(clientId);
    const replay = await json<{ name: string; content: string }>(
      await fetchApp("http://flaremo.test/api/app/memos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "This retry must not create another memo",
          payload: { client_id: clientId },
        }),
      }),
    );

    expect(replay).toMatchObject({
      name: first.name,
      content: "Saved while offline",
    });
    const list = await json<{ memos: Array<{ name: string }> }>(
      await fetchApp("http://flaremo.test/api/app/memos"),
    );
    expect(list.memos.filter((memo) => memo.name === first.name)).toHaveLength(
      1,
    );
  });

  it("replays an offline attachment upload without duplicating it", async () => {
    const memo = await createMemo<{ name: string }>("attachment replay memo");
    const clientId = "offline-attachment-8ec6d4b4-8d49-4cf6-8cb0-14cfe64d9d7c";
    const createFormData = () => {
      const formData = new FormData();
      formData.set("memo", memo.name);
      formData.set("client_id", clientId);
      formData.set(
        "file",
        new File(["attachment replay"], "replay.txt", {
          type: "text/plain",
        }),
      );
      return formData;
    };

    const first = await json<{ name: string }>(
      await fetchApp("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        body: createFormData(),
      }),
    );
    const replay = await json<{ name: string }>(
      await fetchApp("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        body: createFormData(),
      }),
    );

    expect(replay.name).toBe(first.name);
    const attached = await json<{ attachments: Array<{ name: string }> }>(
      await fetchApp(`http://flaremo.test/api/v1/${memo.name}/attachments`),
    );
    expect(attached.attachments).toHaveLength(1);
    expect(attached.attachments[0]?.name).toBe(first.name);
  });

  it("exposes release and repository metadata for the update UI", async () => {
    const health = await json(
      await fetchApp("http://flaremo.test/api/app/health"),
    );

    expect(health).toMatchObject({
      ok: true,
      product: "FlareMo",
      version: "0.6.0",
      update_repository: "example/flaremo",
      update_workflow_url:
        "https://github.com/example/flaremo/actions/workflows/flaremo-update.yml",
      releases_url: "https://github.com/realchendahuang/FlareMo/releases",
    });
  });

  it("does not create an update link from an invalid repository value", async () => {
    env.FLAREMO_DEPLOY_REPOSITORY = "https://github.com/example/flaremo";
    const health = await json(
      await fetchApp("http://flaremo.test/api/app/health"),
    );

    expect(health).toMatchObject({
      update_repository: null,
      update_workflow_url: null,
    });
  });

  it("returns JSON authentication errors for protected metadata endpoints", async () => {
    const health = await fetchApp(
      "http://flaremo.test/api/app/health",
      undefined,
      { authenticated: false },
    );
    expect(health.status).toBe(401);
    expect(health.headers.get("content-type")).toContain("application/json");
    expect(await health.json()).toEqual({
      error: { message: "Authentication required" },
    });

    const openapi = await fetchApp(
      "http://flaremo.test/api/v1/openapi.json",
      undefined,
      { authenticated: false },
    );
    expect(openapi.status).toBe(401);
    expect(openapi.headers.get("content-type")).toContain("application/json");
    expect(await openapi.json()).toEqual({
      error: { message: "Authentication required" },
    });
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

    const unauthenticatedFile = await fetchApp(
      `http://flaremo.test/file/${attachment.name}/hello.txt`,
      undefined,
      { authenticated: false },
    );
    expect(unauthenticatedFile.status).toBe(401);

    const fileUrl = `http://flaremo.test/file/${attachment.name}/hello.txt`;
    const file = await fetchApp(fileUrl, {
      headers: { cookie: sessionCookie },
    });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toContain("text/plain");
    expect(file.headers.get("content-disposition")).toContain(
      'filename="hello.txt"',
    );
    expect(await file.text()).toBe("hello attachment");

    const fileWithUntrustedName = await fetchApp(
      `http://flaremo.test/file/${attachment.name}/not-the-real-file.txt`,
      { headers: { cookie: sessionCookie } },
    );
    expect(fileWithUntrustedName.status).toBe(200);
    expect(await fileWithUntrustedName.text()).toBe("hello attachment");

    const partialFile = await fetchApp(fileUrl, {
      headers: { cookie: sessionCookie, range: "bytes=0-4" },
    });
    expect(partialFile.status).toBe(206);
    expect(await partialFile.text()).toBe("hello");

    const etag = file.headers.get("etag");
    expect(etag).toBeTruthy();
    const notModified = await fetchApp(fileUrl, {
      headers: { cookie: sessionCookie, "if-none-match": etag ?? "" },
    });
    expect(notModified.status).toBe(304);

    const deleted = await json(
      await fetchApp(`http://flaremo.test/api/v1/${attachment.name}`, {
        method: "DELETE",
      }),
    );
    expect(deleted.ok).toBe(true);
  });

  it("manages hierarchical tags through rename, delete, and untagged filtering", async () => {
    const workMemo = await createMemo<{ id: string; name: string }>(
      "推进 #工作/项目A 和 #工作/项目B，也看 #生活",
    );
    const childMemo = await createMemo<{ id: string; name: string }>(
      "#工作/项目A/子项 细节",
    );
    const untaggedMemo = await createMemo<{ id: string; name: string }>(
      "没有标签的纯文本记录",
    );

    const hierarchy = await json<TagHierarchyResponse>(
      await fetchApp("http://flaremo.test/api/app/tags"),
    );
    expect(hierarchy.tags).toEqual([
      {
        name: "工作",
        count: 2,
        children: [
          {
            name: "工作/项目a",
            count: 2,
            children: [{ name: "工作/项目a/子项", count: 1, children: [] }],
          },
          { name: "工作/项目b", count: 1, children: [] },
        ],
      },
      { name: "生活", count: 1, children: [] },
    ]);

    // Hierarchical filter: `工作` matches its descendants too.
    const workTagged = await json<ListMemosResponse>(
      await fetchApp(
        "http://flaremo.test/api/app/memos?tag=" + encodeURIComponent("工作"),
      ),
    );
    expect(workTagged.memos.map((memo) => memo.id)).toEqual(
      expect.arrayContaining([workMemo.id, childMemo.id]),
    );

    // Untagged filter returns only memos without any tag.
    const untagged = await json<ListMemosResponse>(
      await fetchApp("http://flaremo.test/api/app/memos?untagged=true"),
    );
    expect(untagged.memos.map((memo) => memo.id)).toEqual([untaggedMemo.id]);

    // Rename `工作` to `知识/工作`: payload, memo_tags, and content all move.
    const renamed = await json<RenameTagResponse>(
      await fetchApp("http://flaremo.test/api/app/tags", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: "工作", to: "知识/工作" }),
      }),
    );
    expect(renamed.renamed).toBe(2);

    const afterRename = await json<TagHierarchyResponse>(
      await fetchApp("http://flaremo.test/api/app/tags"),
    );
    expect(afterRename.tags).toEqual([
      { name: "生活", count: 1, children: [] },
      {
        name: "知识",
        count: 2,
        children: [
          {
            name: "知识/工作",
            count: 2,
            children: [
              {
                name: "知识/工作/项目a",
                count: 2,
                children: [
                  { name: "知识/工作/项目a/子项", count: 1, children: [] },
                ],
              },
              { name: "知识/工作/项目b", count: 1, children: [] },
            ],
          },
        ],
      },
    ]);

    const renamedMemo = await json<MemoContextResponse>(
      await fetchApp(`http://flaremo.test/api/app/memos/${workMemo.id}`),
    );
    expect(renamedMemo.memo.content).toContain("#知识/工作/项目A");
    expect(renamedMemo.memo.payload.tags).toEqual(
      expect.arrayContaining(["知识/工作/项目a", "知识/工作/项目b", "生活"]),
    );

    // Delete `知识/工作/项目a`: child path removed from all affected memos.
    const deleted = await json<DeleteTagResponse>(
      await fetchApp(
        "http://flaremo.test/api/app/tags?tag=" +
          encodeURIComponent("知识/工作/项目a"),
        { method: "DELETE" },
      ),
    );
    expect(deleted.removed).toBe(1);

    const afterDelete = await json<TagHierarchyResponse>(
      await fetchApp("http://flaremo.test/api/app/tags"),
    );
    expect(afterDelete.tags).toEqual([
      { name: "生活", count: 1, children: [] },
      {
        name: "知识",
        count: 2,
        children: [
          {
            name: "知识/工作",
            count: 2,
            children: [
              {
                name: "知识/工作/项目a",
                count: 1,
                children: [
                  { name: "知识/工作/项目a/子项", count: 1, children: [] },
                ],
              },
              { name: "知识/工作/项目b", count: 1, children: [] },
            ],
          },
        ],
      },
    ]);

    const deletedMemo = await json<MemoContextResponse>(
      await fetchApp(`http://flaremo.test/api/app/memos/${workMemo.id}`),
    );
    expect(deletedMemo.memo.content).not.toContain("#知识/工作/项目A");
    expect(deletedMemo.memo.payload.tags).toEqual(
      expect.arrayContaining(["知识/工作/项目b", "生活"]),
    );
    expect(deletedMemo.memo.payload.tags).not.toContain("知识/工作/项目a");
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
    const sharedAttachment = await json<{ name: string }>(
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

    const memosWebShareFile = await fetchApp(
      `http://flaremo.test/file/${sharedAttachment.name}/shared.txt?share_token=${encodeURIComponent(share.token)}`,
      undefined,
      { authenticated: false },
    );
    expect(memosWebShareFile.status).toBe(200);
    expect(memosWebShareFile.headers.get("cache-control")).toContain("public");
    expect(await memosWebShareFile.text()).toBe("shared attachment");

    const invalidShareFile = await fetchApp(
      `http://flaremo.test/file/${sharedAttachment.name}/shared.txt?share_token=invalid-token`,
      undefined,
      { authenticated: false },
    );
    expect(invalidShareFile.status).toBe(404);

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

    const forbiddenMemosWebFile = await fetchApp(
      `http://flaremo.test/file/${otherAttachment.name}/private.txt?share_token=${encodeURIComponent(share.token)}`,
      undefined,
      { authenticated: false },
    );
    expect(forbiddenMemosWebFile.status).toBe(404);

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

  it("creates an export task, streams its manifest and attachment bytes", async () => {
    await createMemo("export memo #tag-a");
    await createMemo("export memo #tag-b");

    const created = await fetchApp("http://flaremo.test/api/v1/export/tasks", {
      method: "POST",
    });
    expect(created.status).toBe(202);
    const createdBody = await created.json<{
      task: { id: string; status: string; kind: string };
    }>();
    expect(createdBody.task.kind).toBe("export");
    expect(createdBody.task.status).toBe("succeeded");
    const taskId = createdBody.task.id;

    const listed = await json<{ tasks: Array<{ id: string }> }>(
      await fetchApp("http://flaremo.test/api/v1/export/tasks"),
    );
    expect(listed.tasks.map((task) => task.id)).toContain(taskId);

    const statusBody = await json<{
      task: {
        id: string;
        status: string;
        phase: string;
        progress_total: number;
      };
    }>(await fetchApp(`http://flaremo.test/api/v1/export/tasks/${taskId}`));
    expect(statusBody.task.status).toBe("succeeded");
    expect(statusBody.task.phase).toBe("completed");

    const manifestResponse = await fetchApp(
      `http://flaremo.test/api/v1/export/tasks/${taskId}/manifest`,
    );
    expect(manifestResponse.ok).toBe(true);
    const manifest = (await manifestResponse.json()) as {
      format_version: number;
      counts: { memos: number; attachments: number; relations: number };
      data_chunks: Array<{ kind: string; key: string; record_count: number }>;
    };
    expect(manifest.format_version).toBe(1);
    expect(manifest.counts.memos).toBe(2);
    expect(manifest.data_chunks.length).toBeGreaterThan(0);

    const memosChunk = manifest.data_chunks.find(
      (chunk) => chunk.kind === "memos",
    );
    expect(memosChunk).toBeTruthy();
    const chunkResponse = await fetchApp(
      `http://flaremo.test/api/v1/export/tasks/${taskId}/data/${encodeURIComponent(
        memosChunk!.key.split("/").at(-1)!,
      )}`,
    );
    expect(chunkResponse.ok).toBe(true);
    const chunkText = await chunkResponse.text();
    expect(chunkText.split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("exports attachments through the task download endpoint", async () => {
    const memo = await createMemo("export with attachment");
    const formData = new FormData();
    formData.set("memo", memo.name);
    formData.set(
      "file",
      new File(["export-me-bytes"], "export.txt", { type: "text/plain" }),
    );
    const uploaded = await json<{ name: string }>(
      await fetchApp("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        body: formData,
      }),
    );
    const attachmentId = uploaded.name.split("/").at(-1)!;

    const created = await json<{ task: { id: string } }>(
      await fetchApp("http://flaremo.test/api/v1/export/tasks", {
        method: "POST",
      }),
    );
    const manifest = await json<{
      counts: { attachments: number };
      attachments: Array<{ id: string; filename: string }>;
    }>(
      await fetchApp(
        `http://flaremo.test/api/v1/export/tasks/${created.task.id}/manifest`,
      ),
    );
    expect(manifest.counts.attachments).toBe(1);
    expect(manifest.attachments[0].id).toBe(attachmentId);

    const download = await fetchApp(
      `http://flaremo.test/api/v1/export/tasks/${created.task.id}/attachments/${attachmentId}`,
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("text/plain");
    expect(await download.text()).toBe("export-me-bytes");
  });

  it("runs an import task and reports its result", async () => {
    const created = await fetchApp("http://flaremo.test/api/v1/import/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conflict: "duplicate",
        bundle: {
          version: 2,
          memos: [
            {
              name: "memos/import-task-memo",
              content: "imported via task",
              visibility: "private",
              state: "normal",
              pinned: false,
              payload: {},
              create_time: "2023-11-14T22:13:20Z",
              update_time: "2023-11-14T22:13:20Z",
            },
          ],
          attachments: [],
          relations: [],
          shares: [],
        },
      }),
    });
    expect(created.status).toBe(202);
    const body = await created.json<{
      task: { status: string; kind: string };
      result: { imported_memos: number };
    }>();
    expect(body.task.status).toBe("succeeded");
    expect(body.task.kind).toBe("import");
    expect(body.result.imported_memos).toBe(1);

    const listed = await json<{
      memos: Array<{ name: string; content: string }>;
    }>(await fetchApp("http://flaremo.test/api/v1/memos?q=imported+via+task"));
    expect(listed.memos).toHaveLength(1);
    expect(listed.memos[0].name).toBe("memos/import-task-memo");
  });
});

function fetchApp(
  input: string,
  init?: RequestInit,
  options: { authenticated?: boolean } = {},
) {
  const headers = new Headers(init?.headers);
  const path = new URL(input).pathname;
  if (
    options.authenticated !== false &&
    (path.startsWith("/api/app/") || path.startsWith("/api/v1/"))
  ) {
    headers.set("cookie", sessionCookie);
    if (path.startsWith("/api/v1/") && !headers.has("x-flaremo-wire")) {
      headers.set("x-flaremo-wire", "legacy");
    }
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

async function createMemo<T = Record<string, unknown>>(content: string) {
  return json<T>(
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
