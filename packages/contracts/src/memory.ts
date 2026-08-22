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

// --- DTO --------------------------------------------------------------------

export const memoryDtoSchema = z.object({
  id: z.string(),
  content: z.string(),
  type: memoryTypeSchema,
  kind: memoryKindSchema,
  scope_type: memoryScopeTypeSchema,
  scope_key: z.string().nullable(),
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
  access_count: z.number().int(),
  last_accessed_at: z.string().nullable(),
  embedding_status: memoryEmbeddingStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
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

// --- REST request schemas ---------------------------------------------------

export const createMemorySchema = z.object({
  content: z.string().trim().min(1).max(4_000),
  type: memoryTypeSchema.default("semantic"),
  kind: memoryKindSchema.default("fact"),
  scope_type: memoryScopeTypeSchema.default("global"),
  scope_key: z.string().trim().max(512).optional(),
  tier: memoryTierSchema.default("normal"),
  importance: z.number().int().min(0).max(100).default(50),
  // A user-created memory is always `confirmed`, unless the user explicitly
  // locks it at creation time.
  lock: z.boolean().default(false),
});

export const updateMemorySchema = z
  .object({
    content: z.string().trim().min(1).max(4_000).optional(),
    type: memoryTypeSchema.optional(),
    kind: memoryKindSchema.optional(),
    scope_type: memoryScopeTypeSchema.optional(),
    scope_key: z.string().trim().max(512).optional(),
    tier: memoryTierSchema.optional(),
    importance: z.number().int().min(0).max(100).optional(),
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
  tier: memoryTierSchema.optional(),
  verification: memoryVerificationSchema.optional(),
  status: memoryStatusSchema.optional(),
  source_agent: z.string().trim().max(128).optional(),
  needs_review: z.coerce.boolean().optional(),
});

// --- MCP input schemas ------------------------------------------------------

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
  agent: z.string().trim().min(1).max(128),
  project_key: z.string().trim().max(512).optional(),
  workspace_key: z.string().trim().max(512).optional(),
  types: z.array(memoryTypeSchema).optional(),
  kinds: z.array(memoryKindSchema).optional(),
  limit: z.number().int().min(1).max(20).default(8),
});

export const rememberInputSchema = z.object({
  content: z.string().trim().min(1).max(4_000),
  type: memoryTypeSchema.default("semantic"),
  kind: memoryKindSchema.default("fact"),
  scope_type: memoryScopeTypeSchema.default("global"),
  scope_key: z.string().trim().max(512).optional(),
  tier: memoryTierSchema.default("normal"),
  importance: z.number().int().min(0).max(100).default(50),
  confidence: z.number().int().min(0).max(100).default(50),
  // Agents may only record what they observed or inferred; confirmation and
  // locking are user actions surfaced through the web API.
  verification: z.enum(["inferred", "observed"]).default("observed"),
  source_agent: z.string().trim().max(128).optional(),
  source_session: z.string().trim().max(512).optional(),
  source_ref: z.string().trim().max(512).optional(),
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
export type MemoryForgetReason = z.infer<typeof memoryForgetReasonSchema>;
export type MemoryCreatedByType = z.infer<typeof memoryCreatedByTypeSchema>;
export type MemoryDto = z.infer<typeof memoryDtoSchema>;
export type MemoryRevisionDto = z.infer<typeof memoryRevisionDtoSchema>;
export type MemoryRelationDto = z.infer<typeof memoryRelationDtoSchema>;
export type MemoryResourceLinkDto = z.infer<typeof memoryResourceLinkDtoSchema>;
export type CreateMemoryInput = z.infer<typeof createMemorySchema>;
export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>;
export type BootstrapInput = z.infer<typeof bootstrapInputSchema>;
export type RecallInput = z.infer<typeof recallInputSchema>;
export type RememberInput = z.infer<typeof rememberInputSchema>;
export type CheckpointInput = z.infer<typeof checkpointInputSchema>;
export type LinkInput = z.infer<typeof linkInputSchema>;
export type ForgetInput = z.infer<typeof forgetInputSchema>;
