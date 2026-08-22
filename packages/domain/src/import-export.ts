import type { ImportBundle, ImportOptions } from "@flaremo/contracts";
import type { FlareMoDb, UserRow } from "@flaremo/db";
import {
  attachments,
  memoRelations,
  memoryItems,
  memoryRelations,
  memoryResourceLinks,
  memoryRevisions,
  memos,
  memoTags,
  shares,
} from "@flaremo/db";
import { and, eq } from "drizzle-orm";
import { createResourceId, createToken, parseResourceName } from "./ids";
import {
  normalizeMemoClientId,
  normalizeMemoPayload,
  updateMemo,
} from "./memos";
import { extractTags, normalizeMemoTags } from "./tags";

export async function exportData(
  db: FlareMoDb,
  user: UserRow,
): Promise<ImportBundle> {
  const [
    memoRows,
    attachmentRows,
    relationRows,
    shareRows,
    memoryRows,
    memoryRevisionRows,
    memoryRelationRows,
    memoryResourceLinkRows,
  ] = await Promise.all([
    db.select().from(memos).where(eq(memos.userId, user.id)),
    db.select().from(attachments).where(eq(attachments.userId, user.id)),
    db.select().from(memoRelations),
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
  ]);

  const memoIds = new Set(memoRows.map((memo) => memo.id));
  return {
    version: 3,
    exported_at: new Date().toISOString(),
    memos: memoRows.map((memo) => ({
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
      token: share.token,
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
  };
}

export async function importData(
  db: FlareMoDb,
  user: UserRow,
  bundle: ImportBundle,
  options: {
    attachmentR2Keys?: Map<string, string>;
    attachmentEtags?: Map<string, string | null>;
    conflict?: ImportOptions["conflict"];
  } = {},
) {
  const now = new Date().toISOString();
  const conflict = options.conflict ?? "duplicate";
  const memoIdMap = new Map<string, string>();
  let importedMemos = 0;
  let skippedMemos = 0;
  let overwrittenMemos = 0;
  let importedAttachments = 0;
  let importedRelations = 0;
  let importedShares = 0;
  const cleanupR2Keys: string[] = [];

  for (const memo of bundle.memos) {
    const sourceId = parseResourceName(memo.name, "memos");
    const payload = normalizeMemoPayload(memo.payload);
    const requestedClientId = normalizeMemoClientId(payload.client_id);
    if (requestedClientId) payload.client_id = requestedClientId;

    const existingById = await db
      .select({ id: memos.id })
      .from(memos)
      .where(and(eq(memos.id, sourceId), eq(memos.userId, user.id)))
      .get();
    const existingByClientId = requestedClientId
      ? await db
          .select({ id: memos.id })
          .from(memos)
          .where(
            and(
              eq(memos.userId, user.id),
              eq(memos.clientId, requestedClientId),
            ),
          )
          .get()
      : undefined;
    const existing = existingById ?? existingByClientId;

    if (existing && conflict === "skip") {
      memoIdMap.set(memo.name, existing.id);
      skippedMemos += 1;
      continue;
    }

    if (existing && conflict === "overwrite") {
      // `client_id` is a stable creation id, not imported memo content. The
      // target row keeps its canonical value (or gains it only on insert).
      delete payload.client_id;
      await updateMemo(db, user, existing.id, {
        content: memo.content,
        visibility: memo.visibility,
        status: memo.state,
        pinned: memo.pinned,
        payload,
      });
      await db
        .update(memos)
        .set({
          source: memo.source ?? "import",
          createdAt: memo.create_time ?? now,
          updatedAt: memo.update_time ?? memo.create_time ?? now,
        })
        .where(and(eq(memos.id, existing.id), eq(memos.userId, user.id)));
      memoIdMap.set(memo.name, existing.id);
      overwrittenMemos += 1;
      continue;
    }

    const importedId = existingById ? createResourceId("memos") : sourceId;
    memoIdMap.set(memo.name, importedId);
    // A duplicate import is intentionally a new memo. It cannot reuse the
    // original request's idempotency key when that key already identifies a
    // memo in this account.
    const clientId = existingByClientId ? undefined : requestedClientId;
    if (clientId) {
      payload.client_id = clientId;
    } else if (existingByClientId) {
      delete payload.client_id;
    }
    const tags = normalizeMemoTags(payload.tags ?? extractTags(memo.content));
    payload.tags = tags;
    const createdAt = memo.create_time ?? now;
    const updatedAt = memo.update_time ?? createdAt;
    const insertMemo = db.insert(memos).values({
      id: importedId,
      userId: user.id,
      content: memo.content,
      visibility: memo.visibility,
      status: memo.state,
      pinned: memo.pinned,
      source: memo.source ?? "import",
      clientId,
      payload,
      createdAt,
      updatedAt,
      deletedAt:
        memo.state === "deleted" || memo.state === "trashed" ? updatedAt : null,
    });
    if (tags.length > 0) {
      await db.batch([
        insertMemo,
        db.insert(memoTags).values(
          tags.map((tag) => ({
            memoId: importedId,
            userId: user.id,
            tag,
            createdAt,
          })),
        ),
      ]);
    } else {
      await insertMemo;
    }
    importedMemos += 1;
  }

  for (const attachment of bundle.attachments) {
    const mappedMemoId = attachment.memo
      ? (memoIdMap.get(attachment.memo) ?? null)
      : null;
    const objectKey = options.attachmentR2Keys?.get(attachment.name);
    const payload = {
      ...(attachment.payload ?? {}),
      ...(objectKey ? {} : { imported_without_binary: true }),
    };
    const sourceId = parseResourceName(attachment.name, "attachments");
    const existing = await db
      .select({
        id: attachments.id,
        r2Key: attachments.r2Key,
        state: attachments.state,
      })
      .from(attachments)
      .where(and(eq(attachments.id, sourceId), eq(attachments.userId, user.id)))
      .get();
    if (existing && conflict === "skip") {
      if (objectKey) cleanupR2Keys.push(objectKey);
      continue;
    }
    const importedId = existing ? createResourceId("attachments") : sourceId;
    const createdAt = attachment.create_time || now;
    const updatedAt = attachment.update_time || createdAt;
    const attachmentValues = {
      id: importedId,
      userId: user.id,
      memoId: mappedMemoId,
      r2Key:
        objectKey ??
        existing?.r2Key ??
        `imports/${user.id}/missing/${crypto.randomUUID()}`,
      filename: attachment.filename,
      contentType: attachment.content_type,
      size: attachment.size,
      state: objectKey ? ("ready" as const) : (existing?.state ?? "missing"),
      etag:
        options.attachmentEtags?.get(attachment.name) ??
        attachment.etag ??
        null,
      payload,
      createdAt,
      updatedAt,
      deletedAt: null,
    };
    if (existing && conflict === "overwrite") {
      await db
        .update(attachments)
        .set({ ...attachmentValues, id: existing.id })
        .where(
          and(eq(attachments.id, existing.id), eq(attachments.userId, user.id)),
        );
      if (objectKey && objectKey !== existing.r2Key) {
        cleanupR2Keys.push(existing.r2Key);
      }
    } else {
      await db.insert(attachments).values(attachmentValues);
    }
    importedAttachments += 1;
  }

  for (const relation of bundle.relations) {
    const memoId = memoIdMap.get(relation.memo);
    const relatedMemoId = memoIdMap.get(relation.related_memo);
    if (!memoId || !relatedMemoId) continue;
    const result = await db
      .insert(memoRelations)
      .values({
        memoId,
        relatedMemoId,
        type: relation.type,
        createdAt: relation.create_time || now,
      })
      .onConflictDoNothing();
    if (result.meta.changes > 0) importedRelations += 1;
  }

  for (const share of bundle.shares) {
    const memoId = memoIdMap.get(share.memo);
    if (!memoId) continue;
    const createdAt = share.create_time || now;
    await db.insert(shares).values({
      id: createResourceId("shares"),
      memoId,
      userId: user.id,
      token: createToken(),
      expiresAt: share.expires_at,
      createdAt,
      updatedAt: share.update_time ?? createdAt,
      revokedAt: share.revoked_at ?? null,
    });
    importedShares += 1;
  }

  // Memories are user-owned, atomic records. Import preserves the namespaced
  // id so memory↔memo resource links stay intact, resets derived fields
  // (fingerprint, access counters, embedding state), and skips rows that
  // already exist under `skip` or `overwrite` conflict handling.
  let importedMemories = 0;
  const memoryIdMap = new Map<string, string>();
  for (const memory of bundle.memories) {
    const sourceId = parseResourceName(memory.name, "memories");
    const existing = await db
      .select({ id: memoryItems.id })
      .from(memoryItems)
      .where(and(eq(memoryItems.id, sourceId), eq(memoryItems.userId, user.id)))
      .get();
    if (existing && conflict === "skip") {
      memoryIdMap.set(memory.name, existing.id);
      continue;
    }
    const importedId = existing ? createResourceId("memories") : sourceId;
    memoryIdMap.set(memory.name, importedId);
    const createdAt = memory.created_at ?? now;
    const updatedAt = memory.updated_at ?? createdAt;
    await db
      .insert(memoryItems)
      .values({
        id: importedId,
        userId: user.id,
        content: memory.content,
        type: memory.type,
        kind: memory.kind,
        scopeType: memory.scope_type,
        scopeKey: memory.scope_key,
        tier: memory.tier,
        verification: memory.verification,
        status: memory.status,
        importance: memory.importance,
        confidence: memory.confidence,
        needsReview: memory.needs_review,
        reviewReason: memory.review_reason,
        createdByType: memory.created_by_type,
        sourceAgent: memory.source_agent,
        sourceSession: memory.source_session,
        sourceRef: memory.source_ref,
        validFrom: memory.valid_from,
        validTo: memory.valid_to,
        // The canonical fingerprint is rebuilt from content on the next write;
        // an import-scoped placeholder keeps the per-user unique index intact
        // without trusting the exported (derived) value.
        fingerprint: `import:${importedId}`,
        accessCount: 0,
        lastAccessedAt: null,
        embeddingStatus: "not_indexed",
        createdAt,
        updatedAt,
        deletedAt: memory.status === "deleted" ? updatedAt : null,
      })
      .onConflictDoUpdate({
        target: memoryItems.id,
        set: {
          content: memory.content,
          type: memory.type,
          kind: memory.kind,
          scopeType: memory.scope_type,
          scopeKey: memory.scope_key,
          tier: memory.tier,
          verification: memory.verification,
          status: memory.status,
          importance: memory.importance,
          confidence: memory.confidence,
          needsReview: memory.needs_review,
          reviewReason: memory.review_reason,
          sourceAgent: memory.source_agent,
          sourceSession: memory.source_session,
          sourceRef: memory.source_ref,
          validFrom: memory.valid_from,
          validTo: memory.valid_to,
          updatedAt,
        },
      });
    importedMemories += 1;
  }

  for (const revision of bundle.memory_revisions) {
    const memoryId = memoryIdMap.get(revision.memory_id);
    if (!memoryId) continue;
    await db
      .insert(memoryRevisions)
      .values({
        id: parseResourceName(revision.name, "memories"),
        memoryId,
        userId: user.id,
        content: revision.content,
        metadataSnapshot: revision.metadata_snapshot,
        createdByType: revision.created_by_type,
        createdByAgent: revision.created_by_agent,
        createdAt: revision.created_at ?? now,
      })
      .onConflictDoNothing();
  }

  for (const relation of bundle.memory_relations) {
    const memoryId = memoryIdMap.get(relation.memory_id);
    const relatedMemoryId = memoryIdMap.get(relation.related_memory_id);
    if (!memoryId || !relatedMemoryId) continue;
    await db
      .insert(memoryRelations)
      .values({
        id: createResourceId("memories"),
        memoryId,
        relatedMemoryId,
        userId: user.id,
        type: relation.type,
        createdAt: relation.created_at ?? now,
      })
      .onConflictDoNothing();
  }

  for (const link of bundle.memory_resource_links) {
    const memoryId = memoryIdMap.get(link.memory_id);
    if (!memoryId) continue;
    await db
      .insert(memoryResourceLinks)
      .values({
        id: createResourceId("memories"),
        memoryId,
        userId: user.id,
        resourceType: link.resource_type,
        resourceRef: link.resource_ref,
        relationType: link.relation_type,
        metadata: link.metadata,
        createdAt: link.created_at ?? now,
      })
      .onConflictDoNothing();
  }

  return {
    imported_memos: importedMemos,
    skipped_memos: skippedMemos,
    overwritten_memos: overwrittenMemos,
    imported_attachments: importedAttachments,
    imported_relations: importedRelations,
    imported_shares: importedShares,
    imported_memories: importedMemories,
    cleanupR2Keys,
  };
}

export function mapImportedMemoName(name: string) {
  return parseResourceName(name, "memos");
}
