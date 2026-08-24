import type {
  CheckpointInput,
  CreateMemoryFromMemoInput,
  CreateMemoryInput,
  MemoryDto,
  MemoryForgetReason,
  MemoryRelationDto,
  MemoryRelationType,
  MemoryResourceLinkDto,
  MemoryResourceRelationType,
  MemoryResourceType,
  MemoryRevisionDto,
  RememberInput,
  UpdateMemoryInput,
} from "@flaremo/contracts";
import type { FlareMoDb, MemoryItemRow, UserRow } from "@flaremo/db";
import {
  memoryItems,
  memoryRelations,
  memoryResourceLinks,
  memoryRevisions,
} from "@flaremo/db";
import { and, desc, eq, or, type SQL, sql } from "drizzle-orm";
import { insertEmbeddingTask } from "./embedding-outbox";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { createResourceId } from "./ids";
import { createMemo } from "./memos";

export const MEMORY_MAX_CONTENT_LENGTH = 4_000;
export const MEMORY_DEFAULT_RECALL_LIMIT = 8;
export const MEMORY_MAX_RECALL_LIMIT = 20;
export const MEMORY_DEFAULT_BOOTSTRAP_MAX_ITEMS = 20;
export const MEMORY_BOOTSTRAP_CHAR_BUDGET = 6_000;
const MEMORY_RECALL_CANDIDATE_LIMIT = 50;

/**
 * The actor behind a memory mutation. Browser sessions are the owner; PATs
 * (MCP clients and scripts) are agents. Agents operate one tier below the
 * user in the verification hierarchy and may never overwrite confirmed or
 * locked memories.
 */
export type MemoryActor = { type: "user" } | { type: "agent"; name: string };

type MemoryWriteInput = {
  content: string;
  type: MemoryItemRow["type"];
  kind: MemoryItemRow["kind"];
  scopeType: MemoryItemRow["scopeType"];
  scopeKey: string | null;
  tier: MemoryItemRow["tier"];
  importance: number;
  confidence: number;
  verification?: MemoryItemRow["verification"];
  sourceAgent?: string | null;
  sourceSession?: string | null;
  sourceRef?: string | null;
};

type MemoryScopeFilter = {
  projectKey?: string;
  workspaceKey?: string;
  agentName?: string;
};

export type RecallMemoriesInput = {
  query: string;
  agent: string;
  projectKey?: string;
  workspaceKey?: string;
  types?: MemoryItemRow["type"][];
  kinds?: MemoryItemRow["kind"][];
  limit?: number;
};

export type RecallMemoriesDeps = {
  provider: import("./embedding").EmbeddingProvider;
  index: import("./embedding").VectorIndex;
};

export type LinkMemoryInput = {
  memoryId: string;
  relatedMemoryId?: string;
  relationType: MemoryRelationType;
  resourceType?: MemoryResourceType;
  resourceRef?: string;
  resourceRelationType: MemoryResourceRelationType;
};

export type ForgetMemoryInput = {
  reason: MemoryForgetReason;
};

// Verification is a hard authority tier, not a soft relevance hint, so locked
// and confirmed memories outrank anything an agent inferred.
const VERIFICATION_WEIGHT: Record<MemoryItemRow["verification"], number> = {
  locked: 100,
  confirmed: 80,
  observed: 50,
  inferred: 20,
};

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

