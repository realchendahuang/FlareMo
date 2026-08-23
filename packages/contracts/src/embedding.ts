import { z } from "zod";

// The embedding provider is an opt-in capability. `workers-ai` uses Cloudflare
// Workers AI (no external key), `http` calls an external embedding REST API,
// and `none` disables semantic search entirely (FTS5 keyword search remains).
export const embeddingProviderSchema = z.enum(["workers-ai", "http", "none"]);

export const embeddingStatusSchema = z.enum([
  "not_indexed",
  "pending",
  "indexed",
  "error",
]);

export const embeddingTaskResourceTypeSchema = z.enum(["memo", "memory"]);
export const embeddingTaskOperationSchema = z.enum([
  "index",
  "reindex",
  "delete",
]);
export const embeddingTaskStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "dead",
]);

// A single semantic search hit before the caller re-reads and re-checks the
// resource against D1 for final status and permission filtering.
export const semanticSearchHitSchema = z.object({
  id: z.string(),
  score: z.number(),
  kind: z.enum(["memo", "memory"]),
});

export const semanticSearchResponseSchema = z.object({
  hits: z.array(semanticSearchHitSchema),
  degraded: z.boolean().default(false),
});

// Vector usage panel DTO. Stored dimensions are read from the Vectorize index
// `describe()`; queried dimensions and embedding counters come from the D1
// `usage_counters` table. These are self-measured, not Cloudflare's bill.
export const vectorUsageReportSchema = z.object({
  provider: embeddingProviderSchema,
  model: z.string(),
  dimensions: z.number().int(),
  indexes: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["memo", "memory"]),
      vectors_count: z.number().int(),
      stored_dimensions: z.number().int(),
    }),
  ),
  queried_dimensions_this_month: z.number().int(),
  embedding_calls_this_month: z.number().int(),
  embedding_tokens_this_month: z.number().int(),
  stored_limit: z.number().int(),
  queried_limit: z.number().int(),
});

export type EmbeddingProvider = z.infer<typeof embeddingProviderSchema>;
export type EmbeddingStatus = z.infer<typeof embeddingStatusSchema>;
export type SemanticSearchHit = z.infer<typeof semanticSearchHitSchema>;
export type SemanticSearchResponse = z.infer<
  typeof semanticSearchResponseSchema
>;
export type VectorUsageReport = z.infer<typeof vectorUsageReportSchema>;
