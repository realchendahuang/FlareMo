import type { UserRow } from "@flaremo/db";
import {
  applyFlaremoMigrations,
  attachments,
  createDb,
  memos,
} from "@flaremo/db";
import { eq } from "drizzle-orm";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QuotaExceededError } from "./errors";
import { SELF_HOST_UNLIMITED, type UserPlanLimits } from "./limits";
import { createMemo, updateMemo } from "./memos";
import { hardDeleteMemo } from "./memos-lifecycle";
import {
  assertAttachmentStorageQuota,
  assertMemberQuota,
  assertMemoCountQuota,
  assertMonthlyQuota,
  countFlaremoUsers,
  countUserMemos,
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

// File-scoped so every describe in this file shares one fresh database per
// test. Hooks nested inside a describe only apply to that describe, and the
// counter describe below needs the same fixture.
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
  await applyFlaremoMigrations(database);
  owner = await ensureSingleUser(db, {
    email: "owner@example.com",
    name: "Owner",
  });
});

afterEach(async () => {
  await mf.dispose();
});

describe("plan quota checks", () => {
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

  it("scopes storage and monthly checks to the user when user limits apply", async () => {
    const member = await createFlaremoMember(db, {
      email: "member@example.com",
      name: "Member",
    });
    // Owner owns 900 bytes, member owns 100 bytes.
    await insertAttachment(owner.id, 900);
    await insertAttachment(member.id, 100);

    const userLimits: UserPlanLimits = {
      attachmentStorageBytes: 500,
      aiEmbeddingTokensPerMonth: null,
      semanticSearchQueriesPerMonth: null,
      maxMemosPerUser: null,
    };

    // The member is within their own 500-byte quota despite the deployment
    // holding 1000 bytes; the owner is over it.
    await expect(
      assertAttachmentStorageQuota(db, SELF_HOST_UNLIMITED, 50, {
        userLimits,
        userId: member.id,
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertAttachmentStorageQuota(db, SELF_HOST_UNLIMITED, 50, {
        userLimits,
        userId: owner.id,
      }),
    ).rejects.toThrow(QuotaExceededError);

    // Monthly metric: member used 2 of their own 2-query budget -> 429, even
    // though the deployment-wide total (2) is under the deployment limit 10.
    await incrementUsageCounter(db, owner, "search_queries", 2);
    await expect(
      assertMonthlyQuota(db, null, "search_queries", "over", {
        userLimits: { ...userLimits, semanticSearchQueriesPerMonth: 2 },
        userId: owner.id,
      }),
    ).rejects.toThrow(QuotaExceededError);
    await expect(
      assertMonthlyQuota(db, null, "search_queries", "over", {
        userLimits: { ...userLimits, semanticSearchQueriesPerMonth: 2 },
        userId: member.id,
      }),
    ).resolves.toBeUndefined();

    // Without user limits the deployment-wide check still applies.
    await expect(
      assertMonthlyQuota(db, 1, "search_queries", "over"),
    ).rejects.toThrow(QuotaExceededError);
  });

  it("enforces per-user memo stock caps", async () => {
    const member = await createFlaremoMember(db, {
      email: "member@example.com",
      name: "Member",
    });
    // Owner owns one living memo; member none.
    await createMemo(db, owner, {
      content: "owner memo",
      visibility: "private",
      source: "web",
    });
    const ownerLimits: UserPlanLimits = {
      attachmentStorageBytes: null,
      aiEmbeddingTokensPerMonth: null,
      semanticSearchQueriesPerMonth: null,
      maxMemosPerUser: 1,
    };

    await expect(
      assertMemoCountQuota(db, ownerLimits, member.id),
    ).resolves.toBeUndefined();
    await expect(
      assertMemoCountQuota(db, ownerLimits, owner.id),
    ).rejects.toThrow(QuotaExceededError);
    // Imports pre-check the bundle size against remaining headroom:
    // member has 0 memos and a cap of 1, so a bundle of 2 must be rejected
    // while exactly 1 (reaching the cap) is allowed.
    await expect(
      assertMemoCountQuota(db, ownerLimits, member.id, 1),
    ).resolves.toBeUndefined();
    await expect(
      assertMemoCountQuota(db, ownerLimits, member.id, 2),
    ).rejects.toThrow(QuotaExceededError);

    // Unset limits never constrain.
    await assertMemoCountQuota(db, null, owner.id);
  });

  it("reports a per-user section in the plan usage report", async () => {
    await insertAttachment(owner.id, 700);
    await incrementUsageCounter(db, owner, "search_queries", 3);
    const userLimits: UserPlanLimits = {
      attachmentStorageBytes: 1000,
      aiEmbeddingTokensPerMonth: null,
      semanticSearchQueriesPerMonth: 100,
      maxMemosPerUser: null,
    };

    const report = await reportPlanUsage(db, SELF_HOST_UNLIMITED, {
      userId: owner.id,
      userLimits,
    });
    expect(report.user?.limits).toEqual(userLimits);
    expect(report.user?.usage.attachmentStorageBytes).toBe(700);
    expect(report.user?.usage.semanticSearchQueriesPerMonth).toBe(3);
    expect(report.user?.usage.aiEmbeddingTokensPerMonth).toBe(0);

    const anonymous = await reportPlanUsage(db, SELF_HOST_UNLIMITED);
    expect(anonymous.user).toBeUndefined();
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

/**
 * `countUserMemos` answers from the maintained hourly counter rather than a
 * `count(*)` over `memos`, so these pin the two to the same number. The
 * lifecycle transitions are the interesting cases: each one moves a memo into
 * or out of the quota'd set (normal + archived) and must move the count by
 * exactly one, in the right direction.
 */
describe("countUserMemos matches a live scan", () => {
  async function liveScan(userId: string) {
    const rows = await db
      .select({ status: memos.status })
      .from(memos)
      .where(eq(memos.userId, userId));
    return rows.filter(
      (row) => row.status === "normal" || row.status === "archived",
    ).length;
  }

  it("tracks the quota'd set across every lifecycle transition", async () => {
    const expectAgreement = async () => {
      expect(await countUserMemos(db, owner.id)).toBe(await liveScan(owner.id));
    };

    expect(await countUserMemos(db, owner.id)).toBe(0);

    const a = await createMemo(db, owner, {
      content: "counted",
      visibility: "private",
      source: "web",
    });
    const b = await createMemo(db, owner, {
      content: "also counted",
      visibility: "private",
      source: "web",
    });
    await expectAgreement();
    expect(await countUserMemos(db, owner.id)).toBe(2);

    // Archived still counts against the quota; trashed does not.
    await updateMemo(db, owner, a.id, { status: "archived" });
    await expectAgreement();
    expect(await countUserMemos(db, owner.id)).toBe(2);

    await updateMemo(db, owner, b.id, { status: "trashed" });
    await expectAgreement();
    expect(await countUserMemos(db, owner.id)).toBe(1);

    // Restoring from the recycle bin brings it back.
    await updateMemo(db, owner, b.id, { status: "normal" });
    await expectAgreement();
    expect(await countUserMemos(db, owner.id)).toBe(2);

    // A hard delete removes it for good.
    await hardDeleteMemo(db, owner, a.id);
    await expectAgreement();
    expect(await countUserMemos(db, owner.id)).toBe(1);
  });

  it("does not count another user's memos", async () => {
    const member = await createFlaremoMember(db, {
      email: "counter-member@example.com",
      name: "Counter Member",
    });
    await createMemo(db, owner, {
      content: "owner only",
      visibility: "private",
      source: "web",
    });
    expect(await countUserMemos(db, member.id)).toBe(0);
  });
});
