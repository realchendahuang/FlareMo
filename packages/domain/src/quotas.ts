import type { FlareMoDb } from "@flaremo/db";
import { attachments, memoryItems, usageCounters, users } from "@flaremo/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { QuotaExceededError } from "./errors";
import type { PlanLimits, PlanLimitValue, UserPlanLimits } from "./limits";
import { readHourlyCountTotals } from "./memo-hourly-counts";
import { sinkDormantObservedMemories } from "./memory/maintenance";
import type { UsageMetric } from "./usage";
import { currentMonthKey } from "./usage";

/**
 * Per-request quota scope. When `userLimits` sets a dimension it wins over
 * the deployment limit for that dimension, and usage is read for `userId`
 * only; unset dimensions fall through to the deployment-wide check.
 */
export type QuotaScope = {
  userLimits?: UserPlanLimits | null;
  userId?: string;
};

/**
 * Quota enforcement primitives shared by the kernel's execution points. Every
 * check treats a `null` limit as unlimited, so self-hosted deployments running
 * SELF_HOST_UNLIMITED bypass the whole module. Plan budgets are deployment-wide
 * (each FlareMo deployment owns its D1), while usage_counters rows are
 * per-user — the reads below therefore sum across users.
 */

/**
 * Rough input-size estimate for providers that do not report token counts
 * (Workers AI embeddings return vectors only). Four characters per token is
 * the conventional heuristic for mixed-language text.
 */
export function estimateTokenCount(texts: string[]): number {
  const chars = texts.reduce((sum, text) => sum + text.length, 0);
  return Math.ceil(chars / 4);
}

/** Deployment-wide monthly usage for one counter metric, summed over users. */
export async function readMonthlyUsageTotal(
  db: FlareMoDb,
  metric: UsageMetric,
): Promise<number> {
  const row = await db
    .select({
      total: sql<number>`coalesce(sum(${usageCounters.count}), 0)`,
    })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.month, currentMonthKey()),
        eq(usageCounters.metric, metric),
      ),
    )
    .get();
  return row?.total ?? 0;
}

/** One user's monthly usage for one counter metric. */
export async function readUserMonthlyUsage(
  db: FlareMoDb,
  userId: string,
  metric: UsageMetric,
): Promise<number> {
  const row = await db
    .select({
      total: sql<number>`coalesce(sum(${usageCounters.count}), 0)`,
    })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.userId, userId),
        eq(usageCounters.month, currentMonthKey()),
        eq(usageCounters.metric, metric),
      ),
    )
    .get();
  return row?.total ?? 0;
}

const MONTHLY_METRIC_TO_USER_LIMIT_KEY = {
  embedding_tokens: "aiEmbeddingTokensPerMonth",
  search_queries: "semanticSearchQueriesPerMonth",
} as const satisfies Record<
  "embedding_tokens" | "search_queries",
  keyof UserPlanLimits
>;

function userMonthlyLimit(
  userLimits: UserPlanLimits | null | undefined,
  metric: "embedding_tokens" | "search_queries",
): PlanLimitValue {
  if (!userLimits) return null;
  return userLimits[MONTHLY_METRIC_TO_USER_LIMIT_KEY[metric]];
}

/**
 * Throws QuotaExceededError when the monthly budget is spent. Without a
 * scope this checks the deployment-wide total against the deployment limit;
 * with a user limit in scope it checks that user's own usage instead.
 */
export async function assertMonthlyQuota(
  db: FlareMoDb,
  limit: PlanLimitValue,
  metric: UsageMetric,
  message: string,
  scope?: QuotaScope,
): Promise<void> {
  if (metric !== "search_queries" && metric !== "embedding_tokens") {
    throw new Error(`metric ${metric} has no monthly quota`);
  }
  const scopedLimit = userMonthlyLimit(scope?.userLimits, metric);
  const effective = scopedLimit ?? limit;
  if (effective === null) return;
  const used =
    scopedLimit !== null && scope?.userId
      ? await readUserMonthlyUsage(db, scope.userId, metric)
      : await readMonthlyUsageTotal(db, metric);
  if (used >= effective) {
    throw new QuotaExceededError(message);
  }
}

