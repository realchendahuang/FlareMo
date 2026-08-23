import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { UserRow } from "@flaremo/db";
import { createDb, embeddingTasks, memos } from "@flaremo/db";
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
import { dispatchEmbeddingOutbox } from "./embedding-outbox";
import { createMemo, hardDeleteMemo } from "./memos";
import { ensureSingleUser } from "./users";

let mf: Miniflare;
let db: ReturnType<typeof createDb>;
let user: UserRow;

class FakeVectorIndex implements VectorIndex {
  store = new Map<string, VectorIndexVector>();
  lastUpsert: VectorIndexVector[] = [];
  lastDeletedIds: string[] = [];

  async query(_vector: number[], _topK: number): Promise<VectorIndexMatch[]> {
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
});
