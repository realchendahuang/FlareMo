import { thumbnailKeyFor } from "@flaremo/contracts/constants";
import { createDb, memosNotifications, tasks } from "@flaremo/db";
import {
  beginFlaremoMemberRemoval,
  claimMemberRemovalJob,
  createDailyReviewNotifications,
  createDueTodayTaskNotifications,
  createOverdueTaskNotifications,
  deleteExpiredDataTasks,
  dispatchEmbeddingOutbox,
  dispatchMemosWebhookOutbox,
  expireStaleDataTasks,
  failDataTask,
  failMemberRemovalJob,
  finalizeAttachmentCleanupForIds,
  finalizeFlaremoMemberRemoval,
  getFlaremoUserById,
  getQueuedMemberRemovalJobsByIds,
  hardDeleteExpiredProjects,
  hardDeleteExpiredTasks,
  listAttachmentCleanupCandidates,
  listExpiredTrashedArticles,
  listExpiredTrashedMemos,
  listQueuedDataExportTasks,
  listQueuedMemberRemovalJobs,
  MEMOS_SSE_RETENTION_MS,
  markArticleAttachmentsDeleting,
  nextDayKey,
  type PlanLimits,
  type PushKeys,
  parseUserPlanLimits,
  pruneEmptyHourlyCountRows,
  pruneMemosSseEvents,
  purgeArticleRow,
  pushNotificationToUser,
  recalibrateAllHourlyCounts,
  requeueStaleMemberRemovalJobs,
  runMemoryLedgerMaintenance,
  SELF_HOST_UNLIMITED,
  type UserPlanLimits,
  updateMemberRemovalJob,
} from "@flaremo/domain";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { cleanupFlaremoArtifacts } from "./artifact-cleanup";
import { createEmbeddingProvider, createVectorIndex } from "./embedding";
import type { FlareMoEnv } from "./env";
import { runDataExportTask } from "./export-task";
import { hardDeleteMemoWithAttachments } from "./memo-hard-delete";
import { runMemoryConflictPatrol, runMemoryDreaming } from "./memory-dreaming";

/**
 * Cron / queue maintenance surface, moved verbatim from the former inline
 * block in index.ts (the kernel assembly file). Consumed by index.ts's
 * scheduled + queue handlers and by scheduled.test.ts.
 */
/**
 * Daily maintenance run: dispatch webhook + embedding outboxes, clean up
 * orphaned attachments and expired data-transfer tasks, and file "on this
 * day" review notifications. Exported so a shared-instance shell (hosted
 * composition) can drive the exact same sequence without mirroring it.
 */
const ATTACHMENT_CLEANUP_BATCH = 100;
// Safety bound for the drain loop: 100 batches x 100 rows = 10k rows/day.
const MAX_ATTACHMENT_CLEANUP_BATCHES = 100;
const DEFAULT_TRASH_RETENTION_DAYS = 30;
// One purge query returns up to 200 rows; keep draining until the backlog is
// empty or no row in a pass could be removed (a persistent failure).
const MAX_TRASH_PURGE_BATCHES = 10;

function parseTrashRetentionDays(value: string | undefined): number {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_TRASH_RETENTION_DAYS;
  }
  return Math.min(parsed, 365);
}

type QueuedMaintenanceIds = {
  removalJobIds: string[];
  exportTaskIds: string[];
};

/**
 * Execute member-removal jobs selected by either the cron reconciler or a
 * Queue batch. Queue callers must propagate failures so the platform retries;
 * cron callers continue after recording a failed job and remain the recovery
 * path for interrupted work.
 */
