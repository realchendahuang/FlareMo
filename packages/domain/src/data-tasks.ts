import type { ImportBundle } from "@flaremo/contracts";
import type {
  DataTaskRow,
  FlareMoDb,
  NewDataTaskRow,
  UserRow,
} from "@flaremo/db";
import {
  attachments,
  dataTasks,
  memoRelations,
  memos,
  shares,
} from "@flaremo/db";
import { and, asc, desc, eq, gt, inArray, lt, ne, or } from "drizzle-orm";
import { chunkForD1, d1IdsPerStatement } from "./d1-limits";
import { NotFoundError } from "./errors";
import {
  finalizeImportTaskAudit,
  importData,
  rollbackImportTask,
} from "./import-export";

export type DataTaskKind = "export" | "import";
export type DataTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "expired";

export const DATA_TASK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const DATA_TASK_LEASE_MS = 60 * 60 * 1000; // 1 hour stale threshold
// Export attempts are counted on failed executions by retryOrFailDataTask;
// claiming a queued row does not increment this counter. Three total attempts
// means failures #1 and #2 requeue, and failure #3 becomes terminal.
export const DATA_TASK_MAX_ATTEMPTS = 3;

export type CreateDataTaskInput = {
  kind: DataTaskKind;
  phase?: string;
  options?: { conflict?: "skip" | "duplicate" | "overwrite" };
};

/**
 * Create a durable data-transfer task row for the user. Export and import
 * tasks are executed in-request with the cron reconciler as a fallback; the
 * row carries the lease and expiry fields that make that safe.
 */
