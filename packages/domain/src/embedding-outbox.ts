import type {
  EmbeddingTaskRow,
  FlareMoDb,
  MemoRow,
  MemoryItemRow,
} from "@flaremo/db";
import { embeddingTasks, memoryItems, memos } from "@flaremo/db";
import { and, asc, eq, gt, inArray, isNull, lt, lte, or } from "drizzle-orm";
import {
  chunkText,
  chunkVectorIds,
  type EmbeddingProvider,
  embeddingVersion,
  type VectorIndex,
} from "./embedding";
import type { PlanLimits, UserPlanLimits } from "./limits";
import {
  estimateTokenCount,
  readMonthlyUsageTotal,
  readUserMonthlyUsage,
} from "./quotas";
import { incrementUsageCounter } from "./usage";

export type EmbeddingResourceType = "memo" | "memory";
export type EmbeddingTaskOperation = "index" | "reindex" | "delete";

const MAX_ATTEMPTS = 5;
const MAX_TASKS_PER_SWEEP = 32;
const TASK_LEASE_MS = 60_000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

// Delete operations run after the source row is gone (hard delete) or has no
// chunk count stored, so they clear a bounded window of chunk ids. Vectorize
// deleteByIds is a no-op for missing ids, and any residual vectors are still
// filtered out at query time by the D1 re-read, so this is a conservative
// sweep rather than an exact removal.
export const EMBEDDING_MAX_CHUNKS = 256;

export type EmbeddingDispatchDeps = {
  provider: EmbeddingProvider | null;
  memosIndex: VectorIndex | null;
  memoriesIndex: VectorIndex | null;
  /**
   * Monthly embedding-token budget. When set and exhausted, the sweep pauses:
   * claimed tasks are released back to pending and resume on a later sweep
   * (next month, or after a plan raise) instead of failing into retries.
   */
  limits?: PlanLimits;
  /**
   * Per-user budget for shared deployments. When set, each task is judged
   * against its owner's own usage; it wins over the deployment budget.
   */
  userLimits?: UserPlanLimits | null;
};

/**
 * Add a durable embedding outbox row to the caller's D1 batch. The row carries
 * only the resource identity and operation; the source text is read back from
 * D1 at dispatch time so a later edit or delete is always indexed from the
 * latest state.
 */
