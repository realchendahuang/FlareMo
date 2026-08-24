import type { FlareMoDb, UserRow } from "@flaremo/db";
import { usageCounters } from "@flaremo/db";
import { and, eq, sql } from "drizzle-orm";
import type { VectorIndex } from "./embedding";

export type VectorUsageDeps = {
  memosIndex: VectorIndex | null;
  memoriesIndex: VectorIndex | null;
};

export type VectorUsageReportInput = {
  provider: string;
  model: string;
  dimensions: number;
  storedLimit: number;
  queriedLimit: number;
};

export type VectorUsageIndexReport = {
  name: string;
  kind: "memo" | "memory";
  vectors_count: number;
  stored_dimensions: number;
};

export type VectorUsageReportResult = {
  provider: string;
  model: string;
  dimensions: number;
  indexes: VectorUsageIndexReport[];
  queried_dimensions_this_month: number;
  embedding_calls_this_month: number;
  embedding_tokens_this_month: number;
  stored_limit: number;
  queried_limit: number;
};

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export type UsageMetric =
  | "queried_dims"
  | "embedding_tokens"
  | "embedding_calls";

async function readCounter(
  db: FlareMoDb,
  user: UserRow,
  metric: UsageMetric,
): Promise<number> {
  const row = await db
    .select()
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.userId, user.id),
        eq(usageCounters.month, currentMonth()),
        eq(usageCounters.metric, metric),
      ),
    )
    .get();
  return row?.count ?? 0;
}

/**
 * Self-measured vector usage: stored dimensions come from Vectorize describe(),
 * query dimensions and embedding counters from D1 usage_counters. This is a
 * panel estimate against the configured allowance, not Cloudflare's bill.
 */
export async function reportVectorUsage(
  db: FlareMoDb,
  user: UserRow,
  input: VectorUsageReportInput,
  deps: VectorUsageDeps,
): Promise<VectorUsageReportResult> {
  const indexes: VectorUsageIndexReport[] = [];
  for (const [kind, index, name] of [
    ["memo", deps.memosIndex, "flaremo-memos"],
    ["memory", deps.memoriesIndex, "flaremo-memories"],
  ] as const) {
    if (!index) {
      indexes.push({
        name,
        kind,
        vectors_count: 0,
        stored_dimensions: 0,
      });
      continue;
    }
    try {
      const info = await index.describe();
      indexes.push({
        name,
        kind,
        vectors_count: info.vectorCount,
        stored_dimensions:
          info.vectorCount * (info.dimensions || input.dimensions),
      });
    } catch {
      indexes.push({ name, kind, vectors_count: 0, stored_dimensions: 0 });
    }
  }

  return {
    provider: input.provider,
    model: input.model,
    dimensions: input.dimensions,
    indexes,
    queried_dimensions_this_month: await readCounter(db, user, "queried_dims"),
    embedding_calls_this_month: await readCounter(db, user, "embedding_calls"),
    embedding_tokens_this_month: await readCounter(
      db,
      user,
      "embedding_tokens",
    ),
    stored_limit: input.storedLimit,
    queried_limit: input.queriedLimit,
  };
}

/**
 * Bump a month-bucketed counter atomically (upsert by user/month/metric).
 * Called fire-and-forget from the semantic search paths so usage tracking
 * never blocks or fails a query.
 */
export async function incrementUsageCounter(
  db: FlareMoDb,
  user: UserRow,
  metric: UsageMetric,
  amount: number,
) {
  const month = currentMonth();
  const now = new Date().toISOString();
  const existing = await db
    .select({ id: usageCounters.id })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.userId, user.id),
        eq(usageCounters.month, month),
        eq(usageCounters.metric, metric),
      ),
    )
    .get();

  if (existing) {
    await db
      .update(usageCounters)
      .set({ count: sql`${usageCounters.count} + ${amount}`, updatedAt: now })
      .where(eq(usageCounters.id, existing.id));
  } else {
    await db.insert(usageCounters).values({
      id: crypto.randomUUID(),
      userId: user.id,
      month,
      metric,
      count: amount,
      updatedAt: now,
    });
  }
}
