import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { UserRow } from "@flaremo/db";
import { createDb } from "@flaremo/db";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VectorIndex, VectorIndexInfo } from "./embedding";
import { incrementUsageCounter, reportVectorUsage } from "./usage";
import { ensureSingleUser } from "./users";

let mf: Miniflare;
let db: ReturnType<typeof createDb>;
let user: UserRow;

class FakeIndex implements VectorIndex {
  info: VectorIndexInfo = { vectorCount: 10, dimensions: 1024 };
  async query() {
    return [];
  }
  async upsert() {}
  async deleteByIds() {}
  async describe() {
    return this.info;
  }
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

describe("vector usage", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "flaremo-usage-test" },
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
      "0014_steep_carnage.sql",
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

  it("reports stored dimensions from index describe", async () => {
    const memosIndex = new FakeIndex();
    const memoriesIndex = new FakeIndex();
    memoriesIndex.info = { vectorCount: 5, dimensions: 1024 };

    const report = await reportVectorUsage(
      db,
      user,
      {
        provider: "workers-ai",
        model: "test-model",
        dimensions: 1024,
        storedLimit: 5_000_000,
        queriedLimit: 30_000_000,
      },
      { memosIndex, memoriesIndex },
    );

    expect(report.indexes).toHaveLength(2);
    expect(report.indexes[0]?.stored_dimensions).toBe(10 * 1024);
    expect(report.indexes[1]?.stored_dimensions).toBe(5 * 1024);
  });

  it("increments a month-bucketed counter", async () => {
    await incrementUsageCounter(db, user, "queried_dims", 1024);
    await incrementUsageCounter(db, user, "queried_dims", 1024);

    const report = await reportVectorUsage(
      db,
      user,
      {
        provider: "workers-ai",
        model: "test-model",
        dimensions: 1024,
        storedLimit: 5_000_000,
        queriedLimit: 30_000_000,
      },
      { memosIndex: null, memoriesIndex: null },
    );

    expect(report.queried_dimensions_this_month).toBe(2048);
  });
});
