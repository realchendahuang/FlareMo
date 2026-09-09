import type { UserRow } from "@flaremo/db";
import { applyFlaremoMigrations, createDb } from "@flaremo/db";
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
    await applyFlaremoMigrations(database);
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
