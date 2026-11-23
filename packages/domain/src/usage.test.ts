import type { UserRow } from "@flaremo/db";
import { applyFlaremoMigrations, createDb } from "@flaremo/db";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { incrementUsageCounter, reportVectorUsage } from "./usage";
import { createFlaremoMember, ensureSingleUser } from "./users";

let mf: Miniflare;
let db: ReturnType<typeof createDb>;
let user: UserRow;

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

  it("reports stored dimensions derived from the caller's D1 rows", async () => {
    const { memos } = await import("@flaremo/db");
    const now = new Date().toISOString();
    const memoId = crypto.randomUUID();
    await db.insert(memos).values({
      id: memoId,
      userId: user.id,
      content: "一条已索引的笔记",
      visibility: "private",
      status: "normal",
      source: "web",
      payload: {},
      createdAt: now,
      updatedAt: now,
      embeddingStatus: "indexed",
      embeddingChunks: 3,
    });
    await db.insert(memos).values({
      id: crypto.randomUUID(),
      userId: user.id,
      content: "一条未索引的笔记",
      visibility: "private",
      status: "normal",
      source: "web",
      payload: {},
      createdAt: now,
      updatedAt: now,
      embeddingStatus: "not_indexed",
      embeddingChunks: null,
    });
    const report = await reportVectorUsage(db, user, {
      provider: "workers-ai",
      model: "test-model",
      dimensions: 1024,
      storedLimit: 5_000_000,
      queriedLimit: 30_000_000,
    });

    expect(report.indexes).toHaveLength(1);
    expect(report.indexes[0]?.kind).toBe("memo");
    expect(report.indexes[0]?.vectors_count).toBe(3);
    expect(report.indexes[0]?.stored_dimensions).toBe(3 * 1024);
  });

  it("never counts another user's vectors in a shared deployment", async () => {
    const { memos } = await import("@flaremo/db");
    const other = await createFlaremoMember(db, {
      email: "other@example.com",
      name: "Other",
    });
    const now = new Date().toISOString();
    await db.insert(memos).values({
      id: crypto.randomUUID(),
      userId: other.id,
      content: "别人的已索引笔记",
      visibility: "private",
      status: "normal",
      source: "web",
      payload: {},
      createdAt: now,
      updatedAt: now,
      embeddingStatus: "indexed",
      embeddingChunks: 50,
    });

    const report = await reportVectorUsage(db, user, {
      provider: "workers-ai",
      model: "test-model",
      dimensions: 1024,
      storedLimit: 5_000_000,
      queriedLimit: 30_000_000,
    });

    expect(report.indexes[0]?.vectors_count).toBe(0);
  });

  it("increments a month-bucketed counter", async () => {
    await incrementUsageCounter(db, user, "queried_dims", 1024);
    await incrementUsageCounter(db, user, "queried_dims", 1024);

    const report = await reportVectorUsage(db, user, {
      provider: "workers-ai",
      model: "test-model",
      dimensions: 1024,
      storedLimit: 5_000_000,
      queriedLimit: 30_000_000,
    });

    expect(report.queried_dimensions_this_month).toBe(2048);
  });
});