export async function createDataTask(
  db: FlareMoDb,
  user: UserRow,
  input: CreateDataTaskInput,
) {
  const now = new Date();
  const row: NewDataTaskRow = {
    id: crypto.randomUUID(),
    userId: user.id,
    kind: input.kind,
    status: "queued",
    phase: input.phase ?? "created",
    options: input.options,
    attempts: 0,
    progressDone: 0,
    progressTotal: 0,
    leaseUntil: new Date(now.getTime() + DATA_TASK_LEASE_MS).toISOString(),
    expiresAt: new Date(now.getTime() + DATA_TASK_TTL_MS).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await db.insert(dataTasks).values(row);
  return getDataTask(db, user, row.id);
}

/**
 * Read a task row, enforcing user ownership. Throws NotFoundError when the
 * task does not exist or belongs to another user.
 */
export async function getDataTask(db: FlareMoDb, user: UserRow, id: string) {
  const row = await db
    .select()
    .from(dataTasks)
    .where(and(eq(dataTasks.id, id), eq(dataTasks.userId, user.id)))
    .get();
  if (!row) throw new NotFoundError(`Task not found: ${id}`);
  return row;
}

/**
 * Read a task row without the session-ownership check. Queue consumers and
 * the cron reconciler act on task ids rather than on behalf of the session
 * user, so they resolve the owner from the row itself.
 */
export async function getDataTaskById(db: FlareMoDb, id: string) {
  return db.select().from(dataTasks).where(eq(dataTasks.id, id)).get();
}

/**
 * Claim a queued task for execution: flip `queued` to `running` and renew the
 * lease in one conditional update, mirroring claimMemberRemovalJob. Any other
 * status — succeeded, failed, or a lease still held by an in-flight run —
 * returns false, which keeps queue redeliveries and doubled sends as no-ops.
 */
export async function claimQueuedDataTask(db: FlareMoDb, id: string) {
  const now = new Date();
  const result = await db
    .update(dataTasks)
    .set({
      status: "running",
      phase: "scanning",
      leaseUntil: new Date(now.getTime() + DATA_TASK_LEASE_MS).toISOString(),
      updatedAt: now.toISOString(),
    })
    .where(and(eq(dataTasks.id, id), eq(dataTasks.status, "queued")));
  return result.meta?.changes === 1;
}

/**
 * List the user's data-transfer tasks, newest first.
 */
export async function listDataTasks(db: FlareMoDb, user: UserRow, limit = 20) {
  return db
    .select()
    .from(dataTasks)
    .where(
      and(
        eq(dataTasks.userId, user.id),
        // Inline imports use a short-lived task row for their checkpoint; it
        // is not a user-visible transfer job.
        ne(dataTasks.phase, "sync"),
      ),
    )
    .orderBy(desc(dataTasks.createdAt))
    .limit(limit)
    .all();
}

/**
 * Bounded cron fallback for export jobs whose Queue delivery was missed.
 * Imports are never claimed here because their conflict strategy is not safe
 * to replay in the background.
 */
export async function listQueuedDataExportTasks(db: FlareMoDb, limit = 5) {
  return db
    .select()
    .from(dataTasks)
    .where(and(eq(dataTasks.kind, "export"), eq(dataTasks.status, "queued")))
    .orderBy(asc(dataTasks.createdAt))
    .limit(Math.min(Math.max(limit, 1), 5))
    .all();
}

/**
 * Update task progress fields and bump `updated_at`. Returns the refreshed
 * row or undefined when the task no longer exists.
 */
export async function updateDataTask(
  db: FlareMoDb,
  id: string,
  patch: Partial<
    Pick<
      DataTaskRow,
      | "status"
      | "phase"
      | "attempts"
      | "manifestKey"
      | "options"
      | "progressDone"
      | "progressTotal"
      | "errorCode"
      | "errorMessage"
      | "leaseUntil"
      | "completedAt"
    >
  >,
) {
  const now = new Date().toISOString();
  await db
    .update(dataTasks)
    .set({ ...patch, updatedAt: now })
    .where(eq(dataTasks.id, id));
  return db.select().from(dataTasks).where(eq(dataTasks.id, id)).get();
}

/**
 * Mark a task as failed with a stable error code and a short message. The
 * optional attempt count is persisted in the same UPDATE so retry accounting
 * can never lag behind the terminal state.
 */
export async function failDataTask(
  db: FlareMoDb,
  id: string,
  code: string,
  message: string,
  attempts?: number,
) {
  return updateDataTask(db, id, {
    status: "failed",
    errorCode: code,
    errorMessage: message.slice(0, 500),
    completedAt: new Date().toISOString(),
    ...(attempts === undefined ? {} : { attempts }),
  });
}

/**
 * Record one failed data-task execution. Exports get at most
 * DATA_TASK_MAX_ATTEMPTS total attempts; imports never auto-requeue because
 * their conflict strategy is not safe to replay blind. Terminal/already-queued
 * rows are left untouched so duplicate failure notifications or queue
 * redeliveries cannot keep advancing a state machine.
 *
 * Contract for the scheduled/queue callers:
 * - `"queued"`: the row is safe to claim again on the next delivery/sweep.
 * - `"failed"`: no more automatic retry; the error and attempt count are
 *   persisted on the row.
 *
 * `claimQueuedDataTask` intentionally does not increment attempts: this helper
 * increments on failure, so the first, second, and third failed executions
 * persist attempts=1, 2, and 3 respectively.
 */
export async function retryOrFailDataTask(
  db: FlareMoDb,
  id: string,
  code: string,
  message: string,
): Promise<"queued" | "failed"> {
  const task = await getDataTaskById(db, id);
  if (!task) throw new NotFoundError(`Task not found: ${id}`);

  // Make repeated calls idempotent rather than consuming another attempt.
  if (task.status === "queued") return "queued";
  if (task.status !== "running") return "failed";

  const attempts = task.attempts + 1;
  if (task.kind === "export" && attempts < DATA_TASK_MAX_ATTEMPTS) {
    await updateDataTask(db, id, {
      status: "queued",
      phase: "retrying",
      attempts,
      errorCode: code,
      errorMessage: message.slice(0, 500),
      completedAt: null,
      leaseUntil: null,
    });
    return "queued";
  }

  await failDataTask(db, id, code, message, attempts);
  return "failed";
}

/**
 * Reconcile stale `queued`/`running` tasks whose lease expired.
 *
 * - stale running export: count one failed attempt and requeue until
 *   DATA_TASK_MAX_ATTEMPTS, then fail;
 * - stale queued export: a backlog item that never got claimed — keep it
 *   queued and only release the stale lease;
 * - import: always roll back the checkpoint ledger and fail (the duplicate
 *   conflict strategy is not safe to replay blind).
 */
export async function expireStaleDataTasks(
  db: FlareMoDb,
  now = new Date(),
  taskId: string | undefined = undefined,
  onImportRollback?: (taskId: string, r2Keys: string[]) => Promise<void>,
) {
  const nowIso = now.toISOString();
  const stale = await db
    .select({
      id: dataTasks.id,
      kind: dataTasks.kind,
      status: dataTasks.status,
    })
    .from(dataTasks)
    .where(
      and(
        inArray(dataTasks.status, ["queued", "running"]),
        lt(dataTasks.leaseUntil, nowIso),
        taskId ? eq(dataTasks.id, taskId) : undefined,
      ),
    )
    .all();
  if (stale.length === 0) return 0;

  const importRows = stale.filter((row) => row.kind === "import");
  // An interrupted import leaves a partial ledger. Roll it back before the
  // task is marked failed so its rows never become visible as a half-restore.
  for (const row of importRows) {
    try {
      const rolledBack = await rollbackImportTask(db, row.id);
      if (rolledBack.r2Keys.length > 0) {
        await onImportRollback?.(row.id, rolledBack.r2Keys);
      }
    } catch (error) {
      // One stuck rollback must not stop the reconciler from marking the
      // remaining tasks failed.
      console.error(
        JSON.stringify({
          message: "stale import rollback failed",
          taskId: row.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  const importIds = importRows.map((row) => row.id);
  // One bound parameter per id; chunk so a long-stalled queue still drains.
  for (const idChunk of chunkForD1(importIds, d1IdsPerStatement())) {
    await db
      .update(dataTasks)
      .set({
        status: "failed",
        errorCode: "task_expired",
        errorMessage:
          "Task lease expired before completion; the request was interrupted.",
        completedAt: nowIso,
        leaseUntil: null,
        updatedAt: nowIso,
      })
      .where(inArray(dataTasks.id, idChunk));
  }

  // A running export is a real interrupted attempt. Reuse the same state
  // machine as queue/request failures so the attempt cap cannot drift.
  for (const row of stale) {
    if (row.kind !== "export" || row.status !== "running") continue;
    await retryOrFailDataTask(
      db,
      row.id,
      "task_expired",
      "Task lease expired before completion; the request was interrupted.",
    );
  }

  // A queued export may simply have waited behind a long backlog. It never
  // consumed an attempt; release the expired scheduling lease so the next cron
  // sweep can claim it without changing its attempt count.
  const queuedExportIds = stale
    .filter((row) => row.kind === "export" && row.status === "queued")
    .map((row) => row.id);
  for (const idChunk of chunkForD1(queuedExportIds, d1IdsPerStatement())) {
    await db
      .update(dataTasks)
      .set({ leaseUntil: null, updatedAt: nowIso })
      .where(
        and(inArray(dataTasks.id, idChunk), eq(dataTasks.status, "queued")),
      );
  }

  return stale.length;
}

/**
 * Delete expired task rows and their cleanup hook. `expires_at` is the
 * durable TTL boundary and already has `data_tasks_expires_idx`; deriving a
 * cutoff from `created_at` forced the daily sweep into a full table scan even
 * though createDataTask writes the equivalent createdAt + TTL value.
 * R2 artifacts are cleaned by the caller (the worker has the bucket handle).
 * Returns the ids of removed rows.
 */
export async function deleteExpiredDataTasks(
  db: FlareMoDb,
  now = new Date(),
  taskId: string | undefined = undefined,
) {
  const expired = await db
    .select({ id: dataTasks.id })
    .from(dataTasks)
    .where(
      and(
        lt(dataTasks.expiresAt, now.toISOString()),
        taskId ? eq(dataTasks.id, taskId) : undefined,
      ),
    )
    .all();
  if (expired.length === 0) return [];
  const ids = expired.map((row) => row.id);
  for (const idChunk of chunkForD1(ids, d1IdsPerStatement())) {
    await db.delete(dataTasks).where(inArray(dataTasks.id, idChunk));
  }
  return ids;
}

export type ExportChunk = {
  kind: "memos" | "attachments" | "relations" | "shares" | "settings";
  /** The rendered JSON record batch as a string (one NDJSON record per line). */
  records: string;
};

/**
 * Stream the user's data as NDJSON batches without building the whole bundle
 * in memory. The callback receives one batch per entity page and returns the
 * number of records emitted so the task can track progress.
 */
export async function streamExportData(
  db: FlareMoDb,
  user: UserRow,
  onChunk: (chunk: ExportChunk) => Promise<void> | void,
) {
  const pageSize = 500;

  // Memos are the largest collection and the anchor for relations.
  let memoCursor: { createdAt: string; id: string } | undefined;
  let memoCount = 0;
  const allMemoIds = new Set<string>();
  while (true) {
    const cursorWhere = memoCursor
      ? or(
          gt(memos.createdAt, memoCursor.createdAt),
          and(
            eq(memos.createdAt, memoCursor.createdAt),
            gt(memos.id, memoCursor.id),
          ),
        )
      : undefined;
    const page = await db
      .select()
      .from(memos)
      .where(
        cursorWhere
          ? and(eq(memos.userId, user.id), cursorWhere)
          : eq(memos.userId, user.id),
      )
      .orderBy(asc(memos.createdAt), asc(memos.id))
      .limit(pageSize)
      .all();
    if (page.length === 0) break;
    const records = page.map((memo) =>
      JSON.stringify({
        name: memo.id,
        content: memo.content,
        visibility: memo.visibility,
        state: memo.status,
        pinned: memo.pinned,
        payload: memo.payload ?? {},
        source: memo.source,
        create_time: memo.createdAt,
        update_time: memo.updatedAt,
        display_time: memo.createdAt,
      }),
    );
    for (const memo of page) allMemoIds.add(memo.id);
    memoCount += page.length;
    await onChunk({ kind: "memos", records: records.join("\n") });
    const lastMemo = page.at(-1);
    if (!lastMemo) break;
    memoCursor = { createdAt: lastMemo.createdAt, id: lastMemo.id };
  }

  // Attachments metadata (no binaries in the manifest; the worker exposes a
  // task-scoped download endpoint for the bodies).
  const attachmentRows = await db
    .select()
    .from(attachments)
    .where(eq(attachments.userId, user.id))
    .all();
  const liveAttachments = attachmentRows.filter((row) => !row.deletedAt);
  await onChunk({
    kind: "attachments",
    records: liveAttachments
      .map((attachment) =>
        JSON.stringify({
          name: attachment.id,
          id: attachment.id.replace(/^attachments\//, ""),
          memo: attachment.memoId,
          filename: attachment.filename,
          content_type: attachment.contentType,
          size: attachment.size,
          state: attachment.state,
          etag: attachment.etag,
          payload: attachment.payload ?? {},
          create_time: attachment.createdAt,
          update_time: attachment.updatedAt,
        }),
      )
      .join("\n"),
  });

  // Relations restricted to memos owned by the user.
  const relationRecords: string[] = [];
  const memoIdList = Array.from(allMemoIds);
  // `pageSize` (500) is the export page, not a safe binding count: an
  // `inArray` of 500 ids is five times D1's 100-parameter ceiling.
  for (const memoIdChunk of chunkForD1(memoIdList, d1IdsPerStatement())) {
    const relationRows = await db
      .select()
      .from(memoRelations)
      .where(inArray(memoRelations.memoId, memoIdChunk))
      .all();
    for (const relation of relationRows) {
      if (allMemoIds.has(relation.relatedMemoId)) {
        relationRecords.push(
          JSON.stringify({
            memo: relation.memoId,
            related_memo: relation.relatedMemoId,
            type: relation.type,
            create_time: relation.createdAt,
          }),
        );
      }
    }
  }
  await onChunk({
    kind: "relations",
    records: relationRecords.join("\n"),
  });

  const shareRows = await db
    .select()
    .from(shares)
    .where(eq(shares.userId, user.id))
    .all();
  await onChunk({
    kind: "shares",
    records: shareRows
      .map((share) =>
        JSON.stringify({
          name: share.id,
          id: share.id.replace(/^shares\//, ""),
          memo: share.memoId,
          token: share.token,
          expires_at: share.expiresAt,
          create_time: share.createdAt,
          update_time: share.updatedAt,
          revoked_at: share.revokedAt,
        }),
      )
      .join("\n"),
  });

  return {
    memoCount,
    attachmentCount: liveAttachments.length,
    relationCount: relationRecords.length,
  };
}

/**
 * Run an import task in-request, reusing the synchronous import service and
 * updating progress around it. Returns the import result summary.
 */
export async function runImportTask(
  db: FlareMoDb,
  user: UserRow,
  taskId: string,
  bundle: ImportBundle,
  options: {
    attachmentR2Keys?: Map<string, string>;
    attachmentEtags?: Map<string, string | null>;
    conflict?: "skip" | "duplicate" | "overwrite";
    /** Drops binaries from a previous interrupted attempt during recovery. */
    onRecoveredR2Keys?: (keys: string[]) => Promise<void>;
  } = {},
) {
  // A resumed task never starts on top of a previous partial attempt: the
  // ledger from that attempt is rolled back first (no-op when it is empty).
  const stale = await rollbackImportTask(db, taskId);
  if (stale.r2Keys.length > 0) await options.onRecoveredR2Keys?.(stale.r2Keys);
  const task = await getDataTask(db, user, taskId);
  await updateDataTask(db, taskId, {
    status: "running",
    phase: "importing",
    attempts: task.attempts + 1,
    errorCode: null,
    errorMessage: null,
    completedAt: null,
    progressTotal: bundle.memos.length,
    progressDone: 0,
  });
  try {
    const result = await importData(db, user, bundle, {
      ...options,
      auditTaskId: taskId,
    });
    await finalizeImportTaskAudit(db, taskId, user.id);
    await updateDataTask(db, taskId, {
      status: "succeeded",
      phase: "completed",
      progressDone: bundle.memos.length,
      progressTotal: bundle.memos.length,
      completedAt: new Date().toISOString(),
    });
    return result;
  } catch (error) {
    const rolledBack = await rollbackImportTask(db, taskId);
    if (rolledBack.r2Keys.length > 0) {
      await options.onRecoveredR2Keys?.(rolledBack.r2Keys);
    }
    throw error;
  }
}

/**
 * Run a small synchronous import with the same rollback guarantee as a task:
 * the task row exists only for the duration of the request and is removed on
 * both paths. The callback lets the Worker drop attachment binaries that the
 * rollback released.
 */
export async function runImportTransactionally(
  db: FlareMoDb,
  user: UserRow,
  bundle: ImportBundle,
  options: {
    attachmentR2Keys?: Map<string, string>;
    attachmentEtags?: Map<string, string | null>;
    conflict?: "skip" | "duplicate" | "overwrite";
    onRollbackR2Keys?: (keys: string[]) => Promise<void>;
  } = {},
) {
  // Overwrite mutates existing rows and has no ledger-based rollback. Keep the
  // legacy behavior for that explicit mode; skip/duplicate are atomic.
  if (options.conflict === "overwrite") {
    return importData(db, user, bundle, options);
  }
  const task = await createDataTask(db, user, {
    kind: "import",
    phase: "sync",
  });
  try {
    const result = await importData(db, user, bundle, {
      ...options,
      auditTaskId: task.id,
    });
    await finalizeImportTaskAudit(db, task.id, user.id);
    await db.delete(dataTasks).where(eq(dataTasks.id, task.id));
    return result;
  } catch (error) {
    const rolledBack = await rollbackImportTask(db, task.id);
    if (rolledBack.r2Keys.length > 0) {
      await options.onRollbackR2Keys?.(rolledBack.r2Keys);
    }
    await db.delete(dataTasks).where(eq(dataTasks.id, task.id));
    throw error;
  }
}

// Re-export the import result type for the route layer.
export type ImportResultSummary = Awaited<ReturnType<typeof importData>>;

/**
 * Project a task row to the public DTO shape (no lease/internal fields).
 */
export function dataTaskToDto(row: DataTaskRow) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    phase: row.phase,
    progress_done: row.progressDone,
    progress_total: row.progressTotal,
    error_code: row.errorCode,
    error_message: row.errorMessage,
    expires_at: row.expiresAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    completed_at: row.completedAt,
  };
}