export function insertEmbeddingTask(
  db: FlareMoDb,
  input: {
    userId: string;
    resourceType: EmbeddingResourceType;
    resourceId: string;
    operation: EmbeddingTaskOperation;
    createdAt?: string;
  },
) {
  const now = input.createdAt ?? new Date().toISOString();
  return db.insert(embeddingTasks).values({
    id: `${input.resourceType}:${input.resourceId}:${input.operation}:${crypto.randomUUID()}`,
    userId: input.userId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    operation: input.operation,
    status: "pending",
    attempts: 0,
    nextAttemptAt: now,
    leaseUntil: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Sweep the embedding outbox: recover stale leases, claim a bounded batch, and
 * index or delete vectors. This never throws for a provider/index failure —
 * each task records its retry state so a later sweep (or the cron) continues.
 */
export async function dispatchEmbeddingOutbox(
  db: FlareMoDb,
  deps: EmbeddingDispatchDeps,
  now = new Date(),
) {
  const nowIso = now.toISOString();
  await recoverExpiredEmbeddingLeases(db, nowIso);

  if (!(await embeddingBudgetAvailable(db, deps.limits))) return;

  const tasks = await listClaimableEmbeddingTasks(db, nowIso);
  const claimed: EmbeddingTaskRow[] = [];
  for (const task of tasks) {
    const row = await claimEmbeddingTask(db, task, nowIso);
    if (row) claimed.push(row);
  }

  for (const task of claimed) {
    // Re-check inside the batch: earlier embeds in this sweep may have spent
    // the remaining budget, so release the rest rather than overshooting.
    // Each task is judged against its own user when per-user limits apply.
    if (
      !(await embeddingBudgetAvailable(
        db,
        deps.limits,
        deps.userLimits,
        task.userId,
      ))
    ) {
      await unclaimEmbeddingTask(db, task, nowIso);
      continue;
    }
    try {
      await processEmbeddingTask(db, deps, task, nowIso);
      await markEmbeddingTaskSucceeded(db, task.id, nowIso);
    } catch (error) {
      const message = embeddingFailureMessage(error);
      const dead = task.attempts + 1 >= MAX_ATTEMPTS;
      await markEmbeddingTaskFailed(db, task, now, message);
      if (dead) {
        await markResourceEmbeddingError(db, task, message);
      }
    }
  }

  await pruneEmbeddingOutbox(db, new Date(now.getTime() - RETENTION_MS));
}

async function embeddingBudgetAvailable(
  db: FlareMoDb,
  limits?: PlanLimits,
  userLimits?: UserPlanLimits | null,
  userId?: string,
): Promise<boolean> {
  const scoped = userLimits?.aiEmbeddingTokensPerMonth ?? null;
  const effective = scoped ?? limits?.aiEmbeddingTokensPerMonth ?? null;
  if (effective === null) return true;
  const used =
    scoped !== null && userId
      ? await readUserMonthlyUsage(db, userId, "embedding_tokens")
      : await readMonthlyUsageTotal(db, "embedding_tokens");
  return used < effective;
}

/** Release a claimed task without consuming a retry attempt. */
async function unclaimEmbeddingTask(
  db: FlareMoDb,
  task: EmbeddingTaskRow,
  nowIso: string,
) {
  await db
    .update(embeddingTasks)
    .set({
      status: "pending",
      attempts: task.attempts,
      leaseUntil: null,
      updatedAt: nowIso,
    })
    .where(eq(embeddingTasks.id, task.id));
}

/**
 * Attribute a successful embed call to the deployment's monthly budget.
 * Best-effort: metering failures must never fail the indexing task itself.
 */
function recordEmbeddingUsage(db: FlareMoDb, userId: string, texts: string[]) {
  return Promise.all([
    incrementUsageCounter(
      db,
      { id: userId },
      "embedding_tokens",
      estimateTokenCount(texts),
    ).catch(() => undefined),
    incrementUsageCounter(db, { id: userId }, "embedding_calls", 1).catch(
      () => undefined,
    ),
  ]);
}

async function processEmbeddingTask(
  db: FlareMoDb,
  deps: EmbeddingDispatchDeps,
  task: EmbeddingTaskRow,
  nowIso: string,
) {
  if (task.resourceType === "memo") {
    await processMemoEmbeddingTask(
      db,
      deps.provider,
      deps.memosIndex,
      task,
      nowIso,
    );
  } else {
    await processMemoryEmbeddingTask(
      db,
      deps.provider,
      deps.memoriesIndex,
      task,
      nowIso,
    );
  }
}

async function processMemoEmbeddingTask(
  db: FlareMoDb,
  provider: EmbeddingProvider | null,
  index: VectorIndex | null,
  task: EmbeddingTaskRow,
  nowIso: string,
) {
  const memo = await db
    .select()
    .from(memos)
    .where(and(eq(memos.id, task.resourceId), eq(memos.userId, task.userId)))
    .get();

  // Semantic indexing disabled: leave the resource unindexed and let the task
  // complete so it does not accumulate. FTS5 keyword search is unaffected.
  if (!provider || !index) return;

  const indexing =
    memo !== undefined &&
    (memo.status === "normal" || memo.status === "archived");

  if (!indexing || !memo) {
    await index.deleteByIds(chunkIdsForMemo(task.resourceId));
    if (memo) {
      await clearMemoEmbedding(db, memo);
    }
    return;
  }

  const chunks = chunkText(memo.content);
  if (chunks.length === 0) {
    await db
      .update(memos)
      .set({
        embeddingStatus: "indexed",
        embeddingVersion: embeddingVersion(provider.model, provider.dimensions),
        embeddedAt: nowIso,
        embeddingError: null,
      })
      .where(and(eq(memos.id, memo.id), eq(memos.userId, memo.userId)));
    return;
  }

  const vectors = await provider.embed(chunks);
  await recordEmbeddingUsage(db, task.userId, chunks);
  const ids = chunkVectorIds(memo.id, chunks.length);
  await index.upsert(
    ids.map((id, index_) => ({
      id,
      values: vectors[index_] ?? [],
      metadata: { memo_id: memo.id, user_id: memo.userId },
    })),
  );

  await db
    .update(memos)
    .set({
      embeddingStatus: "indexed",
      embeddingVersion: embeddingVersion(provider.model, provider.dimensions),
      embeddedAt: nowIso,
      embeddingError: null,
    })
    .where(and(eq(memos.id, memo.id), eq(memos.userId, memo.userId)));
}

async function processMemoryEmbeddingTask(
  db: FlareMoDb,
  provider: EmbeddingProvider | null,
  index: VectorIndex | null,
  task: EmbeddingTaskRow,
  nowIso: string,
) {
  const memory = await db
    .select()
    .from(memoryItems)
    .where(
      and(
        eq(memoryItems.id, task.resourceId),
        eq(memoryItems.userId, task.userId),
      ),
    )
    .get();

  if (!provider || !index) return;

  const indexing = memory !== undefined && memory.status === "active";

  if (!indexing || !memory) {
    await index.deleteByIds([memoryIdVector(memory?.id ?? task.resourceId)]);
    if (memory) {
      await clearMemoryEmbedding(db, memory);
    }
    return;
  }

  const vectors = await provider.embed([memory.content]);
  await recordEmbeddingUsage(db, task.userId, [memory.content]);
  await index.upsert([
    {
      id: memoryIdVector(memory.id),
      values: vectors[0] ?? [],
      metadata: { memory_id: memory.id, user_id: memory.userId },
    },
  ]);

  await db
    .update(memoryItems)
    .set({
      embeddingStatus: "indexed",
      embeddingVersion: embeddingVersion(provider.model, provider.dimensions),
      embeddedAt: nowIso,
      embeddingError: null,
    })
    .where(
      and(eq(memoryItems.id, memory.id), eq(memoryItems.userId, memory.userId)),
    );
}

async function clearMemoEmbedding(db: FlareMoDb, memo: MemoRow) {
  await db
    .update(memos)
    .set({
      embeddingStatus: "not_indexed",
      embeddingVersion: null,
      embeddedAt: null,
      embeddingError: null,
    })
    .where(and(eq(memos.id, memo.id), eq(memos.userId, memo.userId)));
}

async function clearMemoryEmbedding(db: FlareMoDb, memory: MemoryItemRow) {
  await db
    .update(memoryItems)
    .set({
      embeddingStatus: "not_indexed",
      embeddingVersion: null,
      embeddedAt: null,
      embeddingError: null,
    })
    .where(
      and(eq(memoryItems.id, memory.id), eq(memoryItems.userId, memory.userId)),
    );
}

async function markResourceEmbeddingError(
  db: FlareMoDb,
  task: EmbeddingTaskRow,
  message: string,
) {
  if (task.resourceType === "memo") {
    await db
      .update(memos)
      .set({ embeddingStatus: "error", embeddingError: message })
      .where(and(eq(memos.id, task.resourceId), eq(memos.userId, task.userId)));
  } else {
    await db
      .update(memoryItems)
      .set({ embeddingStatus: "error", embeddingError: message })
      .where(
        and(
          eq(memoryItems.id, task.resourceId),
          eq(memoryItems.userId, task.userId),
        ),
      );
  }
}

// ---------------------------------------------------------------------------
// Outbox state machine
// ---------------------------------------------------------------------------

async function recoverExpiredEmbeddingLeases(db: FlareMoDb, nowIso: string) {
  await db
    .update(embeddingTasks)
    .set({ status: "pending", leaseUntil: null, updatedAt: nowIso })
    .where(
      and(
        eq(embeddingTasks.status, "running"),
        or(
          isNull(embeddingTasks.leaseUntil),
          lt(embeddingTasks.leaseUntil, nowIso),
        ),
      ),
    );
}

async function listClaimableEmbeddingTasks(db: FlareMoDb, nowIso: string) {
  return db
    .select()
    .from(embeddingTasks)
    .where(
      and(
        eq(embeddingTasks.status, "pending"),
        lte(embeddingTasks.nextAttemptAt, nowIso),
      ),
    )
    .orderBy(asc(embeddingTasks.id))
    .limit(MAX_TASKS_PER_SWEEP);
}

async function claimEmbeddingTask(
  db: FlareMoDb,
  task: EmbeddingTaskRow,
  nowIso: string,
) {
  const leaseUntil = new Date(
    new Date(nowIso).getTime() + TASK_LEASE_MS,
  ).toISOString();
  const claimed = await db
    .update(embeddingTasks)
    .set({
      status: "running",
      attempts: task.attempts + 1,
      leaseUntil,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(embeddingTasks.id, task.id),
        eq(embeddingTasks.status, "pending"),
        lte(embeddingTasks.nextAttemptAt, nowIso),
      ),
    )
    .returning();
  return claimed[0];
}

async function markEmbeddingTaskSucceeded(
  db: FlareMoDb,
  taskId: string,
  nowIso: string,
) {
  await db
    .update(embeddingTasks)
    .set({ status: "succeeded", leaseUntil: null, updatedAt: nowIso })
    .where(eq(embeddingTasks.id, taskId));
}

async function markEmbeddingTaskFailed(
  db: FlareMoDb,
  task: EmbeddingTaskRow,
  now: Date,
  message: string,
) {
  const attempts = task.attempts + 1;
  const dead = attempts >= MAX_ATTEMPTS;
  const backoffMs = Math.min(2 ** attempts * 1_000, 60_000);
  await db
    .update(embeddingTasks)
    .set({
      status: dead ? "dead" : "pending",
      attempts,
      nextAttemptAt: dead
        ? task.nextAttemptAt
        : new Date(now.getTime() + backoffMs).toISOString(),
      leaseUntil: null,
      lastError: message,
      updatedAt: now.toISOString(),
    })
    .where(eq(embeddingTasks.id, task.id));
}

async function pruneEmbeddingOutbox(db: FlareMoDb, before: Date) {
  await db
    .delete(embeddingTasks)
    .where(
      and(
        or(
          eq(embeddingTasks.status, "succeeded"),
          eq(embeddingTasks.status, "dead"),
        ),
        lt(embeddingTasks.updatedAt, before.toISOString()),
      ),
    );
}

/** All possible vector ids for a memo (deleteByIds no-ops missing ids). */
export function chunkIdsForMemo(memoId: string): string[] {
  return Array.from(
    { length: EMBEDDING_MAX_CHUNKS },
    (_, index) => `${memoId}#chunks/${index}`,
  );
}

/** Memories are atomic conclusions (no chunking): vector id = resource id. */
export function memoryIdVector(memoryId: string): string {
  // Memories are atomic conclusions (no chunking), so the vector id is the
  // resource id itself.
  return memoryId;
}

function embeddingFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message)
    return error.message.slice(0, 500);
  return "Embedding task failed.";
}

// ---------------------------------------------------------------------------
// Full rebuild
// ---------------------------------------------------------------------------

const REBUILD_PAGE_SIZE = 200;

export type RebuildEmbeddingDeps = {
  provider: EmbeddingProvider;
  memosIndex: VectorIndex;
  memoriesIndex: VectorIndex;
  onProgress?: (done: number, total: number) => void;
};

/**
 * Rebuild the derived Vectorize indexes from D1. Idempotent and repeatable:
 * the source of truth never changes, and a stale or corrupt Vectorize index
 * can always be reconstructed from D1. Used for first-run backfill, model or
 * dimension changes, and manual recovery after index corruption.
 */
export async function rebuildEmbeddingIndexes(
  db: FlareMoDb,
  deps: RebuildEmbeddingDeps,
) {
  const version = embeddingVersion(
    deps.provider.model,
    deps.provider.dimensions,
  );

  // Memos: index every normal/archived memo, chunked.
  let total = 0;
  let done = 0;
  for await (const page of paginateMemos(db)) {
    total += page.length;
  }
  for await (const page of paginateMemos(db)) {
    for (const memo of page) {
      const chunks = chunkText(memo.content);
      if (chunks.length > 0) {
        const vectors = await deps.provider.embed(chunks);
        // Rebuild is a recovery path and is metered but never blocked: a
        // spent budget pauses background indexing, not index repair.
        await recordEmbeddingUsage(db, memo.userId, chunks);
        const ids = chunkVectorIds(memo.id, chunks.length);
        await deps.memosIndex.upsert(
          ids.map((id, index_) => ({
            id,
            values: vectors[index_] ?? [],
            metadata: { memo_id: memo.id, user_id: memo.userId },
          })),
        );
      }
      await db
        .update(memos)
        .set({
          embeddingStatus: "indexed",
          embeddingVersion: version,
          embeddedAt: new Date().toISOString(),
          embeddingError: null,
        })
        .where(and(eq(memos.id, memo.id), eq(memos.userId, memo.userId)));
      done += 1;
      deps.onProgress?.(done, total);
    }
  }

  // Memories: index every active memory as a single atomic vector.
  const activeMemories = await db
    .select()
    .from(memoryItems)
    .where(eq(memoryItems.status, "active"));
  for (const memory of activeMemories) {
    const vectors = await deps.provider.embed([memory.content]);
    await recordEmbeddingUsage(db, memory.userId, [memory.content]);
    await deps.memoriesIndex.upsert([
      {
        id: memory.id,
        values: vectors[0] ?? [],
        metadata: { memory_id: memory.id, user_id: memory.userId },
      },
    ]);
    await db
      .update(memoryItems)
      .set({
        embeddingStatus: "indexed",
        embeddingVersion: version,
        embeddedAt: new Date().toISOString(),
        embeddingError: null,
      })
      .where(
        and(
          eq(memoryItems.id, memory.id),
          eq(memoryItems.userId, memory.userId),
        ),
      );
  }

  return { memosIndexed: done, memoriesIndexed: activeMemories.length };
}

async function* paginateMemos(db: FlareMoDb) {
  let afterId: string | undefined;
  do {
    const filters = [
      inArray(memos.status, ["normal", "archived"]),
      ...(afterId ? [gt(memos.id, afterId)] : []),
    ];
    const page = await db
      .select()
      .from(memos)
      .where(and(...filters))
      .orderBy(asc(memos.id))
      .limit(REBUILD_PAGE_SIZE);
    if (page.length === 0) return;
    afterId = page[page.length - 1]?.id;
    yield page;
  } while (afterId);
}
