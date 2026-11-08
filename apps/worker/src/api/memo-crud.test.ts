import type { ListMemosResponse } from "@flaremo/contracts";
import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAppTestHarness, json } from "../test-support/app";
import { createTestRuntime, fetchWorker } from "../test-support/runtime";

let mf: Miniflare;
let env: Env;
let sessionCookie: string;

const { fetchApp, createMemo, bootstrapAndSignIn, createActivatedMember } =
  createAppTestHarness(() => ({
    env,
    sessionCookie,
  }));

describe("FlareMo memo CRUD API", () => {
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

  it("finds a substring inside continuous Chinese capture text", async () => {
    const created = await createMemo<{ name: string }>(
      "这是一次语音记录准确性测试，今天讨论高性能数据安全和知识检索。",
    );
    const result = await json<ListMemosResponse>(
      await fetchApp(
        `http://flaremo.test/api/app/memos?q=${encodeURIComponent("高性能数据安全")}`,
      ),
    );
    expect(result.memos.map((memo) => memo.name)).toContain(created.name);
  });

  it("accepts a client-generated memo id and replays it idempotently", async () => {
    const clientId = "0199dd00-0000-7000-8000-000000000001";

    function createWithId(id: unknown, content: string) {
      return fetchApp("http://flaremo.test/api/app/memos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, id }),
      });
    }

    // The id the offline client already wrote locally is the row's primary key.
    const first = await json<{ id: string; name: string }>(
      await createWithId(`memos/${clientId}`, "offline created"),
    );
    expect(first.name).toBe(`memos/${clientId}`);
    expect(first.id).toBe(clientId);

    // Replaying the same upload returns the same row instead of inserting a
    // second copy under a server-generated id.
    const replay = await json<{ id: string; name: string }>(
      await createWithId(`memos/${clientId}`, "offline created"),
    );
    expect(replay.name).toBe(first.name);
    const list = await json<{ memos: { name: string }[] }>(
      await fetchApp("http://flaremo.test/api/app/memos?page_size=100"),
    );
    expect(
      list.memos.filter((memo) => memo.name === `memos/${clientId}`),
    ).toHaveLength(1);

    // A bare uuid is accepted and normalized to the `memos/<uuid>` form.
    const bareUuid = "0199dd00-0000-7000-8000-000000000002";
    const bare = await json<{ name: string }>(
      await createWithId(bareUuid, "bare uuid"),
    );
    expect(bare.name).toBe(`memos/${bareUuid}`);

    // Omitting `id` keeps the server-generated id path (web/MCP callers).
    const generated = await json<{ name: string }>(
      await fetchApp("http://flaremo.test/api/app/memos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "server generated id" }),
      }),
    );
    expect(generated.name).toMatch(
      /^memos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // Malformed ids are rejected before touching D1.
    for (const bad of ["not-a-uuid", "memos/0199dd00", "articles/0199dd00"]) {
      const response = await createWithId(bad, "bad id");
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error?: { message?: string } };
      expect(body.error?.message).toContain("Must be a UUID or memos/<uuid>");
    }

    // The change log references the client id, so the next pull hydrates the
    // local row instead of inserting a duplicate.
    const changes = await json<{
      changes: { entity: string; entity_id: string }[];
    }>(
      await fetchApp(
        "http://flaremo.test/api/app/sync/changes?since=0&limit=100",
      ),
    );
    expect(
      changes.changes.some(
        (change) =>
          change.entity === "memo" && change.entity_id === `memos/${clientId}`,
      ),
    ).toBe(true);

    // Another account cannot claim (or read) an id that already exists.
    const member = await createActivatedMember(
      "memo-id-member@example.com",
      "Memo Id Member",
    );
    const hijack = await fetchWorker(
      new Request("http://flaremo.test/api/app/memos", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: member.cookie,
          origin: "http://flaremo.test",
        },
        body: JSON.stringify({
          content: "hijack attempt",
          id: `memos/${clientId}`,
        }),
      }),
      env,
    );
    expect(hijack.status).toBe(409);
  });
});
