import type { FlareMoDb, MemoryItemRow, UserRow } from "@flaremo/db";
import {
  memoryEvents,
  memoryEvidence,
  memoryItems,
  memoryRelations,
  memoryRevisions,
} from "@flaremo/db";
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { ValidationError } from "../errors";
import {
  memoryEventToDto,
  memoryEvidenceToDto,
  memoryRelationToDto,
  memoryRevisionToDto,
  memoryToDto,
} from "./dto";
import { buildFtsCondition, requireMemory } from "./shared";

/**
 * List page bounds shared by the memory ledger endpoints. The API contract
 * (`listMemoriesQuerySchema`) allows up to 100 rows per request; the domain
 * default matches that ceiling so a caller that forgets `pageSize` still gets
 * a bounded query instead of the whole ledger.
 */
const MEMORY_PAGE_MAX = 100;

type MemoryCursor = { updatedAt: string; id: string };

function encodeMemoryPageToken(value: MemoryCursor) {
  return btoa(JSON.stringify(value));
}

function decodeMemoryPageToken(token: string): MemoryCursor {
  try {
    const parsed = JSON.parse(atob(token)) as Partial<MemoryCursor>;
    if (typeof parsed.updatedAt === "string" && typeof parsed.id === "string") {
      return parsed as MemoryCursor;
    }
  } catch {
    // The validation error below gives callers one stable failure shape.
  }
  throw new ValidationError("Invalid page token");
}

// Resume strictly after the cursor row on the (updatedAt, id) tie-break chain
// that matches the ORDER BY of every paginated memory query below.
function memoryCursorFilter(cursor: MemoryCursor): SQL {
  return or(
    lt(memoryItems.updatedAt, cursor.updatedAt),
    and(
      eq(memoryItems.updatedAt, cursor.updatedAt),
      lt(memoryItems.id, cursor.id),
    ),
  ) as SQL;
}

export async function getMemory(db: FlareMoDb, user: UserRow, id: string) {
  const row = await requireMemory(db, user, id);
  // RETURNING hands back the post-update row, so the access bump costs one
  // statement instead of update-then-reread.
  const [bumped] = await db
    .update(memoryItems)
    .set({
      accessCount: row.accessCount + 1,
      lastAccessedAt: new Date().toISOString(),
    })
    .where(and(eq(memoryItems.id, id), eq(memoryItems.userId, user.id)))
    .returning();

  const evidenceRows = await db
    .select()
    .from(memoryEvidence)
    .where(
      and(eq(memoryEvidence.memoryId, id), eq(memoryEvidence.userId, user.id)),
    );

  return memoryToDto(bumped ?? row, evidenceRows.map(memoryEvidenceToDto));
}

export async function listMemories(
  db: FlareMoDb,
  user: UserRow,
  input: {
    q?: string;
    type?: MemoryItemRow["type"];
    kind?: MemoryItemRow["kind"];
    scopeType?: MemoryItemRow["scopeType"];
    scopeKey?: string;
    factKey?: string;
    tier?: MemoryItemRow["tier"];
    verification?: MemoryItemRow["verification"];
    status?: MemoryItemRow["status"];
    sourceAgent?: string;
    needsReview?: boolean;
    asOf?: string;
    pageSize?: number;
    pageToken?: string;
  } = {},
): Promise<{
  memories: ReturnType<typeof memoryToDto>[];
  nextPageToken?: string;
}> {
  const pageSize = Math.min(
    Math.max(input.pageSize ?? MEMORY_PAGE_MAX, 1),
    MEMORY_PAGE_MAX,
  );
  const filters: SQL[] = [eq(memoryItems.userId, user.id)];
  if (input.q?.trim()) {
    const fts = buildFtsCondition(input.q);
    if (fts) filters.push(fts);
  }
  if (input.type) filters.push(eq(memoryItems.type, input.type));
  if (input.kind) filters.push(eq(memoryItems.kind, input.kind));
  if (input.scopeType) filters.push(eq(memoryItems.scopeType, input.scopeType));
  if (input.scopeKey) filters.push(eq(memoryItems.scopeKey, input.scopeKey));
  if (input.factKey) filters.push(eq(memoryItems.factKey, input.factKey));
  if (input.tier) filters.push(eq(memoryItems.tier, input.tier));
  if (input.verification)
    filters.push(eq(memoryItems.verification, input.verification));
  if (input.status) filters.push(eq(memoryItems.status, input.status));
  if (input.sourceAgent)
    filters.push(eq(memoryItems.sourceAgent, input.sourceAgent));
  if (input.needsReview !== undefined)
    filters.push(eq(memoryItems.needsReview, input.needsReview));

  if (input.asOf) {
    filters.push(
      or(
        isNull(memoryItems.validFrom),
        lte(memoryItems.validFrom, input.asOf),
      ) as SQL,
    );
    filters.push(
      or(
        isNull(memoryItems.validTo),
        sql`${memoryItems.validTo} > ${input.asOf}`,
      ) as SQL,
    );
  }

  const cursor = input.pageToken
    ? decodeMemoryPageToken(input.pageToken)
    : undefined;
  if (cursor) filters.push(memoryCursorFilter(cursor));

  const rows = await db
    .select()
    .from(memoryItems)
    .where(and(...filters))
    .orderBy(desc(memoryItems.updatedAt), desc(memoryItems.id))
    .limit(pageSize + 1);

  const page = rows.slice(0, pageSize);
  return {
    memories: page.map((r) => memoryToDto(r)),
    nextPageToken:
      rows.length > pageSize && page.length > 0
        ? encodeMemoryPageToken({
            updatedAt: (page.at(-1) as MemoryItemRow).updatedAt,
            id: (page.at(-1) as MemoryItemRow).id,
          })
        : undefined,
  };
}