/**
 * Total bytes of live attachment objects recorded in D1. Without `userId`
 * this spans all users (deployment-wide); with it, only that user's objects.
 */
export async function getAttachmentStorageBytes(
  db: FlareMoDb,
  userId?: string,
): Promise<number> {
  const row = await db
    .select({
      // The preview object lives beside the original, so both bytes count
      // against the same quota even though only `size` is public metadata.
      total: sql<number>`coalesce(sum(${attachments.size} + ${attachments.thumbnailSize}), 0)`,
    })
    .from(attachments)
    .where(
      userId
        ? and(eq(attachments.state, "ready"), eq(attachments.userId, userId))
        : eq(attachments.state, "ready"),
    )
    .get();
  return row?.total ?? 0;
}

export async function assertAttachmentStorageQuota(
  db: FlareMoDb,
  limits: PlanLimits,
  incomingBytes: number,
  scope?: QuotaScope,
): Promise<void> {
  const userLimit = scope?.userLimits?.attachmentStorageBytes ?? null;
  const effective = userLimit ?? limits.attachmentStorageBytes;
  if (effective === null) return;
  const stored =
    userLimit !== null && scope?.userId
      ? await getAttachmentStorageBytes(db, scope.userId)
      : await getAttachmentStorageBytes(db);
  if (stored + incomingBytes > effective) {
    throw new QuotaExceededError(
      `Attachment storage quota exceeded (${formatBytes(effective)} plan limit)`,
    );
  }
}

/**
 * Stock memo count for one user: normal + archived count against the quota;
 * trash and hard-deleted rows do not.
 *
 * Served from `memo_hourly_counts` rather than a `count(*)` over `memos`. That
 * matters because this is on the create path: every memo write ran a full scan
 * of the author's own memos first, so a quota-enabled deployment paid O(memos)
 * per write on top of the write itself. The counter answers the identical
 * question — it holds one row per author and UTC hour, split by current status,
 * so summing normal + archived is the same number the scan produced.
 *
 * This is the same trust model the module already uses for every other quota
 * dimension: the monthly search and embedding budgets are read from
 * `usage_counters`, a maintained counter with the same drift characteristics.
 * Drift is bounded by the nightly recalibration, and the caller
 * ({@link assertMemoCountQuota}) documents itself as an advisory pre-check that
 * concurrent writers can already overshoot by one.
 */
export async function countUserMemos(
  db: FlareMoDb,
  userId: string,
): Promise<number> {
  const totals = await readHourlyCountTotals(db, userId);
  return totals.normal + totals.archived;
}

/** Stock memory count for one user: active + archived. */
export async function countUserMemories(
  db: FlareMoDb,
  userId: string,
): Promise<number> {
  const row = await db
    .select({ total: sql<number>`count(*)` })
    .from(memoryItems)
    .where(
      and(
        eq(memoryItems.userId, userId),
        inArray(memoryItems.status, ["active", "archived"]),
      ),
    )
    .get();
  return row?.total ?? 0;
}

/**
 * Throws when the user's living-memo stock (plus `additional` about to be
 * written, e.g. an import bundle) would reach the per-user cap.
 *
 * Advisory pre-check, not a transactional lock: the count read and the
 * follow-up insert are separate statements, so concurrent writers can
 * transiently overshoot by one. D1 offers no cross-statement transaction
 * around the insert batch; the check stays in the hot path as the
 * deliberate trade-off.
 */
export async function assertMemoCountQuota(
  db: FlareMoDb,
  userLimits: UserPlanLimits | null | undefined,
  userId: string,
  additionalCount = 1,
): Promise<void> {
  const limit = userLimits?.maxMemosPerUser ?? null;
  if (limit === null) return;
  const used = await countUserMemos(db, userId);
  if (used + additionalCount > limit) {
    throw new QuotaExceededError(
      `Memo count quota exceeded (${limit} notes per user)`,
    );
  }
}

