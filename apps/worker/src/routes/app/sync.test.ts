import { applyFlaremoMigrations } from "@flaremo/db";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAppTestHarness,
  json,
  jsonWithStatus,
} from "../../test-support/app";
import { createTestRuntime } from "../../test-support/runtime";

/**
 * M0 native sync contract (docs/native-clients.md §4.3/§4.4/§4.6):
 * migrations 0048 + 0049, `/api/app/sync/changes`, `/api/app/sync/hydrate`
 * and `/api/app/instance`.
 */

let mf: Miniflare;
let env: Env;
let sessionCookie: string;

const { fetchApp, createMemo, uploadAttachment, bootstrapAndSignIn } =
  createAppTestHarness(() => ({ env, sessionCookie }));

async function syncChanges(database: D1Database): Promise<
  {
    seq: number;
    entity: string;
    entity_id: string;
    op: string;
    version: number;
  }[]
> {
  const result = await database
    .prepare(
      "SELECT seq, entity, entity_id, op, version FROM sync_changes ORDER BY seq",
    )
    .all<{
      seq: number;
      entity: string;
      entity_id: string;
      op: string;
      version: number;
    }>();
  return result.results;
}

describe("native sync migrations (0048 + 0049)", () => {
  let runtime: Miniflare;
  let db: D1Database;

  beforeEach(async () => {
    runtime = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "flaremo-sync-migration-test" },
    });
    db = await runtime.getD1Database("DB");
    // Stop before 0048 so we can seed rows that predate the sync columns, then
    // run 0048 + 0049 exactly as a deployed instance would.
    await applyFlaremoMigrations(db, {
      beforeTag: "0048_dapper_captain_america",
    });
    const seed = [
      "INSERT INTO users (id, email, name, created_at, updated_at) VALUES ('users/seed', 'seed@example.com', 'Seed', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      "INSERT INTO memos (id, user_id, content, created_at, updated_at) VALUES ('memos/seed-a', 'users/seed', 'seed body', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      "INSERT INTO memos (id, user_id, content, created_at, updated_at, deleted_at) VALUES ('memos/seed-b', 'users/seed', 'trashed', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')",
      "INSERT INTO attachments (id, user_id, memo_id, r2_key, filename, created_at, updated_at) VALUES ('attachments/seed', 'users/seed', 'memos/seed-a', 'r2/seed', 'seed.txt', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      "INSERT INTO articles (id, user_id, slug, title, content, created_at, updated_at) VALUES ('articles/seed', 'users/seed', 'seed-article', 'Seed article', 'body', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      "INSERT INTO memo_relations (memo_id, related_memo_id, type, created_at) VALUES ('memos/seed-b', 'memos/seed-a', 'comment', '2026-01-01T00:00:00.000Z')",
    ];
    for (const statement of seed) {
      await db.prepare(statement).run();
    }
    await applyFlaremoMigrations(db, {
      fromTag: "0048_dapper_captain_america",
    });
  });

  afterEach(async () => {
    await runtime.dispose();
  });

  it("adds the version columns, creates sync tables and seeds one change per row", async () => {
    // 0048: the columns exist and default to 1 for pre-existing rows.
    const memo = await db
      .prepare("SELECT version FROM memos WHERE id = 'memos/seed-a'")
      .first<{ version: number }>();
    expect(memo?.version).toBe(1);
    const relation = await db
      .prepare(
        "SELECT updated_at FROM memo_relations WHERE memo_id = 'memos/seed-b'",
      )
      .first<{ updated_at: string }>();
    expect(relation?.updated_at).toBe("2026-01-01T00:00:00.000Z");

    // 0049 backfill: one reference per existing row, tombstones included.
    expect(await syncChanges(db)).toEqual([
      {
        seq: 1,
        entity: "memo",
        entity_id: "memos/seed-a",
        op: "upsert",
        version: 1,
      },
      {
        seq: 2,
        entity: "memo",
        entity_id: "memos/seed-b",
        op: "delete",
        version: 1,
      },
      {
        seq: 3,
        entity: "attachment",
        entity_id: "attachments/seed",
        op: "upsert",
        version: 1,
      },
      {
        seq: 4,
        entity: "article",
        entity_id: "articles/seed",
        op: "upsert",
        version: 1,
      },
      {
        seq: 5,
        entity: "relation",
        entity_id: "memos/seed-b",
        op: "upsert",
        version: 0,
      },
    ]);
  });

  it("records inserts, updates, soft deletes and hard deletes through triggers", async () => {
    const triggerNames = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'sync\\_%' ESCAPE '\\' ORDER BY name",
      )
      .all<{ name: string }>();
    expect(triggerNames.results.map((row) => row.name)).toEqual([
      "sync_articles_ad",
      "sync_articles_ai",
      "sync_articles_au",
      "sync_attachments_ad",
      "sync_attachments_ai",
      "sync_attachments_au",
      "sync_memo_relations_ad",
      "sync_memo_relations_ai",
      "sync_memos_ad",
      "sync_memos_ai",
      "sync_memos_au",
    ]);

    await db
      .prepare(
        "INSERT INTO memos (id, user_id, content, created_at, updated_at) VALUES ('memos/live', 'users/seed', 'live', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')",
      )
      .run();
    await db
      .prepare(
        "UPDATE memos SET content = 'edited', version = version + 1, updated_at = '2026-02-02T00:00:00.000Z' WHERE id = 'memos/live'",
      )
      .run();
    await db
      .prepare(
        "UPDATE memos SET status = 'trashed', deleted_at = '2026-02-03T00:00:00.000Z', version = version + 1, updated_at = '2026-02-03T00:00:00.000Z' WHERE id = 'memos/live'",
      )
      .run();
    await db.prepare("DELETE FROM memos WHERE id = 'memos/live'").run();

    // A relation inserted after the migration keeps the 1970 sentinel in the
    // column (the comment write path predates it); the change log must still
    // record the real write time, not 1970.
    await db
      .prepare(
        "INSERT INTO memo_relations (memo_id, related_memo_id, type, created_at) VALUES ('memos/seed-b', 'memos/seed-a', 'reference', '2026-02-04T00:00:00.000Z')",
      )
      .run();

    const rows = (await syncChanges(db)).slice(5);
    expect(rows).toEqual([
      {
        seq: 6,
        entity: "memo",
        entity_id: "memos/live",
        op: "upsert",
        version: 1,
      },
      {
        seq: 7,
        entity: "memo",
        entity_id: "memos/live",
        op: "upsert",
        version: 2,
      },
      {
        seq: 8,
        entity: "memo",
        entity_id: "memos/live",
        op: "delete",
        version: 3,
      },
      {
        seq: 9,
        entity: "memo",
        entity_id: "memos/live",
        op: "delete",
        version: 3,
      },
      {
        seq: 10,
        entity: "relation",
        entity_id: "memos/seed-b",
        op: "upsert",
        version: 0,
      },
    ]);

    const relationChange = await db
      .prepare(
        "SELECT updated_at FROM sync_changes WHERE entity = 'relation' AND seq = 10",
      )
      .first<{ updated_at: string }>();
    expect(relationChange?.updated_at).toBe("2026-02-04T00:00:00.000Z");
  });
});

