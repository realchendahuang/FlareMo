import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { UserRow } from "@flaremo/db";
import { createDb, embeddingTasks, memoryItems, memos } from "@flaremo/db";
import { eq } from "drizzle-orm";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  EmbeddingProvider,
  VectorIndex,
  VectorIndexInfo,
  VectorIndexMatch,
  VectorIndexVector,
} from "./embedding";
import {
  dispatchEmbeddingOutbox,
  rebuildEmbeddingIndexes,
} from "./embedding-outbox";
import { SELF_HOST_UNLIMITED } from "./limits";
import { createMemory, type MemoryActor } from "./memory";
import { createMemo, hardDeleteMemo } from "./memos";
import { readMonthlyUsageTotal } from "./quotas";
import { incrementUsageCounter } from "./usage";
import { createFlaremoMember, ensureSingleUser } from "./users";

const USER_ACTOR: MemoryActor = { type: "user" };

let mf: Miniflare;
let db: ReturnType<typeof createDb>;
let user: UserRow;

class FakeVectorIndex implements VectorIndex {
  store = new Map<string, VectorIndexVector>();
  lastUpsert: VectorIndexVector[] = [];
  lastDeletedIds: string[] = [];

  async query(
    _vector: number[],
    _topK: number,
    _namespace?: string,
  ): Promise<VectorIndexMatch[]> {
    return [];
  }
  async upsert(vectors: VectorIndexVector[]) {
    this.lastUpsert = vectors;
    for (const vector of vectors) this.store.set(vector.id, vector);
  }
  async deleteByIds(ids: string[]) {
    this.lastDeletedIds = ids;
    for (const id of ids) this.store.delete(id);
  }
  async describe(): Promise<VectorIndexInfo> {
    return { vectorCount: this.store.size, dimensions: 4 };
  }
}

function fakeProvider(): EmbeddingProvider {
  return {
    model: "test-model",
    dimensions: 4,
    async embed(texts: string[]) {
      return texts.map((text, index) => [index, text.length, 0, 1]);
    },
  };
}

async function applyMigration(
  database: Awaited<ReturnType<Miniflare["getD1Database"]>>,
  sql: string,
) {
  const statements = sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await database.prepare(statement).run();
  }
}

