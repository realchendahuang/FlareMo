import type { EmbeddingTaskRow, FlareMoDb } from "@flaremo/db";
import { embeddingTasks } from "@flaremo/db";
import { eq } from "drizzle-orm";
import type { EmbeddingProvider, VectorIndex } from "./embedding";
import { processEmbeddingTask } from "./embedding-processors";
import {
  claimEmbeddingTask,
  listClaimableEmbeddingTasks,
  MAX_ATTEMPTS,
  markEmbeddingTaskFailed,
  markEmbeddingTaskSucceeded,
  markResourceEmbeddingError,
  pruneEmbeddingOutbox,
  RETENTION_MS,
  recoverExpiredEmbeddingLeases,
} from "./embedding-task-store";
import type { PlanLimits, UserPlanLimits } from "./limits";
import { readMonthlyUsageTotal, readUserMonthlyUsage } from "./quotas";

export type EmbeddingResourceType = "memo";
export type EmbeddingTaskOperation =
  | "index"
  | "reindex"
  | "relocate"
  | "delete";

export type EmbeddingDispatchDeps = {
  provider: EmbeddingProvider | null;
  memosIndex: VectorIndex | null;
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
  /**
   * Dynamic per-user budget resolver for shared deployments. When set, each
   * task's budget is resolved from the owning user at dispatch time (e.g. a
   * subscription-backed resolver from a control plane); it wins over
   * `userLimits` / `limits`. Return null for "no per-user budget enforced".
   */
  resolveUserLimits?: (
    userId: string,
  ) => Promise<UserPlanLimits | null> | UserPlanLimits | null;
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
    const scoped = deps.resolveUserLimits
      ? await deps.resolveUserLimits(task.userId)
      : deps.userLimits;
    if (
      !(await embeddingBudgetAvailable(db, deps.limits, scoped, task.userId))
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

function embeddingFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message)
    return error.message.slice(0, 500);
  return "Embedding task failed.";
}

// The vector-id helpers and the full index rebuild live in sibling modules;
// re-exported here so the original public surface of this module is unchanged.
export {
  chunkIdsForMemo,
  EMBEDDING_MAX_CHUNKS,
} from "./embedding-processors";
export {
  type RebuildEmbeddingDeps,
  rebuildEmbeddingIndexes,
} from "./embedding-rebuild";
