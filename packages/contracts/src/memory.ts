import { z } from "zod";

// --- Domain enums -----------------------------------------------------------

export const memoryTypeSchema = z.enum(["semantic", "episodic", "procedural"]);

export const memoryKindSchema = z.enum([
  "preference",
  "fact",
  "decision",
  "constraint",
  "entity",
  "event",
  "outcome",
  "lesson",
  "procedure",
]);

export const memoryScopeTypeSchema = z.enum([
  "global",
  "workspace",
  "project",
  "agent",
]);

export const memoryTierSchema = z.enum(["core", "normal"]);

export const memoryVerificationSchema = z.enum([
  "inferred",
  "observed",
  "confirmed",
  "locked",
]);

export const memoryStatusSchema = z.enum([
  "active",
  "superseded",
  "disputed",
  "archived",
  "deleted",
]);

export const memoryRelationTypeSchema = z.enum([
  "related_to",
  "supports",
  "contradicts",
  "supersedes",
  "depends_on",
  "part_of",
]);

export const memoryResourceTypeSchema = z.enum([
  "memo",
  "session",
  "github",
  "url",
  "document",
  "other",
]);

export const memoryResourceRelationTypeSchema = z.enum([
  "derived_from",
  "evidence",
  "references",
  "promoted_to",
]);

export const memoryEvidenceSourceTypeSchema = z.enum([
  "memo",
  "session",
  "github",
  "url",
  "document",
  "manual",
  "other",
]);

export const memoryEvidenceRelationTypeSchema = z.enum([
  "derived_from",
  "evidence_for",
  "contradicts",
  "references",
]);

export const memoryEventTypeSchema = z.enum([
  "created",
  "confirmed",
  "locked",
  "unlocked",
  "challenged",
  "superseded",
  "archived",
  "restored",
]);

export const memoryCreatedByTypeSchema = z.enum(["user", "agent"]);

export const memoryEmbeddingStatusSchema = z.enum([
  "not_indexed",
  "pending",
  "indexed",
  "error",
]);

export const memoryForgetReasonSchema = z.enum([
  "incorrect",
  "superseded",
  "expired",
  "irrelevant",
]);

export const memoryMatchPathSchema = z.enum([
  "fact_key",
  "keyword",
  "vector",
  "relation",
]);

export const resolveProposalActionSchema = z.enum([
  "accept",
  "reject",
  "modify",
]);

// --- DTO --------------------------------------------------------------------

export const memoryEvidenceDtoSchema = z.object({
  id: z.string(),
  memory_id: z.string(),
  source_type: memoryEvidenceSourceTypeSchema,
  source_id: z.string(),
  source_revision: z.string().nullable(),
  relation_type: memoryEvidenceRelationTypeSchema,
  observed_at: z.string().nullable(),
  excerpt: z.string().nullable(),
  excerpt_hash: z.string().nullable(),
  // Evidence staleness (§VI.1): source content changed / source vanished.
  // Both are set only by the daily sweep; neither auto-clears.
  stale_at: z.string().nullable().optional(),
  missing_at: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});

export const memoryEventDtoSchema = z.object({
  id: z.string(),
  memory_id: z.string(),
  event_type: memoryEventTypeSchema,
  actor_type: memoryCreatedByTypeSchema,
  actor_name: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});

export const memoryRejectionDtoSchema = z.object({
  id: z.string(),
  scope_type: memoryScopeTypeSchema,
  scope_key: z.string().nullable(),
  fact_key: z.string().nullable(),
  rejected_content: z.string(),
  fingerprint: z.string(),
  reason: z.string().nullable(),
  created_at: z.string(),
});