describe("embedding outbox", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "flaremo-embedding-test" },
    });
    const database = await mf.getD1Database("DB");
    db = createDb(database);
    const migrationNames = [
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
      "0012_slow_nick_fury.sql",
    ];
    for (const name of migrationNames) {
      const sql = await readFile(
        resolve(import.meta.dirname, `../../../migrations/${name}`),
        "utf8",
      );
      await applyMigration(database, sql);
    }
    user = await ensureSingleUser(db, {
      email: "owner@example.com",
      name: "Owner",
    });
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("indexes a memo after creation and marks it indexed", async () => {
    const memo = await createMemo(db, user, {
      content: "FlareMo 使用 D1 作为事实源",
      visibility: "private",
      source: "web",
    });
    const index = new FakeVectorIndex();
    await dispatchEmbeddingOutbox(db, {
      provider: fakeProvider(),
      memosIndex: index,
      memoriesIndex: null,
    });

    expect(index.store.size).toBe(1);
    const updated = await db
      .select()
      .from(memos)
      .where(eq(memos.id, memo.id))
      .get();
    expect(updated?.embeddingStatus).toBe("indexed");
    expect(updated?.embeddingVersion).toBe("test-model@4");
  });

  it("stores vectors under the owning user's namespace", async () => {
    const memo = await createMemo(db, user, {
      content: "租户隔离的向量",
      visibility: "private",
      source: "web",
    });
    const index = new FakeVectorIndex();
    await dispatchEmbeddingOutbox(db, {
      provider: fakeProvider(),
      memosIndex: index,
      memoriesIndex: null,
    });

    expect(index.store.size).toBe(1);
    const [stored] = [...index.store.values()];
    expect(stored).toBeDefined();
    expect(stored?.namespace).toBe(user.id);
  });

  it("deletes vectors on hard delete", async () => {
    const memo = await createMemo(db, user, {
      content: "待删除的笔记",
      visibility: "private",
      source: "web",
    });
    const index = new FakeVectorIndex();
    await dispatchEmbeddingOutbox(db, {
      provider: fakeProvider(),
      memosIndex: index,
      memoriesIndex: null,
    });
    expect(index.store.size).toBe(1);

    await hardDeleteMemo(db, user, memo.id);
    await dispatchEmbeddingOutbox(db, {
      provider: fakeProvider(),
      memosIndex: index,
      memoriesIndex: null,
    });
    expect(index.store.size).toBe(0);
  });

  it("completes without indexing when the provider is null", async () => {
    await createMemo(db, user, {
      content: "无 provider 时只走关键词搜索",
      visibility: "private",
      source: "web",
    });
    const index = new FakeVectorIndex();
    await dispatchEmbeddingOutbox(db, {
      provider: null,
      memosIndex: index,
      memoriesIndex: null,
    });
    expect(index.store.size).toBe(0);
    const tasks = await db.select().from(embeddingTasks);
    expect(tasks.every((task) => task.status === "succeeded")).toBe(true);
  });

  it("indexes a memory into the memories index", async () => {
    const result = await createMemory(db, user, USER_ACTOR, {
      content: "FlareMo 用 D1 作为事实源",
      type: "semantic",
      kind: "fact",
      scopeType: "global",
      scopeKey: null,
      tier: "normal",
      importance: 50,
      confidence: 50,
    });
    const memoriesIndex = new FakeVectorIndex();
    await dispatchEmbeddingOutbox(db, {
      provider: fakeProvider(),
      memosIndex: null,
      memoriesIndex,
    });

    expect(memoriesIndex.store.size).toBe(1);
    const rows = await db
      .select()
      .from(memoryItems)
      .where(eq(memoryItems.id, result.memory.id));
    expect(rows[0]?.embeddingStatus).toBe("indexed");
  });

  it("rebuilds both indexes from D1", async () => {
    await createMemo(db, user, {
      content: "重建的 memo",
      visibility: "private",
      source: "web",
    });
    await createMemory(db, user, USER_ACTOR, {
      content: "重建的 memory",
      type: "semantic",
      kind: "fact",
      scopeType: "global",
      scopeKey: null,
      tier: "normal",
      importance: 50,
      confidence: 50,
    });

    const memosIndex = new FakeVectorIndex();
    const memoriesIndex = new FakeVectorIndex();
    const result = await rebuildEmbeddingIndexes(db, {
      provider: fakeProvider(),
      memosIndex,
      memoriesIndex,
    });

    expect(result.memosIndexed).toBe(1);
    expect(result.memoriesIndexed).toBe(1);
    expect(memosIndex.store.size).toBe(1);
    expect(memoriesIndex.store.size).toBe(1);
  });

  it("meters tokens and calls after a successful embed", async () => {
    await createMemo(db, user, {
      content: "计量这条笔记的 embedding 用量",
      visibility: "private",
      source: "web",
    });
    await dispatchEmbeddingOutbox(db, {
      provider: fakeProvider(),
      memosIndex: new FakeVectorIndex(),
      memoriesIndex: null,
    });

    expect(await readMonthlyUsageTotal(db, "embedding_tokens")).toBeGreaterThan(
      0,
    );
    expect(await readMonthlyUsageTotal(db, "embedding_calls")).toBe(1);
  });

  it("judges each task against its own user when per-user limits apply", async () => {
    const spent = await createMemo(db, user, {
      content: "这个用户的预算已耗尽",
      visibility: "private",
      source: "web",
    });
    const fresh = await createFlaremoMember(db, {
      email: "fresh@example.com",
      name: "Fresh",
    });
    const freshMemo = await createMemo(db, fresh, {
      content: "新用户预算充足，正常索引",
      visibility: "private",
      source: "web",
    });
    await incrementUsageCounter(db, user, "embedding_tokens", 100);
    const userLimits = {
      aiEmbeddingTokensPerMonth: 100,
      attachmentStorageBytes: null,
      semanticSearchQueriesPerMonth: null,
      maxMemosPerUser: null,
      maxMemoryItemsPerUser: null,
    };

    let embedCalls = 0;
    const provider: EmbeddingProvider = {
      ...fakeProvider(),
      async embed(texts) {
        embedCalls += 1;
        return fakeProvider().embed(texts);
      },
    };
    await dispatchEmbeddingOutbox(db, {
      provider,
      memosIndex: new FakeVectorIndex(),
      memoriesIndex: null,
      userLimits,
    });

    // The spent user's task pauses (pending, no embed); the fresh user's
    // task still processes because their own budget is untouched.
    const rows = await db.select().from(embeddingTasks);
    const spentRow = rows.find((row) => row.resourceId === spent.id);
    const freshRow = rows.find((row) => row.resourceId === freshMemo.id);
    expect(spentRow?.status).toBe("pending");
    expect(freshRow?.status).toBe("succeeded");
    expect(embedCalls).toBe(1);
    const freshMemoRow = await db
      .select()
      .from(memos)
      .where(eq(memos.id, freshMemo.id))
      .get();
    expect(freshMemoRow?.embeddingStatus).toBe("indexed");
  });

  it("pauses when the monthly budget is spent and resumes later", async () => {
    const memo = await createMemo(db, user, {
      content: "预算耗尽时这条不会被索引",
      visibility: "private",
      source: "web",
    });
    await incrementUsageCounter(db, user, "embedding_tokens", 100);
    const limits = { ...SELF_HOST_UNLIMITED, aiEmbeddingTokensPerMonth: 100 };

    let embedCalls = 0;
    const provider: EmbeddingProvider = {
      ...fakeProvider(),
      async embed(texts) {
        embedCalls += 1;
        return fakeProvider().embed(texts);
      },
    };
    await dispatchEmbeddingOutbox(db, {
      provider,
      memosIndex: new FakeVectorIndex(),
      memoriesIndex: null,
      limits,
    });

    // The budget is spent: nothing embeds, the task stays pending with its
    // retry budget intact, and the memo is not marked as failed.
    expect(embedCalls).toBe(0);
    const pending = await db.select().from(embeddingTasks);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.status).toBe("pending");
    expect(pending[0]?.attempts).toBe(0);
    const untouched = await db
      .select()
      .from(memos)
      .where(eq(memos.id, memo.id))
      .get();
    expect(untouched?.embeddingStatus).not.toBe("indexed");

    // A later sweep with budget available picks the task back up.
    await dispatchEmbeddingOutbox(db, {
      provider,
      memosIndex: new FakeVectorIndex(),
      memoriesIndex: null,
    });
    expect(embedCalls).toBe(1);
    const indexed = await db
      .select()
      .from(memos)
      .where(eq(memos.id, memo.id))
      .get();
    expect(indexed?.embeddingStatus).toBe("indexed");
  });
});
