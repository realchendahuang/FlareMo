import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { UserRow } from "@flaremo/db";
import { attachments, createDb } from "@flaremo/db";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QuotaExceededError } from "./errors";
import { SELF_HOST_UNLIMITED } from "./limits";
import {
  assertAttachmentStorageQuota,
  assertMemberQuota,
  assertMonthlyQuota,
  countFlaremoUsers,
  estimateTokenCount,
  getAttachmentStorageBytes,
  readMonthlyUsageTotal,
  reportPlanUsage,
} from "./quotas";
import { incrementUsageCounter } from "./usage";
import { createFlaremoMember, ensureSingleUser } from "./users";

let mf: Miniflare;
let db: ReturnType<typeof createDb>;
let owner: UserRow;

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

async function insertAttachment(
  userId: string,
  size: number,
  state: "ready" | "deleting" | "missing" = "ready",
) {
  const now = new Date().toISOString();
  await db.insert(attachments).values({
    id: `attachments/${crypto.randomUUID()}`,
    userId,
    r2Key: `r2/${crypto.randomUUID()}`,
    filename: "file.bin",
    size,
    state,
    createdAt: now,
    updatedAt: now,
  });
}

describe("plan quota checks", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "flaremo-quotas-test" },
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
    owner = await ensureSingleUser(db, {
      email: "owner@example.com",
      name: "Owner",
    });
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("estimates tokens from input characters", () => {
    expect(estimateTokenCount([])).toBe(0);
    expect(estimateTokenCount(["abcd"])).toBe(1);
    expect(estimateTokenCount(["abcd", "ef"])).toBe(2);
    expect(estimateTokenCount(["中文文本！"])).toBe(2);
  });

  it("sums monthly usage across users", async () => {
    const member = await createFlaremoMember(db, {
      email: "member@example.com",
      name: "Member",
    });
    await incrementUsageCounter(db, owner, "search_queries", 3);
    await incrementUsageCounter(db, member, "search_queries", 4);

    expect(await readMonthlyUsageTotal(db, "search_queries")).toBe(7);
  });

  it("throws at the monthly limit and passes below it", async () => {
    await incrementUsageCounter(db, owner, "search_queries", 10);
    await expect(
      assertMonthlyQuota(db, 10, "search_queries", "over"),
    ).rejects.toThrow(QuotaExceededError);
    await expect(
      assertMonthlyQuota(db, 11, "search_queries", "over"),
    ).resolves.toBeUndefined();
    // null limit = unlimited, even far past any number.
    await assertMonthlyQuota(db, null, "search_queries", "over");
  });

  it("counts only ready attachments when checking storage", async () => {
    await insertAttachment(owner.id, 100);
    await insertAttachment(owner.id, 200);
    await insertAttachment(owner.id, 5_000, "deleting");
    await insertAttachment(owner.id, 5_000, "missing");
    expect(await getAttachmentStorageBytes(db)).toBe(300);

    const limits = { ...SELF_HOST_UNLIMITED, attachmentStorageBytes: 400 };
    await expect(
      assertAttachmentStorageQuota(db, limits, 100),
    ).resolves.toBeUndefined();
    await expect(assertAttachmentStorageQuota(db, limits, 101)).rejects.toThrow(
      QuotaExceededError,
    );
    await assertAttachmentStorageQuota(
      db,
      SELF_HOST_UNLIMITED,
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("enforces the member cap across the deployment", async () => {
    await createFlaremoMember(db, {
      email: "member@example.com",
      name: "Member",
    });
    expect(await countFlaremoUsers(db)).toBe(2);

    const limits = { ...SELF_HOST_UNLIMITED, maxMembersPerDeployment: 2 };
    await expect(assertMemberQuota(db, limits)).rejects.toThrow(
      QuotaExceededError,
    );
    const raised = { ...SELF_HOST_UNLIMITED, maxMembersPerDeployment: 3 };
    await expect(assertMemberQuota(db, raised)).resolves.toBeUndefined();
    await assertMemberQuota(db, SELF_HOST_UNLIMITED);
  });

  it("reports used values for every plan dimension", async () => {
    const member = await createFlaremoMember(db, {
      email: "member@example.com",
      name: "Member",
    });
    await insertAttachment(owner.id, 512);
    await incrementUsageCounter(db, member, "embedding_tokens", 20);
    await incrementUsageCounter(db, owner, "search_queries", 2);

    const report = await reportPlanUsage(db, SELF_HOST_UNLIMITED);
    expect(report.limits).toEqual(SELF_HOST_UNLIMITED);
    expect(report.usage.attachmentStorageBytes).toBe(512);
    expect(report.usage.aiEmbeddingTokensPerMonth).toBe(20);
    expect(report.usage.semanticSearchQueriesPerMonth).toBe(2);
    expect(report.usage.maxMembersPerDeployment).toBe(2);
  });
});