export function memoryToDto(row: MemoryItemRow): MemoryDto {
  return {
    id: row.id,
    content: row.content,
    type: row.type,
    kind: row.kind,
    scope_type: row.scopeType,
    scope_key: row.scopeKey,
    tier: row.tier,
    verification: row.verification,
    status: row.status,
    importance: row.importance,
    confidence: row.confidence,
    needs_review: row.needsReview,
    review_reason: row.reviewReason,
    created_by_type: row.createdByType,
    source_agent: row.sourceAgent,
    source_session: row.sourceSession,
    source_ref: row.sourceRef,
    valid_from: row.validFrom,
    valid_to: row.validTo,
    access_count: row.accessCount,
    last_accessed_at: row.lastAccessedAt,
    embedding_status: row.embeddingStatus,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function memoryRevisionToDto(
  row: typeof memoryRevisions.$inferSelect,
): MemoryRevisionDto {
  return {
    id: row.id,
    memory_id: row.memoryId,
    content: row.content,
    metadata_snapshot: row.metadataSnapshot,
    created_by_type: row.createdByType,
    created_by_agent: row.createdByAgent,
    created_at: row.createdAt,
  };
}

function memoryRelationToDto(
  row: typeof memoryRelations.$inferSelect,
): MemoryRelationDto {
  return {
    memory_id: row.memoryId,
    related_memory_id: row.relatedMemoryId,
    type: row.type,
    created_at: row.createdAt,
  };
}

function memoryResourceLinkToDto(
  row: typeof memoryResourceLinks.$inferSelect,
): MemoryResourceLinkDto {
  return {
    memory_id: row.memoryId,
    resource_type: row.resourceType,
    resource_ref: row.resourceRef,
    relation_type: row.relationType,
    metadata: row.metadata,
    created_at: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Write Gate helpers
// ---------------------------------------------------------------------------

function normalizeMemoryContent(content: string) {
  return content.trim().replace(/\s+/g, " ");
}

function assertMemoryContentLength(content: string) {
  if (content.length > MEMORY_MAX_CONTENT_LENGTH) {
    throw new ValidationError(
      "Memory content must be 4000 characters or fewer; store long-form content as a memo instead.",
    );
  }
}

/**
 * Reject obvious credential material at write time. This is a high-confidence
 * rule list, not a parser: P0 blocks the clearly dangerous shapes and lets the
 * user's review flow catch subtler secrets.
 */
function assertNoSecrets(content: string) {
  const lowered = content.toLowerCase();
  const markers = [
    "authorization:",
    "authorization bearer",
    "memos_pat_",
    "-----begin rsa private key-----",
    "-----begin private key-----",
    "-----begin pgp private key-----",
    "cookie:",
    "set-cookie:",
    "api_key=",
    "apikey=",
    "client_secret=",
    "password=",
    "passwd=",
  ];
  if (markers.some((marker) => lowered.includes(marker))) {
    throw new ValidationError("MEMORY_SECRET_REJECTED");
  }
}

async function computeFingerprint(
  user: UserRow,
  content: string,
  type: string,
  kind: string,
  scopeType: string,
  scopeKey: string | null,
) {
  const canonical = [
    user.id,
    type,
    kind,
    scopeType,
    scopeKey ?? "",
    content,
  ].join("\u001f");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function resolveVerificationForActor(
  actor: MemoryActor,
  input: MemoryWriteInput,
): MemoryItemRow["verification"] {
  if (actor.type === "user") {
    // The web UI only exposes "create" and "lock at create"; both are user
    // affirmations and therefore confirmed or locked.
    return input.verification === "locked" ? "locked" : "confirmed";
  }
  if (input.verification === "locked" || input.verification === "confirmed") {
    throw new ForbiddenError("Agents cannot lock or confirm memories.");
  }
  return input.verification ?? "observed";
}

function resolveConfidenceForActor(
  actor: MemoryActor,
  input: MemoryWriteInput,
) {
  if (actor.type === "user") return 100;
  return input.confidence;
}

// ---------------------------------------------------------------------------
// Ownership / permission
// ---------------------------------------------------------------------------

async function requireMemory(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<MemoryItemRow> {
  const row = await db
    .select()
    .from(memoryItems)
    .where(and(eq(memoryItems.id, id), eq(memoryItems.userId, user.id)))
    .get();
  if (!row) throw new NotFoundError(`Memory not found: ${id}`);
  return row;
}

function assertAgentCanMutate(actor: MemoryActor, row: MemoryItemRow) {
  if (actor.type !== "agent") return;
  if (row.verification === "locked") {
    throw new ForbiddenError(
      "Agents cannot modify a locked memory; propose a conflict instead.",
    );
  }
  if (row.verification === "confirmed") {
    throw new ForbiddenError(
      "Agents cannot modify a confirmed memory; propose a conflict instead.",
    );
  }
}

async function appendRevision(
  db: FlareMoDb,
  user: UserRow,
  row: MemoryItemRow,
  createdByType: "user" | "agent",
  createdByAgent?: string | null,
) {
  const snapshot: Record<string, unknown> = {
    type: row.type,
    kind: row.kind,
    scope_type: row.scopeType,
    scope_key: row.scopeKey,
    tier: row.tier,
    verification: row.verification,
    status: row.status,
    importance: row.importance,
    confidence: row.confidence,
  };
  await db.insert(memoryRevisions).values({
    id: createResourceId("memories"),
    memoryId: row.id,
    userId: user.id,
    content: row.content,
    metadataSnapshot: snapshot,
    createdByType,
    createdByAgent: createdByAgent ?? null,
    createdAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export async function createMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  input: MemoryWriteInput,
) {
  const content = normalizeMemoryContent(input.content);
  if (!content) throw new ValidationError("Memory content cannot be empty.");
  assertMemoryContentLength(content);
  assertNoSecrets(content);

  const fingerprint = await computeFingerprint(
    user,
    content,
    input.type,
    input.kind,
    input.scopeType,
    input.scopeKey,
  );

  const existing = await db
    .select()
    .from(memoryItems)
    .where(
      and(
        eq(memoryItems.userId, user.id),
        eq(memoryItems.fingerprint, fingerprint),
        sql`${memoryItems.status} != 'deleted'`,
      ),
    )
    .get();
  if (existing) {
    return { duplicate: true as const, memory: memoryToDto(existing) };
  }

  const now = new Date().toISOString();
  const verification = resolveVerificationForActor(actor, input);
  const row = await db
    .insert(memoryItems)
    .values({
      id: createResourceId("memories"),
      userId: user.id,
      content,
      type: input.type,
      kind: input.kind,
      scopeType: input.scopeType,
      scopeKey: input.scopeKey,
      tier: input.tier,
      verification,
      status: "active",
      importance: input.importance,
      confidence: resolveConfidenceForActor(actor, input),
      needsReview: verification === "inferred",
      reviewReason: verification === "inferred" ? "inferred" : null,
      createdByType: actor.type === "user" ? "user" : "agent",
      sourceAgent: actor.type === "agent" ? actor.name : input.sourceAgent,
      sourceSession: input.sourceSession,
      sourceRef: input.sourceRef,
      fingerprint,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  await insertEmbeddingTask(db, {
    userId: user.id,
    resourceType: "memory",
    resourceId: row.id,
    operation: "index",
    createdAt: now,
  });

  return { duplicate: false as const, memory: memoryToDto(row) };
}

export async function updateMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  id: string,
  input: UpdateMemoryInput,
) {
  const existing = await requireMemory(db, user, id);
  assertAgentCanMutate(actor, existing);
  if (existing.status === "deleted") {
    throw new NotFoundError(`Memory not found: ${id}`);
  }

  const next = { ...existing };
  if (input.content !== undefined) {
    next.content = normalizeMemoryContent(input.content);
    if (!next.content)
      throw new ValidationError("Memory content cannot be empty.");
    assertMemoryContentLength(next.content);
    assertNoSecrets(next.content);
  }
  if (input.type !== undefined) next.type = input.type;
  if (input.kind !== undefined) next.kind = input.kind;
  if (input.scope_type !== undefined) next.scopeType = input.scope_type;
  if (input.scope_key !== undefined) next.scopeKey = input.scope_key ?? null;
  if (input.tier !== undefined) next.tier = input.tier;
  if (input.importance !== undefined) next.importance = input.importance;

  next.fingerprint = await computeFingerprint(
    user,
    next.content,
    next.type,
    next.kind,
    next.scopeType,
    next.scopeKey,
  );

  const duplicate = await db
    .select()
    .from(memoryItems)
    .where(
      and(
        eq(memoryItems.userId, user.id),
        eq(memoryItems.fingerprint, next.fingerprint),
        sql`${memoryItems.id} != ${id}`,
        sql`${memoryItems.status} != 'deleted'`,
      ),
    )
    .get();
  if (duplicate) {
    throw new ConflictError("This memory already exists.");
  }

  const now = new Date().toISOString();
  // A user edit is an affirmation: it upgrades observed/inferred to confirmed,
  // while a locked memory stays locked.
  if (actor.type === "user" && existing.verification !== "locked") {
    next.verification = "confirmed";
    next.needsReview = false;
    next.reviewReason = null;
  }

  await appendRevision(
    db,
    user,
    existing,
    actor.type === "user" ? "user" : "agent",
    actor.type === "agent" ? actor.name : null,
  );
  await db
    .update(memoryItems)
    .set({
      content: next.content,
      type: next.type,
      kind: next.kind,
      scopeType: next.scopeType,
      scopeKey: next.scopeKey,
      tier: next.tier,
      verification: next.verification,
      importance: next.importance,
      needsReview: next.needsReview,
      reviewReason: next.reviewReason,
      fingerprint: next.fingerprint,
      updatedAt: now,
    })
    .where(and(eq(memoryItems.id, id), eq(memoryItems.userId, user.id)));

  if (input.content !== undefined) {
    await insertEmbeddingTask(db, {
      userId: user.id,
      resourceType: "memory",
      resourceId: existing.id,
      operation: "reindex",
      createdAt: now,
    });
  }

  const updated = await requireMemory(db, user, id);
  return memoryToDto(updated);
}

// ---------------------------------------------------------------------------
// User-only lifecycle actions
// ---------------------------------------------------------------------------

async function setVerification(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  id: string,
  verification: MemoryItemRow["verification"],
  reason?: string,
) {
  if (actor.type !== "user") {
    throw new ForbiddenError(
      "Only the user may change a memory's verification.",
    );
  }
  const existing = await requireMemory(db, user, id);
  await appendRevision(db, user, existing, "user");
  await db
    .update(memoryItems)
    .set({
      verification,
      needsReview: false,
      reviewReason: reason ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(memoryItems.id, id), eq(memoryItems.userId, user.id)));
  return memoryToDto(await requireMemory(db, user, id));
}

export function confirmMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  id: string,
) {
  return setVerification(db, user, actor, id, "confirmed");
}

export function lockMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  id: string,
) {
  return setVerification(db, user, actor, id, "locked");
}

export function unlockMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  id: string,
) {
  return setVerification(db, user, actor, id, "confirmed");
}

export async function archiveMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  id: string,
) {
  if (actor.type !== "user") {
    throw new ForbiddenError("Only the user may archive a memory.");
  }
  const existing = await requireMemory(db, user, id);
  await appendRevision(db, user, existing, "user");
  await db
    .update(memoryItems)
    .set({
      status: "archived",
      needsReview: false,
      reviewReason: null,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(memoryItems.id, id), eq(memoryItems.userId, user.id)));
  return memoryToDto(await requireMemory(db, user, id));
}

export async function hardDeleteMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  id: string,
) {
  if (actor.type !== "user") {
    throw new ForbiddenError("Only the user may hard-delete a memory.");
  }
  await requireMemory(db, user, id);
  await db
    .delete(memoryItems)
    .where(and(eq(memoryItems.id, id), eq(memoryItems.userId, user.id)));
  await insertEmbeddingTask(db, {
    userId: user.id,
    resourceType: "memory",
    resourceId: id,
    operation: "delete",
    createdAt: new Date().toISOString(),
  });
  return { ok: true };
}

/**
 * `forget` is the agent-facing retirement path. Agents never hard-delete; a
 * "superseded" reason marks the memory superseded, anything else archives it.
 */
export async function forgetMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  id: string,
  input: ForgetMemoryInput,
) {
  const existing = await requireMemory(db, user, id);
  assertAgentCanMutate(actor, existing);
  await appendRevision(
    db,
    user,
    existing,
    actor.type === "user" ? "user" : "agent",
    actor.type === "agent" ? actor.name : null,
  );
  const status: MemoryItemRow["status"] =
    input.reason === "superseded" ? "superseded" : "archived";
  await db
    .update(memoryItems)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(and(eq(memoryItems.id, id), eq(memoryItems.userId, user.id)));
  await insertEmbeddingTask(db, {
    userId: user.id,
    resourceType: "memory",
    resourceId: existing.id,
    operation: "delete",
    createdAt: new Date().toISOString(),
  });
  return memoryToDto(await requireMemory(db, user, id));
}

// ---------------------------------------------------------------------------
// Read / list / search
// ---------------------------------------------------------------------------

export async function getMemory(db: FlareMoDb, user: UserRow, id: string) {
  const row = await requireMemory(db, user, id);
  await db
    .update(memoryItems)
    .set({
      accessCount: row.accessCount + 1,
      lastAccessedAt: new Date().toISOString(),
    })
    .where(and(eq(memoryItems.id, id), eq(memoryItems.userId, user.id)));
  return memoryToDto(await requireMemory(db, user, id));
}

function buildScopeFilter(user: UserRow, filter: MemoryScopeFilter) {
  const scopes: Array<SQL | undefined> = [eq(memoryItems.scopeType, "global")];
  if (filter.projectKey) {
    scopes.push(
      and(
        eq(memoryItems.scopeType, "project"),
        eq(memoryItems.scopeKey, filter.projectKey),
      ),
    );
  }
  if (filter.workspaceKey) {
    scopes.push(
      and(
        eq(memoryItems.scopeType, "workspace"),
        eq(memoryItems.scopeKey, filter.workspaceKey),
      ),
    );
  }
  if (filter.agentName) {
    scopes.push(
      and(
        eq(memoryItems.scopeType, "agent"),
        eq(memoryItems.scopeKey, `agent:${filter.agentName}`),
      ),
    );
  }
  return and(eq(memoryItems.userId, user.id), or(...scopes.filter(Boolean)));
}

function buildFtsCondition(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return undefined;
  const tokens = trimmed.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  // Trigram FTS5 cannot match queries shorter than three characters, so a
  // short or token-less query falls back to a plain LIKE substring match.
  const trigrams = tokens.filter((token) => [...token].length >= 3);
  if (trigrams.length === 0) {
    return sql`${memoryItems.content} LIKE ${`%${escapeLike(trimmed)}%`} ESCAPE '\\'`;
  }
  const match = trigrams
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(" OR ");
  return sql`${memoryItems.id} IN (
    SELECT memory_id FROM memory_fts WHERE memory_fts MATCH ${match}
  )`;
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
    tier?: MemoryItemRow["tier"];
    verification?: MemoryItemRow["verification"];
    status?: MemoryItemRow["status"];
    sourceAgent?: string;
    needsReview?: boolean;
  } = {},
) {
  const filters = [eq(memoryItems.userId, user.id)];
  if (input.q?.trim()) {
    const fts = buildFtsCondition(input.q);
    if (fts) filters.push(fts);
  }
  if (input.type) filters.push(eq(memoryItems.type, input.type));
  if (input.kind) filters.push(eq(memoryItems.kind, input.kind));
  if (input.scopeType) filters.push(eq(memoryItems.scopeType, input.scopeType));
  if (input.scopeKey) filters.push(eq(memoryItems.scopeKey, input.scopeKey));
  if (input.tier) filters.push(eq(memoryItems.tier, input.tier));
  if (input.verification)
    filters.push(eq(memoryItems.verification, input.verification));
  if (input.status) filters.push(eq(memoryItems.status, input.status));
  if (input.sourceAgent)
    filters.push(eq(memoryItems.sourceAgent, input.sourceAgent));
  if (input.needsReview !== undefined)
    filters.push(eq(memoryItems.needsReview, input.needsReview));

  const rows = await db
    .select()
    .from(memoryItems)
    .where(and(...filters))
    .orderBy(desc(memoryItems.updatedAt), desc(memoryItems.id));
  return rows.map(memoryToDto);
}

export async function listMemoryReview(db: FlareMoDb, user: UserRow) {
  const rows = await db
    .select()
    .from(memoryItems)
    .where(
      and(
        eq(memoryItems.userId, user.id),
        or(
          eq(memoryItems.needsReview, true),
          eq(memoryItems.status, "disputed"),
        ),
      ),
    )
    .orderBy(desc(memoryItems.updatedAt), desc(memoryItems.id));
  return rows.map(memoryToDto);
}

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
    .orderBy(desc(memoryRevisions.createdAt));
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
    .orderBy(desc(memoryRelations.createdAt));
  return rows.map(memoryRelationToDto);
}

// ---------------------------------------------------------------------------
// Recall / bootstrap
// ---------------------------------------------------------------------------

function rankMemory(row: MemoryItemRow): number {
  let score =
    VERIFICATION_WEIGHT[row.verification] + row.importance + row.confidence;
  // Episodic memories fade with age; semantic facts, procedures, and decisions
  // must not silently decay out of recall.
  if (row.type === "episodic") {
    const ageDays =
      (Date.now() - new Date(row.updatedAt).getTime()) / 86_400_000;
    score -= Math.min(Math.floor(ageDays / 30), 20);
  }
  return score;
}

export async function recallMemories(
  db: FlareMoDb,
  user: UserRow,
  input: RecallMemoriesInput,
  deps?: RecallMemoriesDeps,
) {
  const scopeFilter = buildScopeFilter(user, {
    projectKey: input.projectKey,
    workspaceKey: input.workspaceKey,
    agentName: input.agent,
  });

  const filters = [
    scopeFilter,
    eq(memoryItems.status, "active"),
    eq(memoryItems.needsReview, false),
  ];
  if (input.types?.length) {
    filters.push(sql`${memoryItems.type} IN ${input.types}`);
  }
  if (input.kinds?.length) {
    filters.push(sql`${memoryItems.kind} IN ${input.kinds}`);
  }

  const rows = await db
    .select()
    .from(memoryItems)
    .where(and(...filters))
    .limit(MEMORY_RECALL_CANDIDATE_LIMIT);

  // Semantic recall takes priority when a provider and index are available
  // and the query has meaning; otherwise fall back to FTS5. A semantic miss
  // must not silently recall unrelated memories by authority alone.
  let candidates = rows;
  let matchedBy: "fts" | "semantic" = "fts";
  if (deps) {
    try {
      const [queryVector] = await deps.provider.embed([input.query]);
      if (queryVector && queryVector.length > 0) {
        const matches = await deps.index.query(
          queryVector,
          MEMORY_RECALL_CANDIDATE_LIMIT,
        );
        const matchedIds = new Set(matches.map((match) => match.id));
        candidates = rows.filter((row) => matchedIds.has(row.id));
        matchedBy = "semantic";
      }
    } catch {
      // Semantic recall is degradable: fall back to the FTS path on any
      // provider or index failure.
      matchedBy = "fts";
    }
  } else {
    const withText = buildFtsCondition(input.query);
    if (withText) {
      const matchedIds = new Set(
        (
          await db
            .select({ id: memoryItems.id })
            .from(memoryItems)
            .where(and(...filters, withText))
            .limit(MEMORY_RECALL_CANDIDATE_LIMIT)
        ).map((row) => row.id),
      );
      // A query that matches nothing via FTS should not silently recall by
      // authority alone; return the empty set rather than unrelated memories.
      candidates = rows.filter((row) => matchedIds.has(row.id));
    }
  }

  candidates.sort((a, b) => rankMemory(b) - rankMemory(a));
  const limit = Math.min(
    input.limit ?? MEMORY_DEFAULT_RECALL_LIMIT,
    MEMORY_MAX_RECALL_LIMIT,
  );
  return candidates.slice(0, limit).map((row) => ({
    id: row.id,
    content: row.content,
    type: row.type,
    kind: row.kind,
    scope: row.scopeType,
    scope_key: row.scopeKey,
    tier: row.tier,
    verification: row.verification,
    importance: row.importance,
    source: row.sourceRef,
    source_agent: row.sourceAgent,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    score: rankMemory(row),
    matched_by: matchedBy,
  }));
}

export async function bootstrapMemory(
  db: FlareMoDb,
  user: UserRow,
  input: {
    agent: string;
    projectKey?: string;
    workspaceKey?: string;
    maxItems?: number;
  },
) {
  const scopeFilter = buildScopeFilter(user, {
    projectKey: input.projectKey,
    workspaceKey: input.workspaceKey,
    agentName: input.agent,
  });

  const rows = await db
    .select()
    .from(memoryItems)
    .where(
      and(
        scopeFilter,
        eq(memoryItems.status, "active"),
        eq(memoryItems.needsReview, false),
      ),
    )
    .orderBy(desc(memoryItems.updatedAt), desc(memoryItems.id));

  // Core memories and locked/confirmed constraints are the highest-value
  // bootstrap context; fill the remaining budget with recent lessons.
  const core = rows.filter((row) => row.tier === "core");
  const constraints = rows.filter(
    (row) =>
      row.kind === "constraint" &&
      (row.verification === "locked" || row.verification === "confirmed"),
  );
  const decisions = rows.filter(
    (row) =>
      row.kind === "decision" &&
      (row.verification === "locked" || row.verification === "confirmed"),
  );
  const rest = rows.filter(
    (row) =>
      row.tier !== "core" &&
      row.kind !== "constraint" &&
      row.kind !== "decision",
  );

  const maxItems = Math.min(
    input.maxItems ?? MEMORY_DEFAULT_BOOTSTRAP_MAX_ITEMS,
    MEMORY_DEFAULT_BOOTSTRAP_MAX_ITEMS,
  );
  const selected: MemoryItemRow[] = [];
  const seen = new Set<string>();
  const push = (row: MemoryItemRow) => {
    if (!seen.has(row.id) && selected.length < maxItems) {
      seen.add(row.id);
      selected.push(row);
    }
  };
  for (const group of [core, constraints, decisions, rest]) {
    group.sort((a, b) => rankMemory(b) - rankMemory(a));
    for (const row of group) push(row);
  }

  const items = selected
    .sort((a, b) => rankMemory(b) - rankMemory(a))
    .map((row) => ({
      id: row.id,
      content: row.content,
      type: row.type,
      kind: row.kind,
      scope: row.scopeType,
      scope_key: row.scopeKey,
      tier: row.tier,
      verification: row.verification,
      importance: row.importance,
      source: row.sourceRef,
      source_agent: row.sourceAgent,
    }));

  let total = 0;
  const trimmed: typeof items = [];
  for (const item of items) {
    if (total + item.content.length > MEMORY_BOOTSTRAP_CHAR_BUDGET) break;
    total += item.content.length;
    trimmed.push(item);
  }

  return { items: trimmed };
}

// ---------------------------------------------------------------------------
// Checkpoint / link
// ---------------------------------------------------------------------------

export async function checkpointMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  input: CheckpointInput,
) {
  const scopeKey = input.scope_key ?? input.project_key ?? null;
  const episode = await createMemory(db, user, actor, {
    content: input.summary,
    type: "episodic",
    kind: "event",
    scopeType: input.scope_type,
    scopeKey,
    tier: "normal",
    importance: 50,
    confidence: actor.type === "user" ? 100 : 50,
    verification: actor.type === "user" ? "confirmed" : "observed",
    sourceAgent: actor.type === "agent" ? actor.name : null,
  });

  if (episode.duplicate) {
    throw new ConflictError("This checkpoint already exists.");
  }

  const episodeId = episode.memory.id;
  const createdIds: string[] = [];
  for (const item of input.items) {
    const result = await createMemory(db, user, actor, {
      content: item.content,
      type: item.type,
      kind: item.kind,
      scopeType: input.scope_type,
      scopeKey,
      tier: "normal",
      importance: item.importance,
      confidence: actor.type === "user" ? 100 : 50,
      verification: actor.type === "user" ? "confirmed" : "observed",
      sourceAgent: actor.type === "agent" ? actor.name : null,
    });
    const itemId = result.memory.id;
    createdIds.push(itemId);
    await db
      .insert(memoryRelations)
      .values({
        id: createResourceId("memories"),
        memoryId: itemId,
        relatedMemoryId: episodeId,
        userId: user.id,
        type: "related_to",
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing();
  }

  return {
    episode: episode.memory,
    items: createdIds,
  };
}

export async function linkMemory(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  input: LinkMemoryInput,
) {
  const memory = await requireMemory(db, user, input.memoryId);
  assertAgentCanMutate(actor, memory);

  const relations: MemoryRelationDto[] = [];
  const resourceLinks: MemoryResourceLinkDto[] = [];

  if (input.relatedMemoryId) {
    const related = await requireMemory(db, user, input.relatedMemoryId);
    if (input.relationType === "supersedes") {
      assertAgentCanMutate(actor, related);
      await db
        .update(memoryItems)
        .set({ status: "superseded", updatedAt: new Date().toISOString() })
        .where(
          and(eq(memoryItems.id, related.id), eq(memoryItems.userId, user.id)),
        );
    }
    const inserted = await db
      .insert(memoryRelations)
      .values({
        id: createResourceId("memories"),
        memoryId: memory.id,
        relatedMemoryId: related.id,
        userId: user.id,
        type: input.relationType,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .returning()
      .get();
    if (inserted) relations.push(memoryRelationToDto(inserted));
  }

  if (input.resourceType && input.resourceRef) {
    const inserted = await db
      .insert(memoryResourceLinks)
      .values({
        id: createResourceId("memories"),
        memoryId: memory.id,
        userId: user.id,
        resourceType: input.resourceType,
        resourceRef: input.resourceRef,
        relationType: input.resourceRelationType,
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();
    resourceLinks.push(memoryResourceLinkToDto(inserted));
  }

  return { relations, resource_links: resourceLinks };
}

// ---------------------------------------------------------------------------
// REST input adapters
// ---------------------------------------------------------------------------

export function createMemoryInputToWrite(
  input: CreateMemoryInput,
): MemoryWriteInput {
  return {
    content: input.content,
    type: input.type,
    kind: input.kind,
    scopeType: input.scope_type,
    scopeKey: input.scope_key ?? null,
    tier: input.tier,
    importance: input.importance,
    confidence: 100,
    verification: input.lock ? "locked" : "confirmed",
  };
}

export function createMemoryFromMemoInputToWrite(
  input: CreateMemoryFromMemoInput,
  fallbackContent: string,
): MemoryWriteInput {
  return {
    content: input.content ?? fallbackContent,
    type: input.type,
    kind: input.kind,
    scopeType: input.scope_type,
    scopeKey: input.scope_key ?? null,
    tier: input.tier,
    importance: input.importance,
    confidence: 100,
    verification: input.lock ? "locked" : "confirmed",
  };
}

export function rememberInputToWrite(input: RememberInput): MemoryWriteInput {
  return {
    content: input.content,
    type: input.type,
    kind: input.kind,
    scopeType: input.scope_type,
    scopeKey: input.scope_key ?? null,
    tier: input.tier,
    importance: input.importance,
    confidence: input.confidence,
    verification: input.verification,
    sourceAgent: input.source_agent,
    sourceSession: input.source_session,
    sourceRef: input.source_ref,
  };
}

function escapeLike(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

// ---------------------------------------------------------------------------
// Memo ↔ Memory linking
// ---------------------------------------------------------------------------

/**
 * Return the memories derived from or referencing a memo, ordered by most
 * recently updated. The memo page uses this to surface "related memories".
 */
export async function listMemoriesForMemo(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
): Promise<MemoryDto[]> {
  const links = await db
    .select()
    .from(memoryResourceLinks)
    .where(
      and(
        eq(memoryResourceLinks.userId, user.id),
        eq(memoryResourceLinks.resourceType, "memo"),
        eq(memoryResourceLinks.resourceRef, memoId),
      ),
    );

  const memoryIds = [...new Set(links.map((link) => link.memoryId))];
  if (memoryIds.length === 0) return [];

  const rows = await db
    .select()
    .from(memoryItems)
    .where(
      and(
        eq(memoryItems.userId, user.id),
        sql`${memoryItems.id} IN ${memoryIds}`,
        sql`${memoryItems.status} != 'deleted'`,
      ),
    )
    .orderBy(desc(memoryItems.updatedAt));
  return rows.map(memoryToDto);
}

/**
 * Promote a memo's conclusion into a long-term memory, recording a
 * `derived_from` link back to the source memo.
 */
export async function createMemoryFromMemo(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  input: MemoryWriteInput,
  memoId: string,
) {
  const result = await createMemory(db, user, actor, input);
  if (result.duplicate) {
    // The same conclusion already exists; still record the derivation link if
    // this exact memo is not already linked.
    await db
      .insert(memoryResourceLinks)
      .values({
        id: createResourceId("memories"),
        memoryId: result.memory.id,
        userId: user.id,
        resourceType: "memo",
        resourceRef: memoId,
        relationType: "derived_from",
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing();
    return result;
  }

  await db.insert(memoryResourceLinks).values({
    id: createResourceId("memories"),
    memoryId: result.memory.id,
    userId: user.id,
    resourceType: "memo",
    resourceRef: memoId,
    relationType: "derived_from",
    createdAt: new Date().toISOString(),
  });
  return result;
}

/**
 * Promote a memory back into a normal memo, recording a `promoted_to` link.
 * The source memory stays in place; the memo becomes the long-form version.
 */
export async function promoteMemoryToMemo(
  db: FlareMoDb,
  user: UserRow,
  actor: MemoryActor,
  memoryId: string,
): Promise<{ memory: MemoryDto; memo: string }> {
  const memory = await requireMemory(db, user, memoryId);
  assertAgentCanMutate(actor, memory);

  const memo = await createMemo(db, user, {
    content: memory.content,
    visibility: "private",
    source: "memory",
  });

  await db.insert(memoryResourceLinks).values({
    id: createResourceId("memories"),
    memoryId: memory.id,
    userId: user.id,
    resourceType: "memo",
    resourceRef: memo.id,
    relationType: "promoted_to",
    createdAt: new Date().toISOString(),
  });

  return { memory: memoryToDto(memory), memo: memo.id };
}
