import { thumbnailKeyFor } from "@flaremo/contracts/constants";
import { createDb, memosNotifications, tasks } from "@flaremo/db";
import {
  beginFlaremoMemberRemoval,
  claimMemberRemovalJob,
  classifyPushFailure,
  createDailyReviewNotifications,
  createDueTodayTaskNotifications,
  createOverdueTaskNotifications,
  createPushDeliveryStats,
  deleteExpiredDataTasks,
  dispatchEmbeddingOutbox,
  dispatchMemosWebhookOutbox,
  expireStaleDataTasks,
  finalizeAttachmentCleanupForIds,
  finalizeFlaremoMemberRemoval,
  getFlaremoUsersByIds,
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
  mergePushDeliveryStats,
  nextDayKey,
  type PlanLimits,
  type PushKeys,
  type PushPayload,
  parseUserPlanLimits,
  pruneEmptyHourlyCountRows,
  pruneMemosSseEvents,
  purgeArticleRow,
  pushNotificationToUser,
  recalibrateAllHourlyCounts,
  requeueStaleMemberRemovalJobs,
  retryOrFailDataTask,
  retryOrFailMemberRemovalJob,
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
// Same bounded-drain contract for expired articles: 10 passes x up to 200
// rows/day, with per-row isolation so one bad article cannot abort the sweep.
const MAX_ARTICLE_PURGE_BATCHES = 10;

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
      const outcome = await retryOrFailMemberRemovalJob(
        db,
        job.id,
        "scheduled_member_removal_failed",
        error instanceof Error ? error.message : "Member removal failed",
      ).catch(() => null);
      // Requeue transient failures so the Queue platform redelivers. A terminal
      // dead letter is acknowledged; an unrecorded failure is retried because
      // the job may still need recovery.
      if (propagateFailures && outcome !== "dead") throw error;
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
      // A transient Queue/cron attempt returns the row to `queued` until
      // DATA_TASK_MAX_ATTEMPTS; only the final failure becomes terminal. Throw
      // for redelivery only while the helper says the task is retryable.
      const outcome = await retryOrFailDataTask(
        db,
        taskId,
        "export_task_failed",
        error instanceof Error ? error.message : "Export failed",
      ).catch(() => null);
      if (propagateFailures && outcome !== "failed") throw error;
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

type MaintenanceStepResult = {
  step: string;
  ok: boolean;
  ms: number;
  error?: string;
};

/**
 * Run one maintenance pass in isolation. A failing pass (an R2 hiccup, a
 * Workers AI outage, one unreadable row) must never skip the passes after it:
 * attachment GC, counter recalibration, the daily review, overdue reminders and
 * Web Push all share this single daily cron, and a silent skip there is
 * user-visible.
 */
async function runMaintenanceStep(
  step: string,
  results: MaintenanceStepResult[],
  run: () => Promise<void>,
): Promise<void> {
  const startedAt = Date.now();
  try {
    await run();
    results.push({ step, ok: true, ms: Date.now() - startedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({
      step,
      ok: false,
      ms: Date.now() - startedAt,
      error: message,
    });
    console.error(
      JSON.stringify({
        level: "error",
        message: "scheduled maintenance step failed",
        step,
        error: message,
      }),
    );
  }
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
  const steps: MaintenanceStepResult[] = [];
  const counts = {
    memberRemovalJobs: 0,
    exportTasks: 0,
    ssePruned: 0,
    attachmentCleanup: 0,
    trashPurged: 0,
    staleDataTasks: 0,
    expiredDataTasks: 0,
    reviewNotifications: 0,
    overdueNotifications: 0,
    dueTodayNotifications: 0,
    push: createPushDeliveryStats(),
  };
  let expiredDataTaskIds: string[] = [];

  await runMaintenanceStep("member-removal-requeue", steps, async () => {
    await requeueStaleMemberRemovalJobs(db, scheduledTime);
  });
  await runMaintenanceStep("member-removal-jobs", steps, async () => {
    const removalJobs = options.removalJobIds
      ? await getQueuedMemberRemovalJobsByIds(db, options.removalJobIds)
      : await listQueuedMemberRemovalJobs(db);
    counts.memberRemovalJobs = removalJobs.length;
    await runMemberRemovalJobs(
      db,
      env,
      removalJobs,
      Boolean(options.removalJobIds),
    );
  });
  // Queued data-export tasks (DATA_EXPORT_QUEUE messages) run through the same
  // idempotent executor as the in-request path: only `queued` rows are claimed,
  // so a redelivered or doubled message is a no-op.
  await runMaintenanceStep("data-export-tasks", steps, async () => {
    const exportTaskIds = options.exportTaskIds
      ? options.exportTaskIds
      : (await listQueuedDataExportTasks(db)).map((task) => task.id);
    counts.exportTasks = exportTaskIds.length;
    await runExportTasks(
      env,
      db,
      exportTaskIds,
      Boolean(options.exportTaskIds),
    );
  });
  await runMaintenanceStep("webhook-outbox", steps, async () => {
    await dispatchMemosWebhookOutbox(db);
  });
  // SSE replay events have a one-week retention; the bounded chunk keeps the
  // daily sweep from one giant delete.
  await runMaintenanceStep("sse-retention", steps, async () => {
    counts.ssePruned = await pruneMemosSseEvents(
      db,
      new Date(scheduledTime - MEMOS_SSE_RETENTION_MS),
    );
  });
  await runMaintenanceStep("embedding-outbox", steps, async () => {
    await dispatchEmbeddingOutbox(db, {
      provider: createEmbeddingProvider(env),
      memosIndex: createVectorIndex(env),
      limits: options.limits ?? SELF_HOST_UNLIMITED,
      userLimits:
        options.userLimits === undefined
          ? parseUserPlanLimits(env.FLAREMO_USER_LIMITS_JSON)
          : options.userLimits,
      resolveUserLimits: options.resolveUserLimits,
    });
  });
  // Attachment GC. The orphan grace period is 7 days: an upload that rebinds to
  // its memo slower than that is dropped by design. Drain candidates in 100-row
  // batches so a delete storm finishes the same day instead of backing up at
  // one batch per daily cron.
  await runMaintenanceStep("attachment-gc", steps, async () => {
    const orphanCutoff = new Date(
      scheduledTime - 7 * 24 * 60 * 60 * 1_000,
    ).toISOString();
    for (let batch = 0; batch < MAX_ATTACHMENT_CLEANUP_BATCHES; batch++) {
      const candidates = await listAttachmentCleanupCandidates(
        db,
        orphanCutoff,
      );
      if (candidates.length === 0) break;
      // Originals plus their derived previews; a preview key is the original
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
      counts.attachmentCleanup += candidates.length;
      if (candidates.length < ATTACHMENT_CLEANUP_BATCH) break;
    }
  });
  // Expired trash purging: memos sitting in the recycle bin past the retention
  // window are hard-deleted together with their attachments, so storage does not
  // accumulate on trashed-only usage. Projects and tasks ride the same TTL:
  // expired projects cascade-delete their tasks and the tasks activity rows;
  // standalone expired tasks cascade their own trail. 0 disables the sweep.
  await runMaintenanceStep("trash-purge", steps, async () => {
    const retentionDays = parseTrashRetentionDays(
      env.FLAREMO_TRASH_RETENTION_DAYS,
    );
    if (retentionDays <= 0) return;
    const trashCutoff = new Date(
      scheduledTime - retentionDays * 24 * 60 * 60 * 1_000,
    ).toISOString();
    for (let batch = 0; batch < MAX_TRASH_PURGE_BATCHES; batch++) {
      const expired = await listExpiredTrashedMemos(db, trashCutoff);
      if (expired.length === 0) break;
      const owners = await getFlaremoUsersByIds(
        db,
        expired.map(({ userId }) => userId),
      );
      let purgedThisPass = 0;
      for (const { id: memoId, userId } of expired) {
        // One bad row (R2 hiccup, a missing author, a stale permission) must
        // not abort the rest of the maintenance run.
        try {
          const owner = owners.get(userId);
          if (!owner) continue;
          await hardDeleteMemoWithAttachments(env, db, owner, memoId);
          purgedThisPass += 1;
          counts.trashPurged += 1;
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
    // Articles: soft-deleted articles past the retention window hard-delete with
    // their attachment binaries (same R2 sweep contract as memos), using the same
    // bounded batch and per-row isolation.
    for (let batch = 0; batch < MAX_ARTICLE_PURGE_BATCHES; batch++) {
      const expiredArticles = await listExpiredTrashedArticles(db, trashCutoff);
      if (expiredArticles.length === 0) break;
      const owners = await getFlaremoUsersByIds(
        db,
        expiredArticles.map(({ userId }) => userId),
      );
      let purgedThisPass = 0;
      for (const { id: articleId, userId } of expiredArticles) {
        try {
          const owner = owners.get(userId);
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
          purgedThisPass += 1;
          counts.trashPurged += 1;
        } catch (error) {
          console.error(
            JSON.stringify({
              message: "trash purge skipped an article",
              articleId,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }
      if (purgedThisPass === 0) break;
      if (expiredArticles.length < 200) break;
    }
    // Projects first: the FK cascade removes their binned tasks and trails in the
    // same statement, so the task sweep below only ever handles tasks deleted
    // independently of their project.
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
  });
  // Reconcile data-transfer tasks: expire stale queued/running tasks whose lease
  // lapsed (interrupted request), then garbage-collect completed task rows older
  // than the TTL along with their R2 export artifacts.
  await runMaintenanceStep("data-task-reconcile", steps, async () => {
    counts.staleDataTasks = await expireStaleDataTasks(
      db,
      new Date(),
      undefined,
      async (_taskId, keys) => {
        await env.ATTACHMENTS.delete(keys);
      },
    );
    expiredDataTaskIds = await deleteExpiredDataTasks(db);
    counts.expiredDataTasks = expiredDataTaskIds.length;
  });
  await runMaintenanceStep("data-export-artifact-gc", steps, async () => {
    for (const id of expiredDataTaskIds) {
      try {
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
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "export artifact cleanup skipped a task",
            taskId: id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
  });
  // Rebuild the derived memo activity counter. Every memo write adjusts it inside
  // the same batch, so this pass exists only to heal drift: a half-applied import,
  // a counter statement that lost a race, or a row written by an older release
  // before the table existed. It is the authority the incremental path is an
  // optimization for, and it runs last so anything above is already reflected.
  await runMaintenanceStep(
    "activity-counter-recalibration",
    steps,
    async () => {
      await recalibrateAllHourlyCounts(db, new Date().toISOString());
      await pruneEmptyHourlyCountRows(db);
    },
  );
  // Daily review reach-out: file one idempotent inbox row per user when the UTC
  // calendar day has "on this day" history. The source-event unique index absorbs
  // cron retries, so a repeat run for the same date is a no-op.
  const reviewDate = new Date(scheduledTime).toISOString().slice(0, 10);
  await runMaintenanceStep("daily-review-notifications", steps, async () => {
    counts.reviewNotifications = await createDailyReviewNotifications(db, {
      date: reviewDate,
    });
  });
  // Overdue task reminders file once per task per due date; the unique
  // source-event index absorbs cron retries.
  await runMaintenanceStep("overdue-notifications", steps, async () => {
    counts.overdueNotifications = await createOverdueTaskNotifications(db, {
      date: reviewDate,
    });
  });
  // Dated to-dos remind on their day: one row per task due today.
  await runMaintenanceStep("due-today-notifications", steps, async () => {
    counts.dueTodayNotifications = await createDueTodayTaskNotifications(db, {
      date: reviewDate,
    });
  });
  // Fire the Web Push reminders alongside the notification rows. Push stays
  // disabled end-to-end without both VAPID keys; failures never affect the
  // notification rows.
  await runMaintenanceStep("web-push", steps, async () => {
    const pushKeys = pushKeysFromEnv(env);
    if (!pushKeys) return;
    const sendPush = async (userId: string, payload: PushPayload) => {
      const stats = await pushNotificationToUser(
        db,
        pushKeys,
        userId,
        payload,
      ).catch((error) => {
        // Pre-delivery failures (DB read, key parsing) never block the
        // notification rows, but must still be visible and categorized.
        console.error(
          JSON.stringify({
            message: "web push dispatch failed",
            userId,
            failureCategory: classifyPushFailure(error),
          }),
        );
        return null;
      });
      if (stats) mergePushDeliveryStats(counts.push, stats);
    };
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
      await sendPush(receiverId, {
        title: "FlareMo 每日回顾",
        body: "今天有「那年今天」的记录值得回看。",
        url: "/review/daily",
      });
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
      await sendPush(row.userId, {
        title: "FlareMo 任务提醒",
        body: `有 ${row.count} 个任务已经逾期。`,
        url: "/projects",
      });
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
      await sendPush(row.userId, {
        title: "FlareMo 今日待办",
        body: `今天有 ${row.count} 项待办到期。`,
        url: "/projects",
      });
    }
    if (counts.push.failed > 0) {
      console.warn(
        JSON.stringify({
          message: "scheduled web push completed with failures",
          attempted: counts.push.attempted,
          delivered: counts.push.delivered,
          failed: counts.push.failed,
          failureCategories: counts.push.failureCategories,
        }),
      );
    }
  });

  const failedSteps = steps.filter((step) => !step.ok);
  console.log(
    JSON.stringify({
      message: "scheduled maintenance complete",
      scheduledTime,
      ok: failedSteps.length === 0,
      failedSteps: failedSteps.map((step) => step.step),
      counts,
      steps,
    }),
  );
}

function pushKeysFromEnv(env: FlareMoEnv): PushKeys | null {
  const publicKey = env.FLAREMO_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.FLAREMO_VAPID_PRIVATE_KEY?.trim();
  return publicKey && privateKey ? { publicKey, privateKey } : null;
}