export async function listMemoryReview(db: FlareMoDb, user: UserRow) {
  const rows = await db
    .select()
    .from(memoryItems)
    .where(
      and(
        eq(memoryItems.userId, user.id),
        // The inbox holds *pending* items only. A rejected proposal is still an
        // inference semantically, so the work of keeping a dismissed card off
        // this list happens here rather than by rewriting the row's
        // verification: archived inferences (rejected or forgotten) are done.
        or(
          // A flag on an archived or superseded row is history, not work:
          // the evidence sweep can mark rows that are already retired.
          and(
            eq(memoryItems.needsReview, true),
            eq(memoryItems.status, "active"),
          ),
          eq(memoryItems.status, "disputed"),
          and(
            eq(memoryItems.verification, "inferred"),
            eq(memoryItems.status, "active"),
            isNull(memoryItems.rejectedAt),
          ),
        ),
      ),
    )
    .orderBy(desc(memoryItems.updatedAt), desc(memoryItems.id))
    // The inbox is a work queue: it is shown whole in the UI, so this cap is
    // deliberately generous. It exists only to keep one runaway ledger from
    // turning the queue read into an unbounded scan.
    .limit(MEMORY_PAGE_MAX);

  const ids = rows.map((r) => r.id);
  const evidenceMap = new Map<string, (typeof memoryEvidence.$inferSelect)[]>();
  if (ids.length > 0) {
    const evidenceRows = await db
      .select()
      .from(memoryEvidence)
      .where(
        and(
          eq(memoryEvidence.userId, user.id),
          inArray(memoryEvidence.memoryId, ids),
        ),
      );
    for (const ev of evidenceRows) {
      const list = evidenceMap.get(ev.memoryId) ?? [];
      list.push(ev);
      evidenceMap.set(ev.memoryId, list);
    }
  }

  const conflicts = await findReviewConflicts(db, user, rows, evidenceMap);

  return rows.map((r) => ({
    ...memoryToDto(r, (evidenceMap.get(r.id) ?? []).map(memoryEvidenceToDto)),
    conflict_with: conflicts.get(r.id) ?? null,
  }));
}

/**
 * The memory a queued item wants to replace or contradicts, so the inbox can
 * show "what you have now" beside "what the AI proposes". Three paths lead
 * here: a proposal against a confirmed fact (`contradicts` relation written
 * at creation), an agent `memory_link contradicts` (same relation), and the
 * Dreaming conflict patrol (target id in its evidence). Falls back to the
 * live holder of the same fact key.
 */
async function findReviewConflicts(
  db: FlareMoDb,
  user: UserRow,
  rows: MemoryItemRow[],
  evidenceMap: Map<string, (typeof memoryEvidence.$inferSelect)[]>,
) {
  const result = new Map<
    string,
    { id: string; content: string; verification: MemoryItemRow["verification"] }
  >();
  if (rows.length === 0) return result;
  const ids = rows.map((r) => r.id);
  const targetByItem = new Map<string, string>();

  const relationRows = await db
    .select({
      memoryId: memoryRelations.memoryId,
      relatedMemoryId: memoryRelations.relatedMemoryId,
    })
    .from(memoryRelations)
    .where(
      and(
        eq(memoryRelations.userId, user.id),
        eq(memoryRelations.type, "contradicts"),
        inArray(memoryRelations.memoryId, ids),
      ),
    );
  for (const rel of relationRows) {
    if (!targetByItem.has(rel.memoryId)) {
      targetByItem.set(rel.memoryId, rel.relatedMemoryId);
    }
  }
  for (const r of rows) {
    if (targetByItem.has(r.id)) continue;
    const pointer = (evidenceMap.get(r.id) ?? []).find(
      (ev) => ev.sourceType === "other" && ev.sourceId !== r.id,
    );
    if (pointer) targetByItem.set(r.id, pointer.sourceId);
  }

  const factKeys = rows
    .filter((r) => !targetByItem.has(r.id) && r.factKey)
    .map((r) => r.factKey as string);
  const targetIds = [...new Set(targetByItem.values())];
  const targets =
    targetIds.length > 0 || factKeys.length > 0
      ? await db
          .select({
            id: memoryItems.id,
            content: memoryItems.content,
            verification: memoryItems.verification,
            factKey: memoryItems.factKey,
            status: memoryItems.status,
          })
          .from(memoryItems)
          .where(
            and(
              eq(memoryItems.userId, user.id),
              or(
                targetIds.length > 0
                  ? inArray(memoryItems.id, targetIds)
                  : undefined,
                factKeys.length > 0
                  ? and(
                      inArray(memoryItems.factKey, factKeys),
                      eq(memoryItems.status, "active"),
                      sql`${memoryItems.verification} != 'inferred'`,
                    )
                  : undefined,
              ),
            ),
          )
      : [];
  const byId = new Map(targets.map((t) => [t.id, t]));
  for (const r of rows) {
    const targetId = targetByItem.get(r.id);
    const target = targetId
      ? byId.get(targetId)
      : r.factKey
        ? targets.find(
            (t) =>
              t.factKey === r.factKey && t.id !== r.id && t.status === "active",
          )
        : undefined;
    if (target && target.id !== r.id) {
      result.set(r.id, {
        id: target.id,
        content: target.content,
        verification: target.verification,
      });
    }
  }
  return result;
}

