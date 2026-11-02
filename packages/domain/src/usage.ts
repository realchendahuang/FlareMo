import type { FlareMoDb, UserRow } from "@flaremo/db";
import { memos, usageCounters } from "@flaremo/db";
import { and, eq, sql } from "drizzle-orm";
export type VectorUsageReportInput = {
  provider: string;
  model: string;
  dimensions: number;
  storedLimit: number;
  queriedLimit: number;
};

export type VectorUsageIndexReport = {
  name: string;
  kind: "memo";
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

export function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

export type UsageMetric =
  | "queried_dims"
  | "embedding_tokens"
  | "embedding_calls"
  | "search_queries"
  // Seconds of uploaded audio transcribed through batch ASR (MiniMax),
  // attributed per user so shared deployments can explain provider cost.
  | "asr_seconds";

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
        eq(usageCounters.month, currentMonthKey()),
        eq(usageCounters.metric, metric),
      ),
    )
    .get();
  return row?.count ?? 0;
}

/**
 * Self-measured vector usage. Stored vector counts are derived from D1
 * (`embedding_chunks` on indexed rows) so a shared deployment reports the
 * caller's own vectors rather than the index-wide total; query dimensions and
 * embedding counters come from D1 usage_counters. This is a panel estimate
 * against the configured allowance, not Cloudflare's bill.
 */
export async function reportVectorUsage(
  db: FlareMoDb,
  user: UserRow,
  input: VectorUsageReportInput,
): Promise<VectorUsageReportResult> {
  const memoRow = await db
    .select({
      memoVectors: sql<number>`coalesce(sum(${memos.embeddingChunks}), 0)`,
    })
    .from(memos)
    .where(
      and(eq(memos.userId, user.id), eq(memos.embeddingStatus, "indexed")),
    );
  const memoVectors = Number(memoRow[0]?.memoVectors ?? 0);

  const indexes: VectorUsageIndexReport[] = [
    {
      name: "flaremo-memos",
      kind: "memo",
      vectors_count: memoVectors,
      stored_dimensions: memoVectors * input.dimensions,
    },
  ];
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
 * never blocks or fails a query. Accepts a bare `{ id }` so outbox workers
 * can attribute usage from a stored user id without re-reading the row.
 *
 * One statement, not read-then-write: concurrent searches would otherwise
 * both see "no row" and one increment would be lost.
 */
export async function incrementUsageCounter(
  db: FlareMoDb,
  user: Pick<UserRow, "id">,
  metric: UsageMetric,
  amount: number,
) {
  const month = currentMonthKey();
  const now = new Date().toISOString();
  await db
    .insert(usageCounters)
    .values({
      id: crypto.randomUUID(),
      userId: user.id,
      month,
      metric,
      count: amount,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [usageCounters.userId, usageCounters.month, usageCounters.metric],
      set: {
        count: sql`${usageCounters.count} + ${amount}`,
        updatedAt: now,
      },
    });
}
