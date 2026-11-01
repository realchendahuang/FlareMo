import type { ImportBundle } from "@flaremo/contracts";
import type { FlareMoDb, UserRow } from "@flaremo/db";
import {
  attachments,
  memoRelations,
  memoryEvents,
  memoryEvidence,
  memoryItems,
  memoryRelations,
  memoryResourceLinks,
  memoryRevisions,
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
    memoryRows,
    memoryRevisionRows,
    memoryRelationRows,
    memoryResourceLinkRows,
    memoryEvidenceRows,
    memoryEventRows,
    projectRows,
    taskRows,
    taskActivityRows,
  ] = await Promise.all([
    db.select().from(memos).where(eq(memos.userId, user.id)),
    db.select().from(attachments).where(eq(attachments.userId, user.id)),
    db.select().from(shares).where(eq(shares.userId, user.id)),
    db.select().from(memoryItems).where(eq(memoryItems.userId, user.id)),
    db
      .select()
      .from(memoryRevisions)
      .where(eq(memoryRevisions.userId, user.id)),
    db
      .select()
      .from(memoryRelations)
      .where(eq(memoryRelations.userId, user.id)),
    db
      .select()
      .from(memoryResourceLinks)
      .where(eq(memoryResourceLinks.userId, user.id)),
    db.select().from(memoryEvidence).where(eq(memoryEvidence.userId, user.id)),
    db.select().from(memoryEvents).where(eq(memoryEvents.userId, user.id)),
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
    version: 6,
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
    memories: memoryRows.map((memory) => ({
      name: memory.id,
      content: memory.content,
      type: memory.type,
      kind: memory.kind,
      scope_type: memory.scopeType,
      scope_key: memory.scopeKey,
      fact_key: memory.factKey ?? null,
      tags: Array.isArray(memory.tags) ? memory.tags : [],
      tier: memory.tier,
      verification: memory.verification,
      status: memory.status,
      importance: memory.importance,
      confidence: memory.confidence,
      needs_review: memory.needsReview,
      review_reason: memory.reviewReason,
      created_by_type: memory.createdByType,
      source_agent: memory.sourceAgent,
      source_session: memory.sourceSession,
      source_ref: memory.sourceRef,
      valid_from: memory.validFrom,
      valid_to: memory.validTo,
      observed_at: memory.observedAt ?? null,
      expires_at: memory.expiresAt ?? null,
      superseded_by_id: memory.supersededById ?? null,
      superseded_at: memory.supersededAt ?? null,
      rejected_at: memory.rejectedAt ?? null,
      created_at: memory.createdAt,
      updated_at: memory.updatedAt,
    })),
    memory_revisions: memoryRevisionRows.map((revision) => ({
      name: revision.id,
      memory_id: revision.memoryId,
      content: revision.content,
      metadata_snapshot: revision.metadataSnapshot,
      created_by_type: revision.createdByType,
      created_by_agent: revision.createdByAgent,
      created_at: revision.createdAt,
    })),
    memory_relations: memoryRelationRows.map((relation) => ({
      memory_id: relation.memoryId,
      related_memory_id: relation.relatedMemoryId,
      type: relation.type,
      created_at: relation.createdAt,
    })),
    memory_resource_links: memoryResourceLinkRows.map((link) => ({
      memory_id: link.memoryId,
      resource_type: link.resourceType,
      resource_ref: link.resourceRef,
      relation_type: link.relationType,
      metadata: link.metadata,
      created_at: link.createdAt,
    })),
    memory_evidence: memoryEvidenceRows.map((evidence) => ({
      memory_id: evidence.memoryId,
      source_type: evidence.sourceType,
      source_id: evidence.sourceId,
      source_revision: evidence.sourceRevision,
      relation_type: evidence.relationType,
      observed_at: evidence.observedAt,
      excerpt: evidence.excerpt,
      excerpt_hash: evidence.excerptHash,
      metadata: evidence.metadata,
      created_at: evidence.createdAt,
    })),
    memory_events: memoryEventRows.map((event) => ({
      memory_id: event.memoryId,
      event_type: event.eventType,
      actor_type: event.actorType,
      actor_name: event.actorName,
      metadata: event.metadata,
      created_at: event.createdAt,
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