/**
 * Ceiling for one memory's sub-resource reads (revisions, evidence, events,
 * relations). These tables only grow — evidence is appended on every
 * confirmation and events on every lifecycle transition — and the endpoints
 * used to return the entire history in a single response. Newest-first plus a
 * limit keeps the payload bounded; callers that need older history page
 * through the dedicated endpoints.
 */
const MEMORY_SUBRESOURCE_LIMIT = 200;

export async function listMemoryRevisions(
  db: FlareMoDb,
  user: UserRow,
  memoryId: string,
) {
  await requireMemory(db, user, memoryId);
  const rows = await db
    .select()
    .from(memoryRevisions)
    .where(
      and(
        eq(memoryRevisions.memoryId, memoryId),
        eq(memoryRevisions.userId, user.id),
      ),
    )
    .orderBy(desc(memoryRevisions.createdAt))
    .limit(MEMORY_SUBRESOURCE_LIMIT);
  return rows.map(memoryRevisionToDto);
}

export async function listMemoryRelations(
  db: FlareMoDb,
  user: UserRow,
  memoryId: string,
) {
  await requireMemory(db, user, memoryId);
  const rows = await db
    .select()
    .from(memoryRelations)
    .where(
      and(
        eq(memoryRelations.userId, user.id),
        or(
          eq(memoryRelations.memoryId, memoryId),
          eq(memoryRelations.relatedMemoryId, memoryId),
        ),
      ),
    )
    .orderBy(desc(memoryRelations.createdAt))
    .limit(MEMORY_SUBRESOURCE_LIMIT);
  return rows.map(memoryRelationToDto);
}

export async function listMemoryEvidence(
  db: FlareMoDb,
  user: UserRow,
  memoryId: string,
) {
  await requireMemory(db, user, memoryId);
  const rows = await db
    .select()
    .from(memoryEvidence)
    .where(
      and(
        eq(memoryEvidence.memoryId, memoryId),
        eq(memoryEvidence.userId, user.id),
      ),
    )
    .orderBy(desc(memoryEvidence.createdAt))
    .limit(MEMORY_SUBRESOURCE_LIMIT);
  return rows.map(memoryEvidenceToDto);
}

export async function getMemoryLineage(
  db: FlareMoDb,
  user: UserRow,
  memoryId: string,
) {
  const current = await requireMemory(db, user, memoryId);

  let chainRows: MemoryItemRow[] = [current];
  if (current.factKey) {
    chainRows = await db
      .select()
      .from(memoryItems)
      .where(
        and(
          eq(memoryItems.userId, user.id),
          eq(memoryItems.factKey, current.factKey),
        ),
      )
      .orderBy(desc(memoryItems.createdAt))
      .limit(MEMORY_SUBRESOURCE_LIMIT);
  }

  // Three independent reads; running them serially tripled the latency of the
  // lineage view for no reason.
  const [revisions, evidenceRows, eventRows] = await Promise.all([
    db
      .select()
      .from(memoryRevisions)
      .where(
        and(
          eq(memoryRevisions.memoryId, memoryId),
          eq(memoryRevisions.userId, user.id),
        ),
      )
      .orderBy(desc(memoryRevisions.createdAt)),
    db
      .select()
      .from(memoryEvidence)
      .where(
        and(
          eq(memoryEvidence.memoryId, memoryId),
          eq(memoryEvidence.userId, user.id),
        ),
      )
      .orderBy(desc(memoryEvidence.createdAt)),
    db
      .select()
      .from(memoryEvents)
      .where(
        and(
          eq(memoryEvents.memoryId, memoryId),
          eq(memoryEvents.userId, user.id),
        ),
      )
      .orderBy(desc(memoryEvents.createdAt)),
  ]);

  return {
    current: memoryToDto(current),
    chain: chainRows.map((r) => memoryToDto(r)),
    revisions: revisions.map(memoryRevisionToDto),
    evidence: evidenceRows.map(memoryEvidenceToDto),
    events: eventRows.map(memoryEventToDto),
  };
}
