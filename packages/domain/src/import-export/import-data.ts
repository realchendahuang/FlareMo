import type { ImportBundle, ImportOptions } from "@flaremo/contracts";
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
  memoTags,
  projects,
  shares,
  taskActivity,
  tasks,
} from "@flaremo/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import { d1IdsPerStatement } from "../d1-limits";
import { ConflictError, ValidationError } from "../errors";
import { createResourceId, createToken, parseResourceName } from "../ids";
import { recalibrateUserHourlyCounts } from "../memo-hourly-counts";
import {
  normalizeMemoClientId,
  normalizeMemoPayload,
  updateMemo,
} from "../memos";
import { extractTags, normalizeMemoTags } from "../tags";
import { type ImportAuditTable, importAuditStatement } from "./audit";

/** A prepared Drizzle statement awaiting one `db.batch` slice. */
type ImportStatement = Parameters<FlareMoDb["batch"]>[0][number];

const IMPORT_INSERT_BATCH = 100;
// Checkpointed groups are [insert, audit] pairs (or [insert, children, audit]);
// flushing whole groups keeps the ledger row and its record in one batch.
const IMPORT_GROUP_BATCH = 40;

/** Flush [record, ledger] groups whole, so a committed record always has its
 *  checkpoint row in the same D1 transaction. */
async function flushImportGroups(
  db: FlareMoDb,
  groups: readonly ImportStatement[][],
) {
  for (let offset = 0; offset < groups.length; offset += IMPORT_GROUP_BATCH) {
    const slice = groups.slice(offset, offset + IMPORT_GROUP_BATCH).flat();
    if (slice.length === 0) continue;
    await db.batch(slice as unknown as Parameters<FlareMoDb["batch"]>[0]);
  }
}

/**
 * Run prepared statements in `db.batch` slices. Used for the entity groups
 * that used to issue one awaited statement per row — a 5 000-row bundle spent
 * ~10 000 serial D1 round trips inside a single request, which is far past any
 * Worker wall budget.
 *
 * Returns each statement's change count when the caller needs them, or
 * `undefined` when it does not (the batch API reports results positionally).
 */
async function flushImportStatements(
  db: FlareMoDb,
  statements: readonly ImportStatement[],
): Promise<number[] | undefined> {
  if (statements.length === 0) return undefined;
  const changes: number[] = [];
  for (
    let offset = 0;
    offset < statements.length;
    offset += IMPORT_INSERT_BATCH
  ) {
    const slice = statements.slice(offset, offset + IMPORT_INSERT_BATCH);
    const results = await db.batch(
      slice as unknown as Parameters<FlareMoDb["batch"]>[0],
    );
    for (const result of results as unknown as Array<{
      meta?: { changes?: number };
    }>) {
      changes.push(result?.meta?.changes ?? 0);
    }
  }
  return changes;
}

/**
 * Resource ids are global (`memos/<uuid>`, `attachments/<uuid>`…), while an
 * import into a different account has no remap step. A bundle exported from
 * account A therefore either hits a primary-key conflict halfway through the
 * write, or — for the id-targeted upserts below — silently overwrites A's
 * rows. Refuse the whole bundle before the first write instead.
 */
