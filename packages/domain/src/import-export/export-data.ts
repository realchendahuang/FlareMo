import type { ImportBundle } from "@flaremo/contracts";
import type { FlareMoDb, UserRow } from "@flaremo/db";
import {
  attachments,
  memoRelations,
  memos,
  projects,
  shares,
  taskActivity,
  tasks,
} from "@flaremo/db";
import { asc, eq, inArray } from "drizzle-orm";
import { chunkForD1, d1IdsPerStatement } from "../d1-limits";

/**
 * The export half of import-export.ts, moved verbatim: dumps every
 * user-owned table (including recycle-bin rows) into a versioned
 * ImportBundle.
 */
export async function exportData(
  db: FlareMoDb,
  user: UserRow,
): Promise<ImportBundle> {
  const [
    memoRows,
    attachmentRows,
    shareRows,
    projectRows,
    taskRows,
    taskActivityRows,
  ] = await Promise.all([
    db.select().from(memos).where(eq(memos.userId, user.id)),
    db.select().from(attachments).where(eq(attachments.userId, user.id)),
    db.select().from(shares).where(eq(shares.userId, user.id)),
    db.select().from(projects).where(eq(projects.userId, user.id)),
    db.select().from(tasks).where(eq(tasks.userId, user.id)),
    db
      .select()
      .from(taskActivity)
      .where(eq(taskActivity.userId, user.id))
      .orderBy(asc(taskActivity.id)),
  ]);

  const memoIds = new Set(memoRows.map((memo) => memo.id));
  const relationRows: Array<typeof memoRelations.$inferSelect> = [];
  // One binding per id: D1 rejects the whole statement past 100, and the old
  // 500-row pages failed outright on any account with more than 100 memos.
  for (const memoIdChunk of chunkForD1(
    Array.from(memoIds),
    d1IdsPerStatement(),
  )) {
    relationRows.push(
      ...(await db
        .select()
        .from(memoRelations)
        .where(inArray(memoRelations.memoId, memoIdChunk))
        .all()),
    );
  }
  return {
    version: 7,
    exported_at: new Date().toISOString(),
    memos: memoRows.map((memo) => ({
      name: memo.id,
      content: memo.content,
      visibility: memo.visibility,
      state: memo.status,
      pinned: memo.pinned,
      payload: memo.payload ?? {},
      source: memo.source,
      team_id: memo.teamId,
      create_time: memo.createdAt,
      update_time: memo.updatedAt,
      display_time: memo.createdAt,
    })),
    attachments: attachmentRows
      .filter((attachment) => !attachment.deletedAt)
      .map((attachment) => ({
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
      })),
    relations: relationRows
      .filter(
        (relation) =>
          memoIds.has(relation.memoId) && memoIds.has(relation.relatedMemoId),
      )
      .map((relation) => ({
        memo: relation.memoId,
        related_memo: relation.relatedMemoId,
        type: relation.type,
        create_time: relation.createdAt,
      })),
    shares: shareRows.map((share) => ({
      name: share.id,
      id: share.id.replace(/^shares\//, ""),
      memo: share.memoId,
      // The token is a capability URL: never write a working one into an
      // export file. Import mints a fresh token for every restored share.
      expires_at: share.expiresAt,
      create_time: share.createdAt,
      update_time: share.updatedAt,
      revoked_at: share.revokedAt,
    })),
    // Recycle-bin rows travel too: a backup that quietly drops soft-deleted
    // data is a lossy backup. `deleted_at` rides along so an import into a
    // fresh account reproduces the bin state.
    projects: projectRows.map((project) => ({
      name: project.id,
      title: project.name,
      description: project.description,
      status: project.status,
      deleted_at: project.deletedAt,
      created_at: project.createdAt,
      updated_at: project.updatedAt,
    })),
    tasks: taskRows.map((task) => ({
      name: task.id,
      project_id: task.projectId,
      source_memo_id: task.sourceMemoId,
      title: task.title,
      notes: task.notes,
      status: task.status,
      priority: task.priority,
      due_at: task.dueAt,
      sort_order: task.sortOrder,
      completed_at: task.completedAt,
      deleted_at: task.deletedAt,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
    })),
    task_activity: taskActivityRows.map((activity) => ({
      task_id: activity.taskId,
      actor_type: activity.actorType,
      actor_name: activity.actorName,
      action: activity.action,
      changes: activity.changes,
      created_at: activity.createdAt,
    })),
  };
}
