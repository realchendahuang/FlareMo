import type { FlareMoDb } from "@flaremo/db";
import { attachments, usageCounters, users } from "@flaremo/db";
import { and, eq, sql } from "drizzle-orm";
import { QuotaExceededError } from "./errors";
import type { PlanLimits, PlanLimitValue } from "./limits";
import type { UsageMetric } from "./usage";
import { currentMonthKey } from "./usage";

/**
 * Quota enforcement primitives shared by the kernel's execution points. Every
 * check treats a `null` limit as unlimited, so self-hosted deployments running
 * SELF_HOST_UNLIMITED bypass the whole module. Plan budgets are deployment-wide
 * (each FlareMo deployment owns its D1), while usage_counters rows are
 * per-user — the reads below therefore sum across users.
 */

export function isWithinLimit(used: number, limit: PlanLimitValue): boolean {
  return limit === null || used < limit;
}

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

/** Throws QuotaExceededError when the deployment's monthly budget is spent. */
export async function assertMonthlyQuota(
  db: FlareMoDb,
  limit: PlanLimitValue,
  metric: UsageMetric,
  message: string,
): Promise<void> {
  if (limit === null) return;
  const used = await readMonthlyUsageTotal(db, metric);
  if (used >= limit) {
    throw new QuotaExceededError(message);
  }
}

/** Total bytes of live attachment objects recorded in D1, across all users. */
export async function getAttachmentStorageBytes(
  db: FlareMoDb,
): Promise<number> {
  const row = await db
    .select({
      total: sql<number>`coalesce(sum(${attachments.size}), 0)`,
    })
    .from(attachments)
    .where(eq(attachments.state, "ready"))
    .get();
  return row?.total ?? 0;
}

export async function assertAttachmentStorageQuota(
  db: FlareMoDb,
  limits: PlanLimits,
  incomingBytes: number,
): Promise<void> {
  const limit = limits.attachmentStorageBytes;
  if (limit === null) return;
  const stored = await getAttachmentStorageBytes(db);
  if (stored + incomingBytes > limit) {
    throw new QuotaExceededError(
      `Attachment storage quota exceeded (${formatBytes(limit)} plan limit)`,
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
};

/** Used-vs-limit snapshot for the account usage panel. */
export async function reportPlanUsage(
  db: FlareMoDb,
  limits: PlanLimits,
): Promise<PlanUsageReport> {
  return {
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
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  if (mb >= 1) return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  return `${bytes} B`;
}