async function assertImportIdsAreFree(
  db: FlareMoDb,
  userId: string,
  bundle: ImportBundle,
) {
  // One extra bound value (`userId`) rides along with each id list.
  const chunkSize = d1IdsPerStatement(2);
  const groups = [
    {
      ids: bundle.memos.map((memo) => parseResourceName(memo.name, "memos")),
      findForeign: (chunk: string[]) =>
        db
          .select({ id: memos.id })
          .from(memos)
          .where(and(inArray(memos.id, chunk), ne(memos.userId, userId))),
    },
    {
      ids: bundle.attachments.map((attachment) =>
        parseResourceName(attachment.name, "attachments"),
      ),
      findForeign: (chunk: string[]) =>
        db
          .select({ id: attachments.id })
          .from(attachments)
          .where(
            and(inArray(attachments.id, chunk), ne(attachments.userId, userId)),
          ),
    },
    {
      ids: bundle.memories.map((memory) =>
        parseResourceName(memory.name, "memories"),
      ),
      findForeign: (chunk: string[]) =>
        db
          .select({ id: memoryItems.id })
          .from(memoryItems)
          .where(
            and(inArray(memoryItems.id, chunk), ne(memoryItems.userId, userId)),
          ),
    },
    {
      ids: bundle.projects.map((project) =>
        parseResourceName(project.name, "projects"),
      ),
      findForeign: (chunk: string[]) =>
        db
          .select({ id: projects.id })
          .from(projects)
          .where(and(inArray(projects.id, chunk), ne(projects.userId, userId))),
    },
    {
      ids: bundle.tasks.map((task) => parseResourceName(task.name, "tasks")),
      findForeign: (chunk: string[]) =>
        db
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(inArray(tasks.id, chunk), ne(tasks.userId, userId))),
    },
  ];
  for (const group of groups) {
    for (let offset = 0; offset < group.ids.length; offset += chunkSize) {
      const rows = await group.findForeign(
        group.ids.slice(offset, offset + chunkSize),
      );
      if (rows.length > 0) {
        throw new ConflictError(
          "This bundle contains resources owned by another account. Import it into the account that exported it.",
        );
      }
    }
  }
}

/**
 * Map a bundle memo's team to the receiving account. A memo can only live in
 * the receiver's own organization: anything else would publish into a team the
 * importer does not belong to. Export v6 carries the source `team_id`; v5 and
 * older omit it, so a non-private memo there is restored into the receiver's
 * team (the only team that can own it). When neither works the memo falls back
 * to private rather than remaining "protected without a team".
 */
function resolveImportedTeamId(
  user: UserRow & { teamOrganizationId?: string | null },
  memo: ImportBundle["memos"][number],
): string | null {
  if (memo.visibility === "private") return null;
  const exportedTeamId = memo.team_id ?? null;
  const receiverTeamId = user.teamOrganizationId ?? null;
  if (exportedTeamId) {
    return exportedTeamId === receiverTeamId ? exportedTeamId : null;
  }
  return receiverTeamId;
}

/**
 * The import half of import-export.ts, moved verbatim: replays an
 * ImportBundle into the target account with conflict handling and
 * id remapping (memos/attachments/relations/shares/memories/projects/
 * tasks/activity/memory revisions/relations/links).
 */