export const memoryDtoSchema = z.object({
  id: z.string(),
  content: z.string(),
  type: memoryTypeSchema,
  kind: memoryKindSchema,
  scope_type: memoryScopeTypeSchema,
  scope_key: z.string().nullable(),
  fact_key: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  tier: memoryTierSchema,
  verification: memoryVerificationSchema,
  status: memoryStatusSchema,
  importance: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  needs_review: z.boolean(),
  review_reason: z.string().nullable(),
  created_by_type: memoryCreatedByTypeSchema,
  source_agent: z.string().nullable(),
  source_session: z.string().nullable(),
  source_ref: z.string().nullable(),
  valid_from: z.string().nullable(),
  valid_to: z.string().nullable(),
  observed_at: z.string().nullable().default(null),
  expires_at: z.string().nullable().default(null),
  superseded_by_id: z.string().nullable().default(null),
  superseded_at: z.string().nullable().default(null),
  rejected_at: z.string().nullable().default(null),
  access_count: z.number().int(),
  last_accessed_at: z.string().nullable(),
  embedding_status: memoryEmbeddingStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
  evidence: z.array(memoryEvidenceDtoSchema).optional(),
  // Review inbox only: the memory this item would replace or contradicts.
  conflict_with: z
    .object({
      id: z.string(),
      content: z.string(),
      verification: memoryVerificationSchema,
    })
    .nullable()
    .optional(),
});

export const memoryRevisionDtoSchema = z.object({
  id: z.string(),
  memory_id: z.string(),
  content: z.string(),
  metadata_snapshot: z.record(z.string(), z.unknown()),
  created_by_type: memoryCreatedByTypeSchema,
  created_by_agent: z.string().nullable(),
  created_at: z.string(),
});

export const memoryRelationDtoSchema = z.object({
  memory_id: z.string(),
  related_memory_id: z.string(),
  type: memoryRelationTypeSchema,
  created_at: z.string(),
});

export const memoryResourceLinkDtoSchema = z.object({
  memory_id: z.string(),
  resource_type: memoryResourceTypeSchema,
  resource_ref: z.string(),
  relation_type: memoryResourceRelationTypeSchema,
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});

export const memoryRecallItemSchema = z.object({
  memory: memoryDtoSchema,
  score: z.number(),
  match_paths: z.array(memoryMatchPathSchema),
  evidence: z.array(memoryEvidenceDtoSchema).optional(),
});

export const memoryRecallResponseSchema = z.object({
  items: z.array(memoryRecallItemSchema),
  query: z.string(),
  total: z.number().int(),
});

export const memoryLineageDtoSchema = z.object({
  current: memoryDtoSchema,
  chain: z.array(memoryDtoSchema),
  revisions: z.array(memoryRevisionDtoSchema),
  evidence: z.array(memoryEvidenceDtoSchema),
  events: z.array(memoryEventDtoSchema),
});

export const compiledMemoryDtoSchema = z.object({
  system_prompt_payload: z.string(),
  character_count: z.number().int(),
  estimated_tokens: z.number().int(),
  included_items: z.array(memoryDtoSchema),
  truncated_items: z.array(memoryDtoSchema),
  has_overflow: z.boolean(),
  // True when pinned rules alone exceeded the budget: the projection is complete
  // in authority but the caller must warn the user that nothing else fit.
  pinned_overflow: z.boolean().default(false),
});

// Injection archive (§VI.7): the audit record of one actual agent injection.
export const memoryCompileArchiveDtoSchema = z.object({
  id: z.string(),
  agent: z.string().nullable(),
  project_key: z.string().nullable(),
  workspace_key: z.string().nullable(),
  payload: z.string(),
  character_count: z.number().int(),
  has_overflow: z.boolean(),
  pinned_overflow: z.boolean(),
  included_ids: z.array(z.string()),
  truncated_ids: z.array(z.string()),
  excluded_ids: z.array(z.string()),
  created_at: z.string(),
});

// --- Export / import --------------------------------------------------------

