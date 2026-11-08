import { z } from "zod";

/**
 * AI insight contracts. See docs/agent-access-design.md §9.
 *
 * FlareMo stores the task (what to look at) and the result (what an executor
 * produced); it never runs a model itself. The executor is any client that can
 * present a `notes`-scoped PAT: the DSH plugin, Workers AI, or another agent.
 */

/** The shape of insight an executor should produce. */
export const MEMO_INSIGHT_KINDS = ["note", "digest", "map"] as const;
export type MemoInsightKind = (typeof MEMO_INSIGHT_KINDS)[number];

/** `pending → running → done | failed`; `failed` may be reset to `pending`. */
export const MEMO_INSIGHT_STATUSES = [
  "pending",
  "running",
  "done",
  "failed",
] as const;
export type MemoInsightStatus = (typeof MEMO_INSIGHT_STATUSES)[number];

/** How many memo ids one task may reference. */
export const INSIGHT_MAX_MEMO_IDS = 200;
/** Default page size for the pending-task pull. */
export const INSIGHT_DEFAULT_BATCH = 50;
/** Largest page size the pending-task pull accepts. */
export const INSIGHT_MAX_BATCH = 100;
/** Serialized `result` upper bound; keeps a runaway executor from filling D1. */
export const INSIGHT_RESULT_MAX_CHARS = 64 * 1024;
export const INSIGHT_ERROR_MAX_LENGTH = 2_000;
export const INSIGHT_EXECUTOR_MAX_LENGTH = 64;
export const INSIGHT_TAG_MAX_LENGTH = 200;
export const INSIGHT_QUERY_MAX_LENGTH = 500;

/** What to look at: specific memos, a tag, or a search query. At least one. */
export const memoInsightInputSchema = z.object({
  /**
   * Bare memo ids (the `id` field of the memo DTO). A `memos/`-prefixed
   * resource name is accepted too and normalized by the domain service.
   */
  memo_ids: z
    .array(z.string().trim().min(1).max(256))
    .min(1)
    .max(INSIGHT_MAX_MEMO_IDS)
    .optional(),
  tag: z.string().trim().min(1).max(INSIGHT_TAG_MAX_LENGTH).optional(),
  query: z.string().trim().min(1).max(INSIGHT_QUERY_MAX_LENGTH).optional(),
});
export type MemoInsightInputDto = z.infer<typeof memoInsightInputSchema>;

export const memoInsightKindSchema = z.enum(MEMO_INSIGHT_KINDS);
export const memoInsightStatusSchema = z.enum(MEMO_INSIGHT_STATUSES);

/**
 * A task and its result. `input` is always an object; `result` is whatever
 * JSON the executor wrote back (NULL until it reports `done`).
 */
export const memoInsightDtoSchema = z.object({
  id: z.string(),
  kind: memoInsightKindSchema,
  status: memoInsightStatusSchema,
  input: memoInsightInputSchema,
  result: z.json().nullable(),
  /** Who produced the result: 'dsh', 'workers-ai', 'external', … */
  executor: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MemoInsightDto = z.infer<typeof memoInsightDtoSchema>;

// --- REST request schemas ---------------------------------------------------

/**
 * Body of POST /api/app/insights. The selector fields are flattened on purpose:
 * the caller says *what to look at* without nesting a second object.
 */
export const createMemoInsightSchema = z
  .object({
    kind: memoInsightKindSchema,
    memo_ids: z
      .array(z.string().trim().min(1).max(256))
      .min(1)
      .max(INSIGHT_MAX_MEMO_IDS)
      .optional(),
    tag: z.string().trim().min(1).max(INSIGHT_TAG_MAX_LENGTH).optional(),
    query: z.string().trim().min(1).max(INSIGHT_QUERY_MAX_LENGTH).optional(),
  })
  .refine(
    (value) => Boolean(value.memo_ids?.length || value.tag || value.query),
    "Provide at least one of memo_ids, tag or query.",
  );
export type CreateMemoInsightInput = z.infer<typeof createMemoInsightSchema>;

/** Query of GET /api/app/insights. Defaults to the executor's pending pull. */
export const listMemoInsightsQuerySchema = z.object({
  status: memoInsightStatusSchema.default("pending"),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(INSIGHT_MAX_BATCH)
    .default(INSIGHT_DEFAULT_BATCH),
});
export type ListMemoInsightsQuery = z.infer<typeof listMemoInsightsQuerySchema>;

/**
 * Body of PUT /api/app/insights/:id — the executor write-back.
 *
 * `running` claims a pending task (stamps `executor`); `done`/`failed` are
 * terminal and first-write-wins, so a network retry is idempotent. `pending`
 * on a failed task is the documented retry reset (§9.4).
 */
export const writeMemoInsightSchema = z
  .object({
    status: memoInsightStatusSchema,
    result: z.json().optional(),
    error: z.string().trim().min(1).max(INSIGHT_ERROR_MAX_LENGTH).optional(),
    executor: z
      .string()
      .trim()
      .min(1)
      .max(INSIGHT_EXECUTOR_MAX_LENGTH)
      .optional(),
  })
  .refine(
    (value) => value.status !== "done" || value.result !== undefined,
    "A done insight requires result.",
  );
export type WriteMemoInsightInput = z.infer<typeof writeMemoInsightSchema>;

// --- REST response types ----------------------------------------------------

export type MemoInsightResponse = {
  insight: MemoInsightDto;
};

export type ListMemoInsightsResponse = {
  insights: MemoInsightDto[];
};
