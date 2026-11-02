import type { EmbeddingTaskRow, FlareMoDb } from "@flaremo/db";
import { embeddingTasks, memos } from "@flaremo/db";
import { and, asc, eq, isNull, lt, lte, or } from "drizzle-orm";

export const MAX_ATTEMPTS = 5;
const MAX_TASKS_PER_SWEEP = 32;
const TASK_LEASE_MS = 60_000;
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export async function markResourceEmbeddingError(
  db: FlareMoDb,
  task: EmbeddingTaskRow,
  message: string,
) {
  if (task.resourceType !== "memo") return;
  await db
    .update(memos)
    .set({ embeddingStatus: "error", embeddingError: message })
    .where(and(eq(memos.id, task.resourceId), eq(memos.userId, task.userId)));
}

// ---------------------------------------------------------------------------
// Outbox state machine
// ---------------------------------------------------------------------------

export async function recoverExpiredEmbeddingLeases(
  db: FlareMoDb,
  nowIso: string,
) {
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

export async function listClaimableEmbeddingTasks(
  db: FlareMoDb,
  nowIso: string,
) {
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

export async function claimEmbeddingTask(
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

export async function markEmbeddingTaskSucceeded(
  db: FlareMoDb,
  taskId: string,
  nowIso: string,
) {
  await db
    .update(embeddingTasks)
    .set({ status: "succeeded", leaseUntil: null, updatedAt: nowIso })
    .where(eq(embeddingTasks.id, taskId));
}

export async function markEmbeddingTaskFailed(
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

export async function pruneEmbeddingOutbox(db: FlareMoDb, before: Date) {
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
