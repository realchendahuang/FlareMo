import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { UserRow } from "@flaremo/db";
import { createDb, memos } from "@flaremo/db";
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
import { createMemo } from "./memos";
import { semanticSearchMemos } from "./semantic-search";
import { ensureSingleUser } from "./users";

let mf: Miniflare;
let db: ReturnType<typeof createDb>;
let user: UserRow;

class FakeVectorIndex implements VectorIndex {
  vectors = new Map<string, VectorIndexVector>();
  matches: VectorIndexMatch[] = [];

  async query(_vector: number[], _topK: number): Promise<VectorIndexMatch[]> {
    return this.matches;
  }
  async upsert(vectors: VectorIndexVector[]) {
    for (const vector of vectors) this.vectors.set(vector.id, vector);
  }
  async deleteByIds(ids: string[]) {
    for (const id of ids) this.vectors.delete(id);
  }
  async describe(): Promise<VectorIndexInfo> {
    return { vectorCount: this.vectors.size, dimensions: 4 };
  }
}

const provider: EmbeddingProvider = {
  model: "test-model",
  dimensions: 4,
  async embed(texts: string[]) {
    return texts.map(() => [1, 0, 0, 0]);
  },
};

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

describe("semanticSearchMemos", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "flaremo-semantic-test" },
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

  it("returns re-checked D1 hits ordered by score", async () => {
    const a = await createMemo(db, user, {
      content: "关于日志方案的笔记",
      visibility: "private",
      source: "web",
    });
    const b = await createMemo(db, user, {
      content: "关于部署的笔记",
      visibility: "private",
      source: "web",
    });

    const index = new FakeVectorIndex();
    index.matches = [
      { id: `${b.id}#chunks/0`, score: 0.9 },
      { id: `${a.id}#chunks/0`, score: 0.6 },
    ];

    const hits = await semanticSearchMemos(
      db,
      user,
      { provider, index },
      "日志",
      10,
    );
    expect(hits.map((hit) => hit.id)).toEqual([b.id, a.id]);
  });

  it("drops hits for memos that are no longer indexable", async () => {
    const a = await createMemo(db, user, {
      content: "一条会被删除的笔记",
      visibility: "private",
      source: "web",
    });

    const index = new FakeVectorIndex();
    // The vector is stale — the memo was trashed after indexing.
    index.matches = [{ id: `${a.id}#chunks/0`, score: 0.8 }];
    await db.update(memos).set({ status: "trashed" }).where(eq(memos.id, a.id));

    const hits = await semanticSearchMemos(
      db,
      user,
      { provider, index },
      "删除",
      10,
    );
    expect(hits).toEqual([]);
  });
});