export async function importData(
  db: FlareMoDb,
  user: UserRow & { teamOrganizationId?: string | null },
  bundle: ImportBundle,
  options: {
    attachmentR2Keys?: Map<string, string>;
    attachmentEtags?: Map<string, string | null>;
    conflict?: ImportOptions["conflict"];
    /**
     * When set, every top-level insert also appends a row to the import
     * checkpoint ledger. The caller rolls the ledger back on failure, so an
     * interrupted bundle leaves nothing behind and a retry starts clean.
     */
    auditTaskId?: string;
  } = {},
) {
  const now = new Date().toISOString();
  const conflict = options.conflict ?? "duplicate";
  if (options.auditTaskId && conflict === "overwrite") {
    // Overwrite mutates pre-existing rows; the ledger can only roll back
    // inserts. Checkpointed imports stay insert-only.
    throw new ValidationError(
      "Checkpointed imports cannot use the overwrite conflict strategy",
    );
  }
  const audit = (table: ImportAuditTable, rowId: string): ImportStatement[] =>
    options.auditTaskId
      ? [importAuditStatement(db, options.auditTaskId, table, rowId)]
      : [];
  const memoIdMap = new Map<string, string>();
  let importedMemos = 0;
  let skippedMemos = 0;
  let overwrittenMemos = 0;
  let importedAttachments = 0;
  let importedRelations = 0;
  let importedShares = 0;
  const cleanupR2Keys: string[] = [];

  // The per-memo conflict checks used to issue up to two SELECTs per memo —
  // one by id, one by client_id. Both lookups are prefetched once here
  // (chunked inArray scans) and then extended per iteration with the ids this
  // import itself claims, so a bundle carrying duplicate names or duplicate
  // client_ids keeps the old sequential dedup behavior.
  const IMPORT_PREFETCH_CHUNK = d1IdsPerStatement();
  const preparedMemos = bundle.memos.map((memo) => {
    const sourceId = parseResourceName(memo.name, "memos");
    const payload = normalizeMemoPayload(memo.payload);
    const requestedClientId = normalizeMemoClientId(payload.client_id);
    if (requestedClientId) payload.client_id = requestedClientId;
    return { memo, sourceId, payload, requestedClientId };
  });
  await assertImportIdsAreFree(db, user.id, bundle);
  const existingMemoIds = new Set<string>();
  for (
    let offset = 0;
    offset < preparedMemos.length;
    offset += IMPORT_PREFETCH_CHUNK
  ) {
    const rows = await db
      .select({ id: memos.id })
      .from(memos)
      .where(
        and(
          eq(memos.userId, user.id),
          inArray(
            memos.id,
            preparedMemos
              .slice(offset, offset + IMPORT_PREFETCH_CHUNK)
              .map((prepared) => prepared.sourceId),
          ),
        ),
      );
    for (const row of rows) existingMemoIds.add(row.id);
  }
  const requestedClientIds = [
    ...new Set(
      preparedMemos
        .map((prepared) => prepared.requestedClientId)
        .filter((clientId): clientId is string => Boolean(clientId)),
    ),
  ];
  const claimedClientIds = new Map<string, string>();
  for (
    let offset = 0;
    offset < requestedClientIds.length;
    offset += IMPORT_PREFETCH_CHUNK
  ) {
    const rows = await db
      .select({ id: memos.id, clientId: memos.clientId })
      .from(memos)
      .where(
        and(
          eq(memos.userId, user.id),
          inArray(
            memos.clientId,
            requestedClientIds.slice(offset, offset + IMPORT_PREFETCH_CHUNK),
          ),
        ),
      );
    for (const row of rows) {
      if (row.clientId && !claimedClientIds.has(row.clientId)) {
        claimedClientIds.set(row.clientId, row.id);
      }
    }
  }

  for (const { memo, sourceId, payload, requestedClientId } of preparedMemos) {
    const importedTeamId = resolveImportedTeamId(user, memo);
    const importedVisibility = importedTeamId ? memo.visibility : "private";
    const clientIdOwnerId = requestedClientId
      ? claimedClientIds.get(requestedClientId)
      : undefined;
    const existingById = existingMemoIds.has(sourceId)
      ? { id: sourceId }
      : undefined;
    const existingByClientId = clientIdOwnerId
      ? { id: clientIdOwnerId }
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
        visibility: importedVisibility,
        status: memo.state,
        pinned: memo.pinned,
        payload,
      });
      await db
        .update(memos)
        .set({
          source: memo.source ?? "import",
          teamId: importedTeamId,
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
      teamId: importedTeamId,
      content: memo.content,
      visibility: importedVisibility,
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
        ...audit("memos", importedId),
      ]);
    } else {
      await db.batch([insertMemo, ...audit("memos", importedId)]);
    }
    // Rows claimed inside this import join the prefetched sets so later
    // bundle entries dedup against them exactly like the old sequential
    // SELECTs did.
    existingMemoIds.add(importedId);
    if (clientId) claimedClientIds.set(clientId, importedId);
    importedMemos += 1;
  }

  // One prefetch instead of a SELECT per attachment: a bundle with a few
  // thousand attachments turned the import into twice as many serial D1 round
  // trips as rows.
  const existingAttachmentById = new Map<
    string,
    {
      id: string;
      r2Key: string;
      state: NonNullable<typeof attachments.$inferSelect.state>;
    }
  >();
  for (
    let offset = 0;
    offset < bundle.attachments.length;
    offset += IMPORT_PREFETCH_CHUNK
  ) {
    const rows = await db
      .select({
        id: attachments.id,
        r2Key: attachments.r2Key,
        state: attachments.state,
      })
      .from(attachments)
      .where(
        and(
          eq(attachments.userId, user.id),
          inArray(
            attachments.id,
            bundle.attachments
              .slice(offset, offset + IMPORT_PREFETCH_CHUNK)
              .map((attachment) =>
                parseResourceName(attachment.name, "attachments"),
              ),
          ),
        ),
      );
    for (const row of rows) existingAttachmentById.set(row.id, row);
  }

  const attachmentGroups: ImportStatement[][] = [];
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
    const existing = existingAttachmentById.get(sourceId);
    if (existing && conflict === "skip") {
      if (objectKey) cleanupR2Keys.push(objectKey);
      continue;
    }
    const importedId = existing ? createResourceId("attachments") : sourceId;
    const createdAt = attachment.create_time || now;
    const updatedAt = attachment.update_time || createdAt;
    // A duplicate row without bytes must not claim the original's R2 object:
    // both rows would point at one key and deleting either one would break
    // the other. Only an overwrite keeps the existing object by design.
    const reuseExistingObject =
      Boolean(existing) && !objectKey && conflict === "overwrite";
    const attachmentValues = {
      id: importedId,
      userId: user.id,
      memoId: mappedMemoId,
      r2Key:
        objectKey ??
        (reuseExistingObject && existing
          ? existing.r2Key
          : `imports/${user.id}/missing/${crypto.randomUUID()}`),
      filename: attachment.filename,
      contentType: attachment.content_type,
      size: attachment.size,
      state: objectKey
        ? ("ready" as const)
        : reuseExistingObject
          ? (existing?.state ?? "missing")
          : ("missing" as const),
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
      attachmentGroups.push([
        db
          .update(attachments)
          .set({ ...attachmentValues, id: existing.id })
          .where(
            and(
              eq(attachments.id, existing.id),
              eq(attachments.userId, user.id),
            ),
          ),
      ]);
      if (objectKey && objectKey !== existing.r2Key) {
        cleanupR2Keys.push(existing.r2Key);
      }
    } else {
      attachmentGroups.push([
        db.insert(attachments).values(attachmentValues),
        ...audit("attachments", importedId),
      ]);
    }
    importedAttachments += 1;
  }
  await flushImportGroups(db, attachmentGroups);

  const relationStatements: ImportStatement[] = [];
  for (const relation of bundle.relations) {
    const memoId = memoIdMap.get(relation.memo);
    const relatedMemoId = memoIdMap.get(relation.related_memo);
    if (!memoId || !relatedMemoId) continue;
    relationStatements.push(
      db
        .insert(memoRelations)
        .values({
          memoId,
          relatedMemoId,
          type: relation.type,
          createdAt: relation.create_time || now,
        })
        .onConflictDoNothing(),
    );
    // `onConflictDoNothing` means "already present", which the old code
    // detected per statement via `meta.changes`. Batched statements still
    // report their changes in order, so the count is taken from the batch
    // results below instead of here.
    importedRelations += 1;
  }
  const relationChanges = await flushImportStatements(db, relationStatements);
  if (relationChanges) {
    importedRelations = relationChanges.reduce((sum, n) => sum + n, 0);
  }

  const existingShareIds = new Set<string>();
  for (
    let offset = 0;
    offset < bundle.shares.length;
    offset += IMPORT_PREFETCH_CHUNK
  ) {
    const rows = await db
      .select({ id: shares.id })
      .from(shares)
      .where(
        and(
          eq(shares.userId, user.id),
          inArray(
            shares.id,
            bundle.shares
              .slice(offset, offset + IMPORT_PREFETCH_CHUNK)
              .map((share) => parseResourceName(share.name, "shares")),
          ),
        ),
      );
    for (const row of rows) existingShareIds.add(row.id);
  }
  const shareGroups: ImportStatement[][] = [];
  for (const share of bundle.shares) {
    const memoId = memoIdMap.get(share.memo);
    if (!memoId) continue;
    const sourceId = parseResourceName(share.name, "shares");
    const existing = existingShareIds.has(sourceId);
    if (existing && conflict === "skip") continue;
    // A re-import creates a new share row only in duplicate mode; the token is
    // always minted here, never taken from the bundle.
    const importedId = existing ? createResourceId("shares") : sourceId;
    existingShareIds.add(importedId);
    const createdAt = share.create_time || now;
    shareGroups.push([
      db.insert(shares).values({
        id: importedId,
        memoId,
        userId: user.id,
        token: createToken(),
        expiresAt: share.expires_at,
        createdAt,
        updatedAt: share.update_time ?? createdAt,
        revokedAt: share.revoked_at ?? null,
      }),
      ...audit("shares", importedId),
    ]);
    importedShares += 1;
  }
  await flushImportGroups(db, shareGroups);

  // Memories are user-owned, atomic records. Import preserves the namespaced
  // id so memory↔memo resource links stay intact, resets derived fields
  // (fingerprint, access counters, embedding state), and skips rows that
  // already exist under `skip` or `overwrite` conflict handling.
  let importedMemories = 0;
  const memoryIdMap = new Map<string, string>();
  // Same prefetch shape as memos: one chunked id scan instead of a SELECT per
  // memory row.
  const existingMemoryIds = new Set<string>();
  for (
    let offset = 0;
    offset < bundle.memories.length;
    offset += IMPORT_PREFETCH_CHUNK
  ) {
    const rows = await db
      .select({ id: memoryItems.id })
      .from(memoryItems)
      .where(
        and(
          eq(memoryItems.userId, user.id),
          inArray(
            memoryItems.id,
            bundle.memories
              .slice(offset, offset + IMPORT_PREFETCH_CHUNK)
              .map((memory) => parseResourceName(memory.name, "memories")),
          ),
        ),
      );
    for (const row of rows) existingMemoryIds.add(row.id);
  }
  const memoryGroups: ImportStatement[][] = [];
  // Child rows (revisions/links/evidence/events) are imported only for the
  // memory rows this run actually wrote. A skipped existing memory keeps its
  // own history untouched, and the child rows cascade from the audited parent
  // if this import is later rolled back.
  const importedMemoryIds = new Set<string>();
  for (const memory of bundle.memories) {
    const sourceId = parseResourceName(memory.name, "memories");
    const existing = existingMemoryIds.has(sourceId)
      ? { id: sourceId }
      : undefined;
    if (existing && conflict === "skip") {
      memoryIdMap.set(memory.name, existing.id);
      continue;
    }
    const importedId = existing ? createResourceId("memories") : sourceId;
    memoryIdMap.set(memory.name, importedId);
    importedMemoryIds.add(importedId);
    const createdAt = memory.created_at ?? now;
    const updatedAt = memory.updated_at ?? createdAt;
    const memoryInsert = db
      .insert(memoryItems)
      .values({
        id: importedId,
        userId: user.id,
        content: memory.content,
        type: memory.type,
        kind: memory.kind,
        scopeType: memory.scope_type,
        scopeKey: memory.scope_key,
        factKey: memory.fact_key ?? null,
        tags: Array.isArray(memory.tags) ? memory.tags : [],
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
        observedAt: memory.observed_at ?? null,
        expiresAt: memory.expires_at ?? null,
        supersededById: memory.superseded_by_id ?? null,
        supersededAt: memory.superseded_at ?? null,
        rejectedAt: memory.rejected_at ?? null,
        // The canonical fingerprint is rebuilt from content on the next
        // write; an import-scoped placeholder keeps the per-user unique
        // index intact without trusting the exported (derived) value.
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
          factKey: memory.fact_key ?? null,
          tags: Array.isArray(memory.tags) ? memory.tags : [],
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
          observedAt: memory.observed_at ?? null,
          expiresAt: memory.expires_at ?? null,
          supersededById: memory.superseded_by_id ?? null,
          supersededAt: memory.superseded_at ?? null,
          rejectedAt: memory.rejected_at ?? null,
          updatedAt,
        },
      });
    memoryGroups.push([memoryInsert, ...audit("memory_items", importedId)]);
    importedMemories += 1;
  }
  await flushImportGroups(db, memoryGroups);

  // Projects, tasks and the activity trail follow the same remap pipeline as
  // memories: the source id is preserved when free, collision imports get a
  // fresh id, and task → project / task → memo / activity → task references
  // follow the maps. A task whose project is not in the bundle lands as
  // unassigned (project_id is nullable by design).
  let importedProjects = 0;
  const projectIdMap = new Map<string, string>();
  for (const project of bundle.projects) {
    const sourceId = parseResourceName(project.name, "projects");
    const existing = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, sourceId), eq(projects.userId, user.id)))
      .get();
    if (existing && conflict === "skip") {
      projectIdMap.set(project.name, existing.id);
      continue;
    }
    const importedId = existing ? createResourceId("projects") : sourceId;
    projectIdMap.set(project.name, importedId);
    const projectInsert = db
      .insert(projects)
      .values({
        id: importedId,
        userId: user.id,
        name: project.title,
        description: project.description,
        status: project.status,
        deletedAt: project.deleted_at,
        createdAt: project.created_at,
        updatedAt: project.updated_at,
      })
      .onConflictDoUpdate({
        target: projects.id,
        set: {
          name: project.title,
          description: project.description,
          status: project.status,
          deletedAt: project.deleted_at,
          updatedAt: project.updated_at,
        },
      });
    await db.batch([projectInsert, ...audit("projects", importedId)]);
    importedProjects += 1;
  }

  let importedTasks = 0;
  const taskIdMap = new Map<string, string>();
  for (const task of bundle.tasks) {
    const sourceId = parseResourceName(task.name, "tasks");
    const existing = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, sourceId), eq(tasks.userId, user.id)))
      .get();
    if (existing && conflict === "skip") {
      taskIdMap.set(task.name, existing.id);
      continue;
    }
    const importedId = existing ? createResourceId("tasks") : sourceId;
    taskIdMap.set(task.name, importedId);
    const taskInsert = db
      .insert(tasks)
      .values({
        id: importedId,
        userId: user.id,
        projectId: task.project_id
          ? (projectIdMap.get(task.project_id) ?? null)
          : null,
        // A memo id remaps through the memo map; an unmapped memo (e.g. the
        // memo was skipped) loses the bridge rather than dangling.
        sourceMemoId: task.source_memo_id
          ? (memoIdMap.get(task.source_memo_id) ?? null)
          : null,
        title: task.title,
        notes: task.notes,
        status: task.status,
        priority: task.priority,
        dueAt: task.due_at,
        sortOrder: task.sort_order,
        completedAt: task.completed_at,
        deletedAt: task.deleted_at,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
      })
      .onConflictDoUpdate({
        target: tasks.id,
        set: {
          projectId: task.project_id
            ? (projectIdMap.get(task.project_id) ?? null)
            : null,
          sourceMemoId: task.source_memo_id
            ? (memoIdMap.get(task.source_memo_id) ?? null)
            : null,
          title: task.title,
          notes: task.notes,
          status: task.status,
          priority: task.priority,
          dueAt: task.due_at,
          sortOrder: task.sort_order,
          completedAt: task.completed_at,
          deletedAt: task.deleted_at,
          updatedAt: task.updated_at,
        },
      });
    await db.batch([taskInsert, ...audit("tasks", importedId)]);
    importedTasks += 1;
  }

  let importedTaskActivity = 0;
  for (const activity of bundle.task_activity) {
    const taskId = activity.task_id
      ? (taskIdMap.get(activity.task_id) ?? null)
      : null;
    // A null task_id is a project-scoped event (reorder) and imports as is;
    // rows pointing at a task that was not imported are dropped instead of
    // writing activity for a task that does not exist here.
    if (activity.task_id && !taskId) continue;
    await db.insert(taskActivity).values({
      taskId,
      userId: user.id,
      actorType: activity.actor_type,
      actorName: activity.actor_name,
      // The marker is what lets a failed import find project-scoped rows (no
      // task FK) and what the success path strips again.
      changes: options.auditTaskId
        ? { ...activity.changes, __import_task_id: options.auditTaskId }
        : activity.changes,
      action: activity.action,
      createdAt: activity.created_at,
    });
    importedTaskActivity += 1;
  }

  // The five memory-adjacent tables are pure inserts: every row maps through
  // memoryIdMap up front, then the statements flush through bounded
  // db.batch calls instead of one awaited insert per row.
  const statements: unknown[] = [];

  for (const revision of bundle.memory_revisions) {
    const memoryId = memoryIdMap.get(revision.memory_id);
    if (!memoryId || !importedMemoryIds.has(memoryId)) continue;
    statements.push(
      db
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
        .onConflictDoNothing(),
    );
  }

  for (const relation of bundle.memory_relations) {
    const memoryId = memoryIdMap.get(relation.memory_id);
    const relatedMemoryId = memoryIdMap.get(relation.related_memory_id);
    if (
      !memoryId ||
      !relatedMemoryId ||
      !importedMemoryIds.has(memoryId) ||
      !importedMemoryIds.has(relatedMemoryId)
    )
      continue;
    statements.push(
      db
        .insert(memoryRelations)
        .values({
          id: createResourceId("memories"),
          memoryId,
          relatedMemoryId,
          userId: user.id,
          type: relation.type,
          createdAt: relation.created_at ?? now,
        })
        .onConflictDoNothing(),
    );
  }

  for (const link of bundle.memory_resource_links) {
    const memoryId = memoryIdMap.get(link.memory_id);
    if (!memoryId || !importedMemoryIds.has(memoryId)) continue;
    statements.push(
      db
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
        .onConflictDoNothing(),
    );
  }

  for (const evidence of bundle.memory_evidence) {
    const memoryId = memoryIdMap.get(evidence.memory_id);
    if (!memoryId || !importedMemoryIds.has(memoryId)) continue;
    statements.push(
      db
        .insert(memoryEvidence)
        .values({
          id: createResourceId("memories"),
          memoryId,
          userId: user.id,
          sourceType: evidence.source_type,
          sourceId: evidence.source_id,
          sourceRevision: evidence.source_revision ?? null,
          relationType: evidence.relation_type,
          observedAt: evidence.observed_at ?? null,
          excerpt: evidence.excerpt ?? null,
          excerptHash: evidence.excerpt_hash ?? null,
          metadata: evidence.metadata ?? {},
          createdAt: evidence.created_at ?? now,
        })
        .onConflictDoNothing(),
    );
  }

  for (const event of bundle.memory_events) {
    const memoryId = memoryIdMap.get(event.memory_id);
    if (!memoryId || !importedMemoryIds.has(memoryId)) continue;
    statements.push(
      db
        .insert(memoryEvents)
        .values({
          id: createResourceId("memories"),
          memoryId,
          userId: user.id,
          eventType: event.event_type,
          actorType: event.actor_type,
          actorName: event.actor_name ?? null,
          metadata: event.metadata ?? {},
          createdAt: event.created_at ?? now,
        })
        .onConflictDoNothing(),
    );
  }

  for (
    let offset = 0;
    offset < statements.length;
    offset += IMPORT_INSERT_BATCH
  ) {
    await db.batch(
      statements.slice(
        offset,
        offset + IMPORT_INSERT_BATCH,
      ) as unknown as Parameters<FlareMoDb["batch"]>[0],
    );
  }

  // The activity counter is rebuilt for the importing user in one pass.
  //
  // This import writes `memos` directly and rewrites `created_at` on the
  // overwrite branch, so it moves memos between UTC hour buckets without
  // passing through the incremental counter statements that createMemo and
  // updateMemo emit. Recomputing once is also far cheaper than the alternative:
  // a bundle may carry 50k memos, and a per-memo adjustment would be 50k extra
  // statements. Backfilling history is exactly the workload that made the
  // heatmap expensive in the first place, so it has to leave the counter right.
  if (importedMemos > 0 || overwrittenMemos > 0) {
    await recalibrateUserHourlyCounts(db, user.id, now);
  }

  return {
    imported_memos: importedMemos,
    skipped_memos: skippedMemos,
    overwritten_memos: overwrittenMemos,
    imported_attachments: importedAttachments,
    imported_relations: importedRelations,
    imported_shares: importedShares,
    imported_memories: importedMemories,
    imported_projects: importedProjects,
    imported_tasks: importedTasks,
    imported_task_activity: importedTaskActivity,
    cleanupR2Keys,
  };
}