export const exportMemorySchema = z.object({
  name: z.string(),
  content: z.string(),
  type: memoryTypeSchema,
  kind: memoryKindSchema,
  scope_type: memoryScopeTypeSchema,
  scope_key: z.string().nullable(),
  fact_key: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  tier: memoryTierSchema,
  verification: memoryVerificationSchema,
  status: memoryStatusSchema,
  importance: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  needs_review: z.boolean(),
  review_reason: z.string().nullable(),
  created_by_type: memoryCreatedByTypeSchema,
  source_agent: z.string().nullable(),
  source_session: z.string().nullable(),
  source_ref: z.string().nullable(),
  valid_from: z.string().nullable(),
  valid_to: z.string().nullable(),
  observed_at: z.string().nullable().optional(),
  expires_at: z.string().nullable().optional(),
  superseded_by_id: z.string().nullable().optional(),
  superseded_at: z.string().nullable().optional(),
  rejected_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const importMemorySchema = exportMemorySchema.partial({
  created_at: true,
  updated_at: true,
});

export const exportMemoryRevisionSchema = z.object({
  name: z.string(),
  memory_id: z.string(),
  content: z.string(),
  metadata_snapshot: z.record(z.string(), z.unknown()),
  created_by_type: memoryCreatedByTypeSchema,
  created_by_agent: z.string().nullable(),
  created_at: z.string(),
});

export const exportMemoryRelationSchema = z.object({
  memory_id: z.string(),
  related_memory_id: z.string(),
  type: memoryRelationTypeSchema,
  created_at: z.string(),
});

export const exportMemoryResourceLinkSchema = z.object({
  memory_id: z.string(),
  resource_type: memoryResourceTypeSchema,
  resource_ref: z.string(),
  relation_type: memoryResourceRelationTypeSchema,
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});

export const exportMemoryEvidenceSchema = z.object({
  memory_id: z.string(),
  source_type: memoryEvidenceSourceTypeSchema,
  source_id: z.string(),
  source_revision: z.string().nullable().optional(),
  relation_type: memoryEvidenceRelationTypeSchema,
  observed_at: z.string().nullable().optional(),
  excerpt: z.string().nullable().optional(),
  excerpt_hash: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  created_at: z.string(),
});

export const exportMemoryEventSchema = z.object({
  memory_id: z.string(),
  event_type: memoryEventTypeSchema,
  actor_type: memoryCreatedByTypeSchema,
  actor_name: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  created_at: z.string(),
});

// --- REST request schemas ---------------------------------------------------

export const createMemorySchema = z.object({
  content: z.string().trim().min(1).max(4_000),
  fact_key: z.string().trim().max(256).optional(),
  tags: z.array(z.string().trim().max(64)).optional(),
  type: memoryTypeSchema.default("semantic"),
  kind: memoryKindSchema.default("fact"),
  scope_type: memoryScopeTypeSchema.default("global"),
  scope_key: z.string().trim().max(512).optional(),
  tier: memoryTierSchema.default("normal"),
  importance: z.number().int().min(0).max(100).default(50),
  lock: z.boolean().default(false),
  valid_from: z.string().optional(),
  valid_to: z.string().optional(),
  observed_at: z.string().optional(),
  expires_at: z.string().optional(),
  evidence: z
    .array(
      z.object({
        source_type: memoryEvidenceSourceTypeSchema.default("manual"),
        source_id: z.string().min(1),
        source_revision: z.string().optional(),
        relation_type: memoryEvidenceRelationTypeSchema.default("derived_from"),
        observed_at: z.string().optional(),
        excerpt: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
});

export const createMemoryFromMemoSchema = z.object({
  content: z.string().trim().min(1).max(4_000).optional(),
  fact_key: z.string().trim().max(256).optional(),
  tags: z.array(z.string().trim().max(64)).optional(),
  type: memoryTypeSchema.default("semantic"),
  kind: memoryKindSchema.default("fact"),
  scope_type: memoryScopeTypeSchema.default("global"),
  scope_key: z.string().trim().max(512).optional(),
  tier: memoryTierSchema.default("normal"),
  importance: z.number().int().min(0).max(100).default(50),
  lock: z.boolean().default(false),
  valid_from: z.string().optional(),
  valid_to: z.string().optional(),
});

export const updateMemorySchema = z
  .object({
    content: z.string().trim().min(1).max(4_000).optional(),
    fact_key: z.string().trim().max(256).nullable().optional(),
    tags: z.array(z.string().trim().max(64)).optional(),
    type: memoryTypeSchema.optional(),
    kind: memoryKindSchema.optional(),
    scope_type: memoryScopeTypeSchema.optional(),
    scope_key: z.string().trim().max(512).optional(),
    tier: memoryTierSchema.optional(),
    importance: z.number().int().min(0).max(100).optional(),
    valid_from: z.string().nullable().optional(),
    valid_to: z.string().nullable().optional(),
    expires_at: z.string().nullable().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field must be updated.",
  );

export const listMemoriesQuerySchema = z.object({
  page_size: z.coerce.number().int().min(1).max(100).default(30),
  page_token: z.string().optional(),
  q: z.string().trim().max(500).optional(),
  type: memoryTypeSchema.optional(),
  kind: memoryKindSchema.optional(),
  scope_type: memoryScopeTypeSchema.optional(),
  scope_key: z.string().trim().max(512).optional(),
  fact_key: z.string().trim().max(256).optional(),
  tier: memoryTierSchema.optional(),
  verification: memoryVerificationSchema.optional(),
  status: memoryStatusSchema.optional(),
  source_agent: z.string().trim().max(128).optional(),
  needs_review: z.coerce.boolean().optional(),
  as_of: z.string().optional(),
});

// --- MCP / CLI input schemas ------------------------------------------------

export const bootstrapInputSchema = z.object({
  agent: z.string().trim().min(1).max(128),
  project_key: z.string().trim().max(512).optional(),
  workspace_key: z.string().trim().max(512).optional(),
  cwd: z.string().trim().max(1_024).optional(),
  task: z.string().trim().max(4_000).optional(),
  max_items: z.number().int().min(1).max(50).default(20),
});

export const recallInputSchema = z.object({
  query: z.string().trim().min(1).max(4_000),
  agent: z.string().trim().min(1).max(128).optional(),
  project_key: z.string().trim().max(512).optional(),
  workspace_key: z.string().trim().max(512).optional(),
  fact_key: z.string().trim().max(256).optional(),
  as_of: z.string().optional(),
  from_scope: z.string().trim().max(512).optional(),
  types: z.array(memoryTypeSchema).optional(),
  kinds: z.array(memoryKindSchema).optional(),
  limit: z.number().int().min(1).max(50).default(8),
  include_inferred: z.boolean().default(false),
  include_superseded: z.boolean().default(false),
});

export const rememberInputSchema = z.object({
  content: z.string().trim().min(1).max(4_000),
  fact_key: z.string().trim().max(256).optional(),
  tags: z.array(z.string().trim().max(64)).optional(),
  idempotency_key: z.string().trim().max(128).optional(),
  type: memoryTypeSchema.default("semantic"),
  kind: memoryKindSchema.default("fact"),
  scope_type: memoryScopeTypeSchema.default("global"),
  scope_key: z.string().trim().max(512).optional(),
  tier: memoryTierSchema.default("normal"),
  importance: z.number().int().min(0).max(100).default(50),
  confidence: z.number().int().min(0).max(100).default(50),
  verification: z.enum(["inferred", "observed"]).default("observed"),
  source_agent: z.string().trim().max(128).optional(),
  source_session: z.string().trim().max(512).optional(),
  source_ref: z.string().trim().max(512).optional(),
  valid_from: z.string().optional(),
  observed_at: z.string().optional(),
  evidence: z
    .array(
      z.object({
        source_type: memoryEvidenceSourceTypeSchema.default("session"),
        source_id: z.string().min(1),
        source_revision: z.string().optional(),
        relation_type: memoryEvidenceRelationTypeSchema.default("derived_from"),
        observed_at: z.string().optional(),
        excerpt: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
});

export const checkpointInputSchema = z.object({
  agent: z.string().trim().min(1).max(128),
  project_key: z.string().trim().max(512).optional(),
  scope_type: memoryScopeTypeSchema.default("project"),
  scope_key: z.string().trim().max(512).optional(),
  summary: z.string().trim().min(1).max(4_000),
  items: z
    .array(
      z.object({
        content: z.string().trim().min(1).max(4_000),
        fact_key: z.string().trim().max(256).optional(),
        tags: z.array(z.string().trim().max(64)).optional(),
        type: memoryTypeSchema.default("semantic"),
        kind: memoryKindSchema.default("fact"),
        importance: z.number().int().min(0).max(100).default(50),
      }),
    )
    .min(1)
    .max(20),
});

export const linkInputSchema = z.object({
  memory_id: z.string().trim().min(1).max(256),
  related_memory_id: z.string().trim().min(1).max(256).optional(),
  relation_type: memoryRelationTypeSchema.default("related_to"),
  resource_type: memoryResourceTypeSchema.optional(),
  resource_ref: z.string().trim().max(512).optional(),
  resource_relation_type:
    memoryResourceRelationTypeSchema.default("references"),
});

export const forgetInputSchema = z.object({
  memory_id: z.string().trim().min(1).max(256),
  reason: memoryForgetReasonSchema.default("superseded"),
});

export const resolveProposalInputSchema = z.object({
  action: resolveProposalActionSchema,
  modified_content: z.string().trim().min(1).max(4_000).optional(),
  rejection_reason: z.string().trim().max(500).optional(),
});

export const compileInputSchema = z.object({
  agent: z.string().trim().min(1).max(128),
  project_key: z.string().trim().max(512).optional(),
  workspace_key: z.string().trim().max(512).optional(),
  max_chars: z.number().int().min(500).max(30_000).default(6_000),
  exclude_ids: z.array(z.string()).optional(),
});

// --- Types ------------------------------------------------------------------

export type MemoryType = z.infer<typeof memoryTypeSchema>;
export type MemoryKind = z.infer<typeof memoryKindSchema>;
export type MemoryScopeType = z.infer<typeof memoryScopeTypeSchema>;
export type MemoryTier = z.infer<typeof memoryTierSchema>;
export type MemoryVerification = z.infer<typeof memoryVerificationSchema>;
export type MemoryStatus = z.infer<typeof memoryStatusSchema>;
export type MemoryRelationType = z.infer<typeof memoryRelationTypeSchema>;
export type MemoryResourceType = z.infer<typeof memoryResourceTypeSchema>;
export type MemoryResourceRelationType = z.infer<
  typeof memoryResourceRelationTypeSchema
>;
export type MemoryEvidenceSourceType = z.infer<
  typeof memoryEvidenceSourceTypeSchema
>;
export type MemoryEvidenceRelationType = z.infer<
  typeof memoryEvidenceRelationTypeSchema
>;
export type MemoryEventType = z.infer<typeof memoryEventTypeSchema>;
export type MemoryForgetReason = z.infer<typeof memoryForgetReasonSchema>;
export type MemoryCreatedByType = z.infer<typeof memoryCreatedByTypeSchema>;
export type MemoryMatchPath = z.infer<typeof memoryMatchPathSchema>;
export type ResolveProposalAction = z.infer<typeof resolveProposalActionSchema>;

export type MemoryDto = z.infer<typeof memoryDtoSchema>;
export type MemoryEvidenceDto = z.infer<typeof memoryEvidenceDtoSchema>;
export type MemoryEventDto = z.infer<typeof memoryEventDtoSchema>;
export type MemoryRejectionDto = z.infer<typeof memoryRejectionDtoSchema>;
export type MemoryRevisionDto = z.infer<typeof memoryRevisionDtoSchema>;
export type MemoryRelationDto = z.infer<typeof memoryRelationDtoSchema>;
export type MemoryResourceLinkDto = z.infer<typeof memoryResourceLinkDtoSchema>;
export type MemoryRecallItem = z.infer<typeof memoryRecallItemSchema>;
export type MemoryRecallResponse = z.infer<typeof memoryRecallResponseSchema>;
export type MemoryLineageDto = z.infer<typeof memoryLineageDtoSchema>;
export type CompiledMemoryDto = z.infer<typeof compiledMemoryDtoSchema>;
export type MemoryCompileArchiveDto = z.infer<
  typeof memoryCompileArchiveDtoSchema
>;

export type ExportMemory = z.infer<typeof exportMemorySchema>;
export type ImportMemory = z.infer<typeof importMemorySchema>;
export type ExportMemoryRevision = z.infer<typeof exportMemoryRevisionSchema>;
export type ExportMemoryRelation = z.infer<typeof exportMemoryRelationSchema>;
export type ExportMemoryResourceLink = z.infer<
  typeof exportMemoryResourceLinkSchema
>;
export type ExportMemoryEvidence = z.infer<typeof exportMemoryEvidenceSchema>;
export type ExportMemoryEvent = z.infer<typeof exportMemoryEventSchema>;

export type CreateMemoryInput = z.infer<typeof createMemorySchema>;
export type CreateMemoryFromMemoInput = z.infer<
  typeof createMemoryFromMemoSchema
>;
export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>;
export type BootstrapInput = z.infer<typeof bootstrapInputSchema>;
export type RecallInput = z.infer<typeof recallInputSchema>;
export type RememberInput = z.infer<typeof rememberInputSchema>;
export type CheckpointInput = z.infer<typeof checkpointInputSchema>;
export type LinkInput = z.infer<typeof linkInputSchema>;
export type ForgetInput = z.infer<typeof forgetInputSchema>;
export type ResolveProposalInput = z.infer<typeof resolveProposalInputSchema>;
export type CompileInput = z.infer<typeof compileInputSchema>;
