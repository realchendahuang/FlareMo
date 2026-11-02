import type {
  DeleteTagResponse,
  ListMemosResponse,
  MemoContextResponse,
  MemoStatsResponse,
  RenameTagResponse,
  TagHierarchyResponse,
} from "@flaremo/contracts";
import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAppTestHarness, json } from "../test-support/app";
import { createTestRuntime } from "../test-support/runtime";

let mf: Miniflare;
let env: Env;
let sessionCookie: string;

const { fetchApp, createMemo, bootstrapAndSignIn } = createAppTestHarness(
  () => ({
    env,
    sessionCookie,
  }),
);

describe("FlareMo app memos API", () => {
  beforeEach(async () => {
    ({ runtime: mf, env } = await createTestRuntime({
      databaseName: "flaremo-test",
      attachmentsName: "flaremo-attachments-test",
      env: { FLAREMO_DEPLOY_REPOSITORY: "example/flaremo" },
    }));
    sessionCookie = await bootstrapAndSignIn();
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("returns a human-readable message for schema validation failures", async () => {
    const response = await fetchApp(
      "http://flaremo.test/api/app/tasks?page_size=999",
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error?: { message?: unknown };
      success?: unknown;
    };
    expect(typeof body.error?.message).toBe("string");
    expect(String(body.error?.message)).not.toContain("[");
    // The package default leaked `{ success: false, error: ZodError }`.
    expect(body).not.toHaveProperty("success");
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

  it("serves the activity window the client asks for", async () => {
    // The year view of the heatmap needs 366 buckets; the endpoint used to
    // hardcode 84, which left every cell outside that window a structural zero.
    const year = await json<MemoStatsResponse>(
      await fetchApp(
        "http://flaremo.test/api/app/stats?time_zone=UTC&days=366",
      ),
    );
    expect(year.activity).toHaveLength(366);
    expect(year.activity.at(-1)?.date).toBe(
      new Date().toISOString().slice(0, 10),
    );

    const month = await json<MemoStatsResponse>(
      await fetchApp("http://flaremo.test/api/app/stats?time_zone=UTC&days=30"),
    );
    expect(month.activity).toHaveLength(30);
  });

  it("rejects an out-of-range activity window", async () => {
    const response = await fetchApp(
      "http://flaremo.test/api/app/stats?time_zone=UTC&days=100000",
    );
    expect(response.status).toBe(400);
  });

  it("treats space=all as the viewer's own corpus, like the list and tags do", async () => {
    // Regression guard for the sidebar reading three different corpora: the
    // memo list and the tag hierarchy both normalize "all" away, and stats used
    // to pass it through to `scopedReadScope`, which widens the corpus to every
    // memo the viewer can read. In a single-owner deployment that is invisible,
    // so this pins the contract rather than a number that happens to match.
    await createMemo("own note");

    const withoutSpace = await json<MemoStatsResponse>(
      await fetchApp("http://flaremo.test/api/app/stats?time_zone=UTC"),
    );
    const withAll = await json<MemoStatsResponse>(
      await fetchApp(
        "http://flaremo.test/api/app/stats?time_zone=UTC&space=all",
      ),
    );
    expect(withAll.counts).toEqual(withoutSpace.counts);
    expect(withAll.activity).toEqual(withoutSpace.activity);

    // An explicit space partition still takes the space-scoped path, which is
    // the one that reports the per-space badges.
    const personal = await json<MemoStatsResponse>(
      await fetchApp(
        "http://flaremo.test/api/app/stats?time_zone=UTC&space=personal",
      ),
    );
    expect(personal.counts.spaces).toEqual({ personal: 1, team: 0 });
    expect(withoutSpace.counts.spaces).toBeUndefined();
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

  it("keeps client-reported image dimensions in the attachment payload", async () => {
    const formData = new FormData();
    formData.set(
      "file",
      new File(["png pixels"], "shot.png", { type: "image/png" }),
    );
    formData.set("width", "1920");
    formData.set("height", "1080");
    const attachment = await json<{
      name: string;
      payload: Record<string, unknown>;
    }>(
      await fetchApp("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        body: formData,
      }),
    );
    expect(attachment.payload).toMatchObject({ width: 1920, height: 1080 });

    // A half-present pair must not poison the payload: dimensions are
    // decoration, and an invalid value simply leaves the keys out.
    const invalid = new FormData();
    invalid.set(
      "file",
      new File(["png pixels"], "shot-broken.png", { type: "image/png" }),
    );
    invalid.set("width", "0");
    invalid.set("height", "1080");
    const rejected = await json<{ payload: Record<string, unknown> }>(
      await fetchApp("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        body: invalid,
      }),
    );
    expect(rejected.payload).toEqual({});
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
        `http://flaremo.test/api/app/memos?tag=${encodeURIComponent("工作")}`,
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
});
