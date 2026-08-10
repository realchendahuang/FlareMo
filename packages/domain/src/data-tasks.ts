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
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { NotFoundError } from "./errors";
import { importData } from "./import-export";

export type DataTaskKind = "export" | "import";
export type DataTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "expired";

export const DATA_TASK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const DATA_TASK_LEASE_MS = 60 * 60 * 1000; // 1 hour stale threshold

export type CreateDataTaskInput = {
  kind: DataTaskKind;
  phase?: string;
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
 * List the user's data-transfer tasks, newest first.
 */
export async function listDataTasks(db: FlareMoDb, user: UserRow, limit = 20) {
  return db
    .select()
    .from(dataTasks)
    .where(eq(dataTasks.userId, user.id))
    .orderBy(desc(dataTasks.createdAt))
    .limit(limit)
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
 * Mark a task as failed with a stable error code and a short message.
 */
export async function failDataTask(
  db: FlareMoDb,
  id: string,
  code: string,
  message: string,
) {
  return updateDataTask(db, id, {
    status: "failed",
    errorCode: code,
    errorMessage: message.slice(0, 500),
    completedAt: new Date().toISOString(),
  });
}

/**
 * Cron reconciler: claim stale `queued`/`running` tasks whose lease has
 * expired. In-request execution should normally complete the task before the
 * lease elapses; a stale task means the request was interrupted, so it is
 * marked failed rather than retried blindly (imports are not idempotent for
 * the duplicate conflict strategy).
 */
export async function expireStaleDataTasks(
  db: FlareMoDb,
  now = new Date(),
  taskId: string | undefined = undefined,
) {
  const stale = await db
    .select({ id: dataTasks.id })
    .from(dataTasks)
    .where(
      and(
        inArray(dataTasks.status, ["queued", "running"]),
        lt(dataTasks.leaseUntil, now.toISOString()),
        taskId ? eq(dataTasks.id, taskId) : undefined,
      ),
    )
    .all();
  if (stale.length === 0) return 0;
  await db
    .update(dataTasks)
    .set({
      status: "failed",
      errorCode: "task_expired",
      errorMessage:
        "Task lease expired before completion; the request was interrupted.",
      completedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    .where(
      inArray(
        dataTasks.id,
        stale.map((row) => row.id),
      ),
    );
  return stale.length;
}

/**
 * Delete expired task rows and their cleanup hook: rows older than the TTL
 * are removed. R2 artifacts are cleaned by the caller (the worker has the
 * bucket handle). Returns the number of removed rows.
 */
export async function deleteExpiredDataTasks(
  db: FlareMoDb,
  now = new Date(),
  taskId: string | undefined = undefined,
) {
  const cutoff = new Date(now.getTime() - DATA_TASK_TTL_MS).toISOString();
  const expired = await db
    .select({ id: dataTasks.id })
    .from(dataTasks)
    .where(
      and(
        lt(dataTasks.createdAt, cutoff),
        taskId ? eq(dataTasks.id, taskId) : undefined,
      ),
    )
    .all();
  if (expired.length === 0) return [];
  const ids = expired.map((row) => row.id);
  await db.delete(dataTasks).where(inArray(dataTasks.id, ids));
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
  let memoCursor = 0;
  let memoCount = 0;
  const allMemoIds = new Set<string>();
  while (true) {
    const page = await db
      .select()
      .from(memos)
      .where(eq(memos.userId, user.id))
      .orderBy(asc(memos.createdAt), asc(memos.id))
      .limit(pageSize)
      .offset(memoCursor)
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
    memoCursor += page.length;
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
  const relationRows = await db.select().from(memoRelations).all();
  const relationRecords: string[] = [];
  for (const relation of relationRows) {
    if (
      allMemoIds.has(relation.memoId) &&
      allMemoIds.has(relation.relatedMemoId)
    ) {
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
  } = {},
) {
  await updateDataTask(db, taskId, {
    status: "running",
    phase: "importing",
    progressTotal: bundle.memos.length,
    progressDone: 0,
  });
  const result = await importData(db, user, bundle, options);
  await updateDataTask(db, taskId, {
    status: "succeeded",
    phase: "completed",
    progressDone: bundle.memos.length,
    progressTotal: bundle.memos.length,
    completedAt: new Date().toISOString(),
  });
  return result;
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
