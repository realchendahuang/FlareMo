import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";

// Legacy Agent Memory tables. The product feature was removed; these tables
// stay for one release so the migration is non-destructive, then drop.
//
// Agent Memory kept AI-contributed long-term knowledge separate from the
// user's memo timeline. Each memory is an atomic conclusion (see
// docs/product-requirements.md and the Agent Memory Ledger design); long-form content
// belongs in a memo, and a memory's `content` only stores the conclusion.
// D1 remains the single source of truth: FTS, relations, and any future embedding index
// are derived and rebuildable from these rows.
export const memoryItems = sqliteTable(
  "memory_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    type: text("type", {
      enum: ["semantic", "episodic", "procedural"],
    })
      .notNull()
      .default("semantic"),
    kind: text("kind", {
      enum: [
        "preference",
        "fact",
        "decision",
        "constraint",
        "entity",
        "event",
        "outcome",
        "lesson",
        "procedure",
      ],
    })
      .notNull()
      .default("fact"),
    scopeType: text("scope_type", {
      enum: ["global", "workspace", "project", "agent"],
    })
      .notNull()
      .default("global"),
    scopeKey: text("scope_key"),
    // Deterministic fact key for versioning & supersession (1-to-1)
    factKey: text("fact_key"),
    // Non-hierarchical topic tags for navigation (many-to-many)
    tags: text("tags", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    tier: text("tier", { enum: ["core", "normal"] })
      .notNull()
      .default("normal"),
    verification: text("verification", {
      enum: ["inferred", "observed", "confirmed", "locked"],
    })
      .notNull()
      .default("observed"),
    status: text("status", {
      enum: ["active", "superseded", "disputed", "archived", "deleted"],
    })
      .notNull()
      .default("active"),
    importance: integer("importance").notNull().default(50),
    confidence: integer("confidence").notNull().default(50),
    needsReview: integer("needs_review", { mode: "boolean" })
      .notNull()
      .default(false),
    reviewReason: text("review_reason"),
    createdByType: text("created_by_type", { enum: ["user", "agent"] })
      .notNull()
      .default("agent"),
    sourceAgent: text("source_agent"),
    sourceSession: text("source_session"),
    sourceRef: text("source_ref"),
    // Bi-temporal validity
    observedAt: text("observed_at"),
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    expiresAt: text("expires_at"),
    supersededById: text("superseded_by_id"),
    supersededAt: text("superseded_at"),
    // Caller-supplied retry key: a repeat write returns the first row instead of
    // creating a twin. The unique index below is the final idempotency boundary.
    idempotencyKey: text("idempotency_key"),
    // Set when a user rejects a proposal. Rejection is terminal for the review
    // inbox: `verification` moves off `inferred` so the card cannot reappear,
    // while this timestamp keeps "rejected, and when" auditable.
    rejectedAt: text("rejected_at"),
    // Normalized content + type + kind + scope hash, used to reject exact
    // duplicates without an embedding index. The unique index below only
    // guards *active* rows: an archived or rejected judgment must not block
    // re-establishing the same fact later.
    fingerprint: text("fingerprint").notNull(),
    accessCount: integer("access_count").notNull().default(0),
    lastAccessedAt: text("last_accessed_at"),
    // Memory embeddings index into the memories vector index under the
    // owner's namespace; `not_indexed` is the pre-embedding state.
    embeddingStatus: text("embedding_status", {
      enum: ["not_indexed", "pending", "indexed", "error"],
    })
      .notNull()
      .default("not_indexed"),
    embeddingVersion: text("embedding_version"),
    embeddedAt: text("embedded_at"),
    embeddingError: text("embedding_error"),
    // Chunk count at last successful index (memories are single atomic
    // vectors, so this is 1 when indexed).
    embeddingChunks: integer("embedding_chunks"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("memory_items_user_scope_status_idx").on(
      table.userId,
      table.scopeType,
      table.scopeKey,
      table.status,
    ),
    index("memory_items_user_scope_fact_key_idx").on(
      table.userId,
      table.scopeType,
      table.scopeKey,
      table.factKey,
    ),
    index("memory_items_user_type_kind_idx").on(
      table.userId,
      table.type,
      table.kind,
    ),
    index("memory_items_user_tier_idx").on(table.userId, table.tier),
    // The memory list and the review inbox both page by
    // (user_id, updated_at DESC, id DESC); without this the whole user's
    // memory set is read and sorted on every request.
    index("memory_items_user_updated_id_idx").on(
      table.userId,
      table.updatedAt,
      table.id,
    ),
    uniqueIndex("memory_items_user_fingerprint_idx")
      .on(table.userId, table.fingerprint)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex("memory_items_user_fact_key_active_idx")
      .on(table.userId, table.factKey)
      .where(
        sql`${table.status} = 'active' AND ${table.verification} != 'inferred' AND ${table.factKey} IS NOT NULL`,
      ),
    uniqueIndex("memory_items_user_idempotency_idx")
      .on(table.userId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    // `getMemoryLineage` reads a superseded chain by (user_id, fact_key) and
    // orders by created_at. The scope index above puts fact_key behind the
    // scope columns, and the unique active-only index cannot serve superseded
    // rows, so both missed the predicate.
    index("memory_items_user_fact_key_created_idx").on(
      table.userId,
      table.factKey,
      table.createdAt,
    ),
    // The two daily maintenance sweeps filter globally (not per user), so
    // neither user-leading index above can serve them. These partial indexes
    // cover exactly the predicates in expireStaleInferredProposals and
    // reclaimStaleMemoryVectors.
    index("memory_items_inferred_review_sweep_idx")
      .on(table.createdAt)
      .where(
        sql`${table.verification} = 'inferred' AND ${table.status} = 'active' AND ${table.needsReview} = 1`,
      ),
    index("memory_items_vector_reclaim_sweep_idx")
      .on(table.embeddingStatus)
      .where(sql`${table.embeddingStatus} IN ('indexed', 'pending', 'error')`),
    // sinkDormantObservedMemories filters globally on the dormancy predicate
    // (never recalled, or last recalled before a cutoff) and had no index at
    // all — a full scan of the largest memory table on every daily sweep.
    index("memory_items_dormant_sweep_idx")
      .on(table.lastAccessedAt, table.createdAt)
      .where(
        sql`${table.status} = 'active' AND ${table.verification} = 'observed' AND ${table.needsReview} = 0`,
      ),
  ],
);

export const memoryRevisions = sqliteTable(
  "memory_revisions",
  {
    id: text("id").primaryKey(),
    memoryId: text("memory_id")
      .notNull()
      .references(() => memoryItems.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    metadataSnapshot: text("metadata_snapshot", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdByType: text("created_by_type", {
      enum: ["user", "agent"],
    }).notNull(),
    createdByAgent: text("created_by_agent"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("memory_revisions_memory_created_idx").on(
      table.memoryId,
      table.createdAt,
    ),
    index("memory_revisions_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const memoryRelations = sqliteTable(
  "memory_relations",
  {
    id: text("id").primaryKey(),
    memoryId: text("memory_id")
      .notNull()
      .references(() => memoryItems.id, { onDelete: "cascade" }),
    relatedMemoryId: text("related_memory_id")
      .notNull()
      .references(() => memoryItems.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: [
        "related_to",
        "supports",
        "contradicts",
        "supersedes",
        "depends_on",
        "part_of",
      ],
    })
      .notNull()
      .default("related_to"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("memory_relations_memory_related_type_idx").on(
      table.memoryId,
      table.relatedMemoryId,
      table.type,
    ),
    index("memory_relations_related_idx").on(table.relatedMemoryId, table.type),
  ],
);

export const memoryResourceLinks = sqliteTable(
  "memory_resource_links",
  {
    id: text("id").primaryKey(),
    memoryId: text("memory_id")
      .notNull()
      .references(() => memoryItems.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resourceType: text("resource_type", {
      enum: ["memo", "session", "github", "url", "document", "other"],
    }).notNull(),
    resourceRef: text("resource_ref").notNull(),
    relationType: text("relation_type", {
      enum: ["derived_from", "evidence", "references", "promoted_to"],
    })
      .notNull()
      .default("derived_from"),
    metadata: text("metadata", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("memory_resource_links_memory_idx").on(table.memoryId),
    index("memory_resource_links_resource_idx").on(
      table.resourceType,
      table.resourceRef,
    ),
  ],
);

export const memoryEvidence = sqliteTable(
  "memory_evidence",
  {
    id: text("id").primaryKey(),
    memoryId: text("memory_id")
      .notNull()
      .references(() => memoryItems.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceType: text("source_type", {
      enum: ["memo", "session", "github", "url", "document", "manual", "other"],
    }).notNull(),
    sourceId: text("source_id").notNull(),
    sourceRevision: text("source_revision"),
    relationType: text("relation_type", {
      enum: ["derived_from", "evidence_for", "contradicts", "references"],
    })
      .notNull()
      .default("derived_from"),
    observedAt: text("observed_at"),
    excerpt: text("excerpt"),
    excerptHash: text("excerpt_hash"),
    // Evidence staleness (§VI.1): the daily sweep re-hashes memo-backed
    // evidence; `stale_at` marks a changed source, `missing_at` a vanished
    // one. Neither is ever cleared automatically — only re-taking evidence
    // or retiring the memory clears them.
    staleAt: text("stale_at"),
    missingAt: text("missing_at"),
    metadata: text("metadata", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("memory_evidence_memory_idx").on(table.memoryId),
    index("memory_evidence_memory_created_idx").on(
      table.memoryId,
      table.createdAt,
    ),
    index("memory_evidence_source_idx").on(table.sourceType, table.sourceId),
    index("memory_evidence_user_idx").on(table.userId),
  ],
);

export const memoryEvents = sqliteTable(
  "memory_events",
  {
    id: text("id").primaryKey(),
    memoryId: text("memory_id")
      .notNull()
      .references(() => memoryItems.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventType: text("event_type", {
      enum: [
        "created",
        "confirmed",
        "locked",
        "unlocked",
        "challenged",
        "superseded",
        "archived",
        "restored",
      ],
    }).notNull(),
    actorType: text("actor_type", { enum: ["user", "agent"] }).notNull(),
    actorName: text("actor_name"),
    metadata: text("metadata", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("memory_events_memory_created_idx").on(
      table.memoryId,
      table.createdAt,
    ),
    index("memory_events_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const memoryRejections = sqliteTable(
  "memory_rejections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scopeType: text("scope_type", {
      enum: ["global", "workspace", "project", "agent"],
    }).notNull(),
    scopeKey: text("scope_key"),
    factKey: text("fact_key"),
    rejectedContent: text("rejected_content").notNull(),
    fingerprint: text("fingerprint").notNull(),
    reason: text("reason"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("memory_rejections_user_scope_fact_idx").on(
      table.userId,
      table.scopeType,
      table.scopeKey,
      table.factKey,
    ),
    index("memory_rejections_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

// Injection archive (§VI.7): every *actual* injection to an agent is recorded
// with the exact rendered payload, so the lens can show "上次实际注入" from the
// archive rather than a re-derivation, and erasure can scrub retired content
// out of past payloads. The web lens preview deliberately does NOT archive.
export const memoryCompileArchives = sqliteTable(
  "memory_compile_archives",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agent: text("agent"),
    projectKey: text("project_key"),
    workspaceKey: text("workspace_key"),
    payload: text("payload").notNull(),
    characterCount: integer("character_count").notNull(),
    hasOverflow: integer("has_overflow", { mode: "boolean" }).notNull(),
    pinnedOverflow: integer("pinned_overflow", { mode: "boolean" }).notNull(),
    includedIds: text("included_ids", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    truncatedIds: text("truncated_ids", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    // Items the user unticked for this injection only ("勾掉 = 仅本次排除").
    excludedIds: text("excluded_ids", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("memory_compile_archives_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);