async function runMemberRemovalJobs(
  db: ReturnType<typeof createDb>,
  env: FlareMoEnv,
  jobs: Awaited<ReturnType<typeof getQueuedMemberRemovalJobsByIds>>,
  propagateFailures: boolean,
): Promise<void> {
  for (const job of jobs) {
    try {
      if (!(await claimMemberRemovalJob(db, job.id))) continue;
      await updateMemberRemovalJob(db, job.id, {
        attempts: (job.attempts ?? 0) + 1,
      });
      const artifacts = await beginFlaremoMemberRemoval(db, job.memberId);
      await updateMemberRemovalJob(db, job.id, { phase: "cleaning_artifacts" });
      await cleanupFlaremoArtifacts(env, artifacts);
      await finalizeFlaremoMemberRemoval(db, job.memberId, artifacts);
      await updateMemberRemovalJob(db, job.id, {
        status: "completed",
        phase: "completed",
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      await failMemberRemovalJob(
        db,
        job.id,
        "scheduled_member_removal_failed",
        error instanceof Error ? error.message : "Member removal failed",
      ).catch(() => undefined);
      if (propagateFailures) throw error;
    }
  }
}

/** Execute export jobs selected by a Queue batch or the cron reconciler. */
async function runExportTasks(
  env: FlareMoEnv,
  db: ReturnType<typeof createDb>,
  taskIds: string[],
  propagateFailures: boolean,
): Promise<void> {
  for (const taskId of taskIds) {
    try {
      await runDataExportTask(env, db, taskId);
    } catch (error) {
      await failDataTask(
        db,
        taskId,
        "export_task_failed",
        error instanceof Error ? error.message : "Export failed",
      ).catch(() => undefined);
      if (propagateFailures) throw error;
    }
  }
}

/**
 * Queue consumer path. It deliberately executes only the jobs named by the
 * delivered messages. The scheduled handler below remains the bounded
 * reconciler for stale or missed jobs and owns the full maintenance sweep.
 */
export async function runQueuedJobs(
  env: FlareMoEnv,
  ids: QueuedMaintenanceIds,
): Promise<void> {
  const db = createDb(env.DB);
  const removalJobs = await getQueuedMemberRemovalJobsByIds(
    db,
    ids.removalJobIds,
  );
  await runMemberRemovalJobs(db, env, removalJobs, true);
  await runExportTasks(env, db, ids.exportTaskIds, true);
}

export async function runScheduledMaintenance(
  env: FlareMoEnv,
  scheduledTime: number,
  options: {
    limits?: PlanLimits;
    userLimits?: UserPlanLimits | null;
    resolveUserLimits?: (
      userId: string,
    ) => Promise<UserPlanLimits | null> | UserPlanLimits | null;
    removalJobIds?: string[];
    exportTaskIds?: string[];
  } = {},
): Promise<void> {
  const db = createDb(env.DB);
  await requeueStaleMemberRemovalJobs(db, scheduledTime);
  const removalJobs = options.removalJobIds
    ? await getQueuedMemberRemovalJobsByIds(db, options.removalJobIds)
    : await listQueuedMemberRemovalJobs(db);
  await runMemberRemovalJobs(
    db,
    env,
    removalJobs,
    Boolean(options.removalJobIds),
  );
  // Queued data-export tasks (DATA_EXPORT_QUEUE messages) run through the
  // same idempotent executor as the in-request path: only `queued` rows are
  // claimed, so a redelivered or doubled message is a no-op.
  const exportTaskIds = options.exportTaskIds
    ? options.exportTaskIds
    : (await listQueuedDataExportTasks(db)).map((task) => task.id);
  await runExportTasks(env, db, exportTaskIds, Boolean(options.exportTaskIds));
  await dispatchMemosWebhookOutbox(db);
  // Memory-ledger upkeep runs before the embedding outbox so the vector work it
  // queues is drained by the same pass: stale conjectures retire, and rows whose
  // validity window or expiry has passed leave the index instead of being ranked
  // on every recall and filtered out afterwards.
  await runMemoryLedgerMaintenance(db, new Date(scheduledTime));
  // Dreaming (§VI.8) runs after the ledger upkeep and *before* the embedding
  // outbox, so the inferred proposals it isolates — and the vectors it does
  // not index — are consistently accounted for in the same pass. It is an
  // LLM pass, deliberately last of the deterministic sweeps.
  try {
    const dreaming = await runMemoryDreaming(env, new Date(scheduledTime));
    if (dreaming.proposals > 0) {
      console.log(
        JSON.stringify({ message: "memory dreaming proposals", ...dreaming }),
      );
    }
    const patrol = await runMemoryConflictPatrol(env, new Date(scheduledTime));
    if (patrol.proposals > 0) {
      console.log(
        JSON.stringify({
          message: "memory conflict patrol proposals",
          ...patrol,
        }),
      );
    }
  } catch (error) {
    // Dreaming must never take the whole maintenance window down.
    console.error(
      JSON.stringify({
        message: "memory dreaming failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  // SSE replay events have a one-week retention; the bounded chunk keeps the
  // daily sweep from one giant delete.
  const ssePruned = await pruneMemosSseEvents(
    db,
    new Date(scheduledTime - MEMOS_SSE_RETENTION_MS),
  );
  await dispatchEmbeddingOutbox(db, {
    provider: createEmbeddingProvider(env),
    memosIndex: createVectorIndex(env, "memo"),
    memoriesIndex: createVectorIndex(env, "memory"),
    limits: options.limits ?? SELF_HOST_UNLIMITED,
    userLimits:
      options.userLimits === undefined
        ? parseUserPlanLimits(env.FLAREMO_USER_LIMITS_JSON)
        : options.userLimits,
    resolveUserLimits: options.resolveUserLimits,
  });
  // Attachment GC. The orphan grace period is 7 days: an upload that rebinds
  // to its memo slower than that is dropped by design. Drain candidates in
  // 100-row batches so a delete storm finishes the same day instead of
  // backing up at one batch per daily cron.
  const orphanCutoff = new Date(
    scheduledTime - 7 * 24 * 60 * 60 * 1_000,
  ).toISOString();
  let cleanupCount = 0;
  for (let batch = 0; batch < MAX_ATTACHMENT_CLEANUP_BATCHES; batch++) {
    const candidates = await listAttachmentCleanupCandidates(db, orphanCutoff);
    if (candidates.length === 0) break;
    // Originals plus their derived previews; a preview's key is the original
    // with a fixed suffix, so it is not discoverable by a later sweep.
    const objectKeys = candidates.flatMap((attachment) =>
      attachment.payload?.thumbnail === true
        ? [attachment.r2Key, thumbnailKeyFor(attachment.r2Key)]
        : [attachment.r2Key],
    );
    await env.ATTACHMENTS.delete(objectKeys);
    await finalizeAttachmentCleanupForIds(
      db,
      candidates.map((attachment) => attachment.id),
    );
    cleanupCount += candidates.length;
    if (candidates.length < ATTACHMENT_CLEANUP_BATCH) break;
  }
  // Expired trash purging: memos sitting in the recycle bin past the
  // retention window are hard-deleted together with their attachments, so
  // storage does not accumulate on trashed-only usage. Projects and tasks
  // ride the same TTL: expired projects cascade-delete their tasks and the
  // tasks' activity rows; standalone expired tasks cascade their own trail.
  // 0 disables the sweep.
  let trashPurgeCount = 0;
  const retentionDays = parseTrashRetentionDays(
    env.FLAREMO_TRASH_RETENTION_DAYS,
  );
  if (retentionDays > 0) {
    const trashCutoff = new Date(
      scheduledTime - retentionDays * 24 * 60 * 60 * 1_000,
    ).toISOString();
    for (let batch = 0; batch < MAX_TRASH_PURGE_BATCHES; batch++) {
      const expired = await listExpiredTrashedMemos(db, trashCutoff);
      if (expired.length === 0) break;
      let purgedThisPass = 0;
      for (const { id: memoId, userId } of expired) {
        // One bad row (R2 hiccup, a missing author, a stale permission) must
        // not abort the rest of the maintenance run — this loop used to throw
        // before the attachment GC, counters, notifications and reminders.
        try {
          const owner = await getFlaremoUserById(db, userId);
          if (!owner) continue;
          await hardDeleteMemoWithAttachments(env, db, owner, memoId);
          purgedThisPass += 1;
          trashPurgeCount += 1;
        } catch (error) {
          console.error(
            JSON.stringify({
              message: "trash purge skipped a memo",
              memoId,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }
      // The query only returns rows that are still trashed, so a pass that
      // removed nothing would repeat the same failures forever.
      if (purgedThisPass === 0) break;
      if (expired.length < 200) break;
    }
    // Articles: soft-deleted articles past the retention window hard-delete
    // with their attachment binaries (same R2 sweep contract as memos).
    const expiredArticles = await listExpiredTrashedArticles(db, trashCutoff);
    for (const { id: articleId, userId } of expiredArticles) {
      const owner = await getFlaremoUserById(db, userId);
      if (!owner) continue;
      const articleAttachments = await markArticleAttachmentsDeleting(
        db,
        owner,
        articleId,
      );
      const objectKeys = articleAttachments.flatMap((attachment) =>
        attachment.payload?.thumbnail === true
          ? [attachment.r2Key, thumbnailKeyFor(attachment.r2Key)]
          : [attachment.r2Key],
      );
      if (objectKeys.length > 0) {
        await env.ATTACHMENTS.delete(objectKeys);
      }
      await purgeArticleRow(db, articleId);
      trashPurgeCount += 1;
    }
    // Projects first: the FK cascade removes their binned tasks and trails
    // in the same statement, so the task sweep below only ever handles
    // tasks deleted independently of their project.
    const purgedProjects = await hardDeleteExpiredProjects(db, trashCutoff);
    const purgedTasks = await hardDeleteExpiredTasks(db, trashCutoff);
    if (purgedProjects > 0 || purgedTasks > 0) {
      console.log(
        JSON.stringify({
          message: "projects/tasks trash purge complete",
          projects: purgedProjects,
          tasks: purgedTasks,
          scheduledTime,
        }),
      );
    }
  }
  // Reconcile data-transfer tasks: expire stale queued/running tasks whose
  // lease lapsed (interrupted request), then garbage-collect completed task
  // rows older than the TTL along with their R2 export artifacts.
  const staleCount = await expireStaleDataTasks(
    db,
    new Date(),
    undefined,
    async (_taskId, keys) => {
      await env.ATTACHMENTS.delete(keys);
    },
  );
  const expiredIds = await deleteExpiredDataTasks(db);
  for (const id of expiredIds) {
    // Export manifests and import bundles use distinct prefixes; both are
    // task-scoped and safe to drop once the row is gone.
    for (const prefix of [`exports/${id}`, `imports/${id}`]) {
      let cursor: string | undefined;
      do {
        const listing = await env.ATTACHMENTS.list({ prefix, cursor });
        const keys = listing.objects.map((object) => object.key);
        if (keys.length > 0) await env.ATTACHMENTS.delete(keys);
        cursor = listing.truncated ? listing.cursor : undefined;
      } while (cursor);
    }
  }
  // Rebuild the derived memo activity counter. Every memo write adjusts it
  // inside the same batch, so this pass exists only to heal drift: a
  // half-applied import, a counter statement that lost a race, or a row written
  // by an older release before the table existed. It is the authority the
  // incremental path is an optimization for, and it runs last so anything the
  // steps above changed is already reflected in `memos`.
  await recalibrateAllHourlyCounts(db, new Date().toISOString());
  await pruneEmptyHourlyCountRows(db);

  // Daily review reach-out: file one idempotent inbox row per user when the
  // UTC calendar day has "on this day" history. The source-event unique
  // index absorbs cron retries, so a repeat run for the same date is a no-op.
  const reviewDate = new Date(scheduledTime).toISOString().slice(0, 10);
  const reviewNotificationCount = await createDailyReviewNotifications(db, {
    date: reviewDate,
  });
  // Overdue task reminders file once per task per due date; the unique
  // source-event index absorbs cron retries.
  const overdueNotificationCount = await createOverdueTaskNotifications(db, {
    date: reviewDate,
  });
  // Dated to-dos remind on their day: one row per task due today.
  const dueTodayNotificationCount = await createDueTodayTaskNotifications(db, {
    date: reviewDate,
  });
  // Fire the Web Push reminders alongside the notification rows. Push stays
  // disabled end-to-end without both VAPID keys; failures never affect the
  // notification rows.
  const pushKeys = pushKeysFromEnv(env);
  if (pushKeys) {
    const reviewReceivers = await db
      .select({ receiverId: memosNotifications.receiverId })
      .from(memosNotifications)
      .where(
        and(
          eq(memosNotifications.type, "daily_review"),
          eq(memosNotifications.sourceEventId, `daily-review:${reviewDate}`),
        ),
      );
    for (const { receiverId } of reviewReceivers) {
      await pushNotificationToUser(db, pushKeys, receiverId, {
        title: "FlareMo 每日回顾",
        body: "今天有「那年今天」的记录值得回看。",
        url: "/review/daily",
      }).catch(() => undefined);
    }
    // One aggregate push per user with overdue tasks, instead of a push per
    // task row.
    const overdueByUser = await db
      .select({
        userId: tasks.userId,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(tasks)
      .where(
        and(
          isNull(tasks.deletedAt),
          lt(tasks.dueAt, reviewDate),
          inArray(tasks.status, ["todo", "in_progress"]),
        ),
      )
      .groupBy(tasks.userId);
    for (const row of overdueByUser) {
      await pushNotificationToUser(db, pushKeys, row.userId, {
        title: "FlareMo 任务提醒",
        body: `有 ${row.count} 个任务已经逾期。`,
        url: "/projects",
      }).catch(() => undefined);
    }
    // The day a dated to-do falls due, one aggregate push per user.
    const dueTodayByUser = await db
      .select({
        userId: tasks.userId,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(tasks)
      .where(
        and(
          isNull(tasks.deletedAt),
          gte(tasks.dueAt, reviewDate),
          lt(tasks.dueAt, nextDayKey(reviewDate)),
          inArray(tasks.status, ["todo", "in_progress"]),
        ),
      )
      .groupBy(tasks.userId);
    for (const row of dueTodayByUser) {
      await pushNotificationToUser(db, pushKeys, row.userId, {
        title: "FlareMo 今日待办",
        body: `今天有 ${row.count} 项待办到期。`,
        url: "/projects",
      }).catch(() => undefined);
    }
  }
  console.log(
    JSON.stringify({
      message: "attachment cleanup complete",
      count: cleanupCount,
      trashPurgeCount,
      ssePruned,
      staleTaskCount: staleCount,
      expiredTaskCount: expiredIds.length,
      reviewNotificationCount,
      overdueNotificationCount,
      dueTodayNotificationCount,
      scheduledTime,
    }),
  );
}
function pushKeysFromEnv(env: FlareMoEnv): PushKeys | null {
  const publicKey = env.FLAREMO_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.FLAREMO_VAPID_PRIVATE_KEY?.trim();
  return publicKey && privateKey ? { publicKey, privateKey } : null;
}
