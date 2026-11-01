import type { FlareMoDb } from "@flaremo/db";
import {
  attachments,
  dataTasks,
  importTaskRows,
  memoryItems,
  memos,
  projects,
  shares,
  taskActivity,
  tasks,
} from "@flaremo/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { chunkForD1, d1IdsPerStatement } from "../d1-limits";

export type ImportAuditTable =
  | "memos"
  | "attachments"
  | "shares"
  | "memory_items"
  | "projects"
  | "tasks";

/**
 * One checkpoint row per top-level record an import inserted. Batched with
 * the insert itself so the ledger can never claim a row that did not commit.
 */
export function importAuditStatement(
  db: FlareMoDb,
  taskId: string,
  tableName: ImportAuditTable,
  rowId: string,
) {
  return db
    .insert(importTaskRows)
    .values({ taskId, tableName, rowId })
    .onConflictDoNothing();
}

export async function clearImportTaskAudit(db: FlareMoDb, taskId: string) {
  await db.delete(importTaskRows).where(eq(importTaskRows.taskId, taskId));
}

/**
 * Success path: drop the rollback marker from imported task activity, then
 * clear the ledger. Activity rows keep only their original `changes` payload.
 */
export async function finalizeImportTaskAudit(
  db: FlareMoDb,
  taskId: string,
  userId: string,
) {
  await db
    .update(taskActivity)
    .set({
      changes: sql`json_remove(${taskActivity.changes}, '$.__import_task_id')`,
    })
    .where(
      and(
        eq(taskActivity.userId, userId),
        sql`json_extract(${taskActivity.changes}, '$.__import_task_id') = ${taskId}`,
      ),
    );
  await clearImportTaskAudit(db, taskId);
}

type AuditBuckets = Record<ImportAuditTable, string[]>;

function emptyBuckets(): AuditBuckets {
  return {
    memos: [],
    attachments: [],
    shares: [],
    memory_items: [],
    projects: [],
    tasks: [],
  };
}

/**
 * Undo every top-level row the task inserted, newest dependency first. Child
 * rows (memo tags/relations, memory revisions/evidence/events, task activity)
 * cascade from their audited parent; attachments are listed explicitly because
 * deleting a memo only sets `memo_id` to NULL.
 *
 * Returns the R2 keys that belonged to deleted attachment rows so the caller
 * can drop the binaries. Missing-binary placeholder keys are filtered out.
 */
export async function rollbackImportTask(
  db: FlareMoDb,
  taskId: string,
): Promise<{ r2Keys: string[]; deleted: number }> {
  const ledger = await db
    .select({
      tableName: importTaskRows.tableName,
      rowId: importTaskRows.rowId,
    })
    .from(importTaskRows)
    .where(eq(importTaskRows.taskId, taskId))
    .all();
  const buckets = emptyBuckets();
  for (const row of ledger) buckets[row.tableName].push(row.rowId);
  const deleted = ledger.length;
  if (deleted === 0) return { r2Keys: [], deleted: 0 };

  const task = await db
    .select({ userId: dataTasks.userId })
    .from(dataTasks)
    .where(eq(dataTasks.id, taskId))
    .get();

  // Project-scoped activity has no task FK to cascade through; the import
  // marks those rows in `changes` so this sweep can find them.
  if (task) {
    await db
      .delete(taskActivity)
      .where(
        and(
          eq(taskActivity.userId, task.userId),
          sql`json_extract(${taskActivity.changes}, '$.__import_task_id') = ${taskId}`,
        ),
      );
  }

  const r2Keys: string[] = [];
  for (const chunk of chunkForD1(buckets.attachments, d1IdsPerStatement())) {
    const rows = await db
      .select({ r2Key: attachments.r2Key })
      .from(attachments)
      .where(inArray(attachments.id, chunk))
      .all();
    for (const row of rows) {
      if (!row.r2Key.includes("/missing/")) r2Keys.push(row.r2Key);
    }
    await db.delete(attachments).where(inArray(attachments.id, chunk));
  }

  for (const chunk of chunkForD1(buckets.tasks, d1IdsPerStatement())) {
    await db.delete(tasks).where(inArray(tasks.id, chunk));
  }
  for (const chunk of chunkForD1(buckets.projects, d1IdsPerStatement())) {
    await db.delete(projects).where(inArray(projects.id, chunk));
  }
  for (const chunk of chunkForD1(buckets.shares, d1IdsPerStatement())) {
    await db.delete(shares).where(inArray(shares.id, chunk));
  }
  for (const chunk of chunkForD1(buckets.memos, d1IdsPerStatement())) {
    await db.delete(memos).where(inArray(memos.id, chunk));
  }
  for (const chunk of chunkForD1(buckets.memory_items, d1IdsPerStatement())) {
    await db.delete(memoryItems).where(inArray(memoryItems.id, chunk));
  }

  await clearImportTaskAudit(db, taskId);
  return { r2Keys, deleted };
}