describe("native sync API", () => {
  beforeEach(async () => {
    ({ runtime: mf, env } = await createTestRuntime({
      databaseName: "flaremo-sync-test",
      attachmentsName: "flaremo-sync-attachments-test",
      env: { FLAREMO_DEPLOY_REPOSITORY: "example/flaremo" },
    }));
    sessionCookie = await bootstrapAndSignIn();
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("returns only changes after the cursor with a monotonic seq", async () => {
    await createMemo("first");
    const [first] = await syncChanges(env.DB);
    expect(first.entity).toBe("memo");
    expect(first.op).toBe("upsert");
    expect(first.version).toBe(1);

    await createMemo("second");
    const changes = await syncChanges(env.DB);
    expect(changes).toHaveLength(2);
    expect(changes[1].seq).toBeGreaterThan(changes[0].seq);

    const page = await json<{
      changes: { seq: number; entity_id: string; op: string }[];
      next_seq: number;
      has_more: boolean;
    }>(
      await fetchApp(
        `http://flaremo.test/api/app/sync/changes?since=${first.seq}`,
      ),
    );
    expect(page.changes).toHaveLength(1);
    expect(page.changes[0].seq).toBe(changes[1].seq);
    expect(page.next_seq).toBe(changes[1].seq);
    expect(page.has_more).toBe(false);

    // The reference carries no body: content lives behind /sync/hydrate.
    expect(page.changes[0]).not.toHaveProperty("content");
    expect(page.changes[0]).not.toHaveProperty("id");
  });

  it("answers an empty poll with 200 and an empty array without scanning rows", async () => {
    await createMemo("only one");
    const [change] = await syncChanges(env.DB);

    const empty = await jsonWithStatus<{
      changes: unknown[];
      next_seq: number;
      has_more: boolean;
    }>(
      await fetchApp(
        `http://flaremo.test/api/app/sync/changes?since=${change.seq}`,
      ),
      200,
    );
    expect(empty).toEqual({
      changes: [],
      next_seq: change.seq,
      has_more: false,
    });

    // Polling with no cursor on an empty change log is equally cheap.
    await env.DB.prepare("DELETE FROM sync_changes").run();
    const fresh = await jsonWithStatus<{
      changes: unknown[];
      next_seq: number;
    }>(await fetchApp("http://flaremo.test/api/app/sync/changes?since=0"), 200);
    expect(fresh.changes).toEqual([]);
    expect(fresh.next_seq).toBe(0);
  });

  it("paginates with limit and reports has_more", async () => {
    for (const content of ["one", "two", "three"]) {
      await createMemo(content);
    }
    const firstPage = await json<{
      changes: { seq: number }[];
      next_seq: number;
      has_more: boolean;
    }>(
      await fetchApp(
        "http://flaremo.test/api/app/sync/changes?since=0&limit=1",
      ),
    );
    expect(firstPage.changes).toHaveLength(1);
    expect(firstPage.has_more).toBe(true);
    expect(firstPage.next_seq).toBe(firstPage.changes[0].seq);

    const secondPage = await json<{ changes: { seq: number }[] }>(
      await fetchApp(
        `http://flaremo.test/api/app/sync/changes?since=${firstPage.next_seq}&limit=10`,
      ),
    );
    expect(secondPage.changes).toHaveLength(2);
    expect(secondPage.changes[0].seq).toBeGreaterThan(firstPage.next_seq);
  });

  it("returns 410 when the cursor predates the retained change window", async () => {
    for (const content of ["one", "two", "three"]) {
      await createMemo(content);
    }
    const changes = await syncChanges(env.DB);
    const newest = changes.at(-1);
    expect(newest).toBeDefined();
    // Simulate the retention sweep: every row but the newest is pruned, so a
    // cursor at 0 can no longer be served contiguously.
    await env.DB.prepare("DELETE FROM sync_changes WHERE seq < ?")
      .bind(newest?.seq)
      .run();

    const response = await fetchApp(
      "http://flaremo.test/api/app/sync/changes?since=0",
    );
    expect(response.status).toBe(410);
    const body = (await response.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain("cursor expired");

    // A cursor adjacent to the retained window is still valid.
    const recovered = await json<{ changes: unknown[] }>(
      await fetchApp(
        `http://flaremo.test/api/app/sync/changes?since=${(newest?.seq ?? 0) - 1}`,
      ),
    );
    expect(recovered.changes).toHaveLength(1);
  });

  it("hydrates memo, attachment, article and relation bodies in one call", async () => {
    const memo = await json<{ name: string }>(
      await fetchApp("http://flaremo.test/api/app/memos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "parent memo" }),
      }),
    );
    const attachment = await uploadAttachment<{ name: string }>(memo.name);
    const comment = await json<{ name: string }>(
      await fetchApp(
        `http://flaremo.test/api/app/memos/${memo.name.replace(/^memos\//, "")}/comments`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "a comment" }),
        },
      ),
    );
    const article = await json<{ article: { id: string; title: string } }>(
      await fetchApp("http://flaremo.test/api/app/articles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Hydrated article", content: "body" }),
      }),
    );

    const hydration = await json<{
      memos: Record<string, unknown>[];
      attachments: Record<string, unknown>[];
      articles: Record<string, unknown>[];
      relations: Record<string, unknown>[];
    }>(
      await fetchApp("http://flaremo.test/api/app/sync/hydrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          memo_ids: [memo.name, comment.name, "memos/does-not-exist"],
          attachment_ids: [attachment.name],
          article_ids: [article.article.id],
          relation_ids: [comment.name],
        }),
      }),
    );

    // Bodies carry local column names 1:1 and no derived embedding columns.
    expect(hydration.memos).toHaveLength(2);
    const parent = hydration.memos.find((row) => row.id === memo.name);
    expect(parent).toMatchObject({
      content: "parent memo",
      version: 1,
      visibility: "private",
      status: "normal",
      pinned: false,
    });
    expect(parent).not.toHaveProperty("embedding_status");

    expect(hydration.attachments).toHaveLength(1);
    expect(hydration.attachments[0]).toMatchObject({
      id: attachment.name,
      memo_id: memo.name,
      filename: "file.txt",
      state: "ready",
      version: 1,
    });

    expect(hydration.articles).toHaveLength(1);
    expect(hydration.articles[0]).toMatchObject({
      id: article.article.id,
      title: "Hydrated article",
      status: "draft",
      version: 1,
    });

    expect(hydration.relations).toHaveLength(1);
    expect(hydration.relations[0]).toMatchObject({
      id: comment.name,
      memo_id: comment.name,
      related_memo_id: memo.name,
      type: "comment",
      version: 0,
    });
    // The 0048 sentinel default is normalized to the row's write time.
    expect(hydration.relations[0].updated_at).toBe(
      hydration.relations[0].created_at,
    );

    // A list longer than one D1 statement's 100-parameter budget is chunked,
    // not rejected: 120 ids still hydrate in a single call.
    const chunked = await json<{ memos: Record<string, unknown>[] }>(
      await fetchApp("http://flaremo.test/api/app/sync/hydrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          memo_ids: [
            memo.name,
            ...Array.from(
              { length: 119 },
              (_, index) => `memos/missing-${index}`,
            ),
          ],
        }),
      }),
    );
    expect(chunked.memos).toHaveLength(1);
    expect(chunked.memos[0].id).toBe(memo.name);

    // A batch above the documented cap is rejected before touching D1.
    const tooMany = await fetchApp("http://flaremo.test/api/app/sync/hydrate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memo_ids: Array.from({ length: 201 }, (_, index) => `memos/${index}`),
      }),
    });
    expect(tooMany.status).toBe(400);
  });

  it("rejects anonymous sync calls but serves instance capabilities anonymously", async () => {
    const anonymous = await fetchApp(
      "http://flaremo.test/api/app/sync/changes?since=0",
      {},
      { authenticated: false },
    );
    expect(anonymous.status).toBe(401);

    const instance = await fetchApp(
      "http://flaremo.test/api/app/instance",
      {},
      { authenticated: false },
    );
    expect(instance.status).toBe(200);
    expect(instance.headers.get("cache-control")).toContain("max-age=300");
    const body = (await instance.json()) as {
      version: string;
      api_versions: string[];
      capabilities: Record<string, unknown>;
    };
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.api_versions).toEqual(["app-v1"]);
    expect(body.capabilities).toMatchObject({
      sync_changes: 1,
      sync_hydrate: 1,
      soft_delete_tombstone: 1,
    });
    expect(Array.isArray(body.capabilities.native_push)).toBe(true);
  });
});