/** Same as assertMemoCountQuota for the Agent Memory stock. */
export async function assertMemoryCountQuota(
  db: FlareMoDb,
  userLimits: UserPlanLimits | null | undefined,
  userId: string,
  additionalCount = 1,
): Promise<void> {
  const limit = userLimits?.maxMemoryItemsPerUser ?? null;
  if (limit === null) return;
  const used = await countUserMemories(db, userId);
  if (used + additionalCount <= limit) return;

  // Over the cap, the ledger first sinks its own AI assets (§VI.12): dormant
  // observations archive before a write is refused — a quota rejection after
  // cleanup is explicit, never a silent drop.
  await sinkDormantObservedMemories(db, new Date(), 100);
  const afterSink = await countUserMemories(db, userId);
  if (afterSink + additionalCount > limit) {
    throw new QuotaExceededError(
      `Memory count quota exceeded (${limit} memories per user); dormant AI observations were archived first and more space is needed`,
    );
  }
}

export async function countFlaremoUsers(db: FlareMoDb): Promise<number> {
  const row = await db
    .select({ total: sql<number>`count(*)` })
    .from(users)
    .get();
  return row?.total ?? 0;
}

export async function assertMemberQuota(
  db: FlareMoDb,
  limits: PlanLimits,
): Promise<void> {
  const limit = limits.maxMembersPerDeployment;
  if (limit === null) return;
  const count = await countFlaremoUsers(db);
  if (count >= limit) {
    throw new QuotaExceededError(
      `Member limit reached (${limit} per deployment)`,
    );
  }
}

export type PlanUsageReport = {
  limits: PlanLimits;
  usage: {
    attachmentStorageBytes: number;
    aiEmbeddingTokensPerMonth: number;
    semanticSearchQueriesPerMonth: number;
    maxMembersPerDeployment: number;
  };
  /** Present only when per-user limits are configured on the deployment. */
  user?: UserPlanUsageReport;
};

export type UserPlanUsageReport = {
  limits: UserPlanLimits;
  usage: {
    attachmentStorageBytes: number;
    aiEmbeddingTokensPerMonth: number;
    semanticSearchQueriesPerMonth: number;
    maxMemosPerUser: number;
    maxMemoryItemsPerUser: number;
  };
};

/** Used-vs-limit snapshot for the account usage panel. */
export async function reportPlanUsage(
  db: FlareMoDb,
  limits: PlanLimits,
  scope?: { userId: string; userLimits: UserPlanLimits | null },
): Promise<PlanUsageReport> {
  const report: PlanUsageReport = {
    limits,
    usage: {
      attachmentStorageBytes: await getAttachmentStorageBytes(db),
      aiEmbeddingTokensPerMonth: await readMonthlyUsageTotal(
        db,
        "embedding_tokens",
      ),
      semanticSearchQueriesPerMonth: await readMonthlyUsageTotal(
        db,
        "search_queries",
      ),
      maxMembersPerDeployment: await countFlaremoUsers(db),
    },
  };
  if (scope?.userLimits) {
    report.user = {
      limits: scope.userLimits,
      usage: {
        attachmentStorageBytes: await getAttachmentStorageBytes(
          db,
          scope.userId,
        ),
        aiEmbeddingTokensPerMonth: await readUserMonthlyUsage(
          db,
          scope.userId,
          "embedding_tokens",
        ),
        semanticSearchQueriesPerMonth: await readUserMonthlyUsage(
          db,
          scope.userId,
          "search_queries",
        ),
        maxMemosPerUser: await countUserMemos(db, scope.userId),
        maxMemoryItemsPerUser: await countUserMemories(db, scope.userId),
      },
    };
  }
  return report;
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  if (mb >= 1) return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  return `${bytes} B`;
}
