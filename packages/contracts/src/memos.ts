import { z } from "zod";
import {
  exportMemoryEventSchema,
  exportMemoryEvidenceSchema,
  exportMemoryRelationSchema,
  exportMemoryResourceLinkSchema,
  exportMemoryRevisionSchema,
  importMemorySchema,
  memoryDtoSchema,
} from "./memory";
import {
  projectStatusSchema,
  taskActivityActionSchema,
  taskActorTypeSchema,
  taskPrioritySchema,
  taskStatusSchema,
} from "./projects";
import { memoSearchScopes } from "./search-query";

export const memoVisibilitySchema = z.enum(["private", "protected", "public"]);
export const memoSpaceSchema = z.enum(["all", "personal", "team"]);
export const memoStatusSchema = z.enum([
  "normal",
  "archived",
  "trashed",
  "deleted",
]);
export const memoRelationTypeSchema = z.enum(["reference", "comment"]);
export const attachmentStateSchema = z.enum(["ready", "deleting", "missing"]);
export const memoOrderBySchema = z.enum([
  "created_at asc",
  "created_at desc",
  "updated_at asc",
  "updated_at desc",
]);
export const memoSearchScopeSchema = z.enum(memoSearchScopes);

export const memoPropertySchema = z
  .object({
    title: z.string().optional(),
    has_link: z.boolean().optional(),
    has_task_list: z.boolean().optional(),
    has_code: z.boolean().optional(),
    has_incomplete_tasks: z.boolean().optional(),
  })
  .passthrough();

export const memoPayloadSchema = z
  .object({
    tags: z.array(z.string()).optional(),
    property: memoPropertySchema.optional(),
    location: z.unknown().optional(),
    // Memos-compatible payloads may already carry arbitrary client ids. The
    // domain layer only promotes a non-empty value up to 128 characters to
    // the internal idempotency key, without rejecting existing clients.
    client_id: z.string().optional(),
    // Voice capture (rollout §4.2): playback length of the session and the
    // attachment id that carries the recording. Optional so payloads from
    // before P3 — and from other clients — keep parsing unchanged.
    durationSeconds: z.number().optional(),
    audioAttachmentId: z.string().optional(),
  })
  .passthrough();

export const createMemoSchema = z.object({
  content: z.string().trim().min(1).max(100_000),
  visibility: memoVisibilitySchema.default("private"),
  payload: memoPayloadSchema.optional(),
  source: z.string().trim().min(1).max(64).default("web"),
});

export const updateMemoSchema = z
  .object({
    content: z.string().trim().min(1).max(100_000).optional(),
    visibility: memoVisibilitySchema.optional(),
    status: memoStatusSchema.optional(),
    pinned: z.boolean().optional(),
    payload: memoPayloadSchema.optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field must be updated.",
  );

export const listMemosQuerySchema = z.object({
  page_size: z.coerce.number().int().min(1).max(100).default(30),
  page_token: z.string().optional(),
  order_by: memoOrderBySchema.default("created_at desc"),
  state: memoStatusSchema.optional(),
  visibility: memoVisibilitySchema.optional(),
  space: memoSpaceSchema.optional(),
  q: z
    .string()
    .optional()
    .describe(
      "Full-text terms plus optional filters: has:attachment, is:pinned, before:YYYY-MM-DD, after:YYYY-MM-DD, and in:timeline|archive|trash. Without state or in:, queries search timeline and archived memos; use in:trash for trashed memos. Date filters use memo creation dates in UTC; after is inclusive and before is exclusive. Invalid filter-like terms remain text.",
    ),
  tag: z.string().optional(),
  /** Only include memos that have no tags. Mutually exclusive with `tag`. */
  untagged: z.coerce.boolean().optional(),
  /** Current Memos API CEL expression. Legacy `q` remains independent. */
  filter: z.string().trim().max(4_096).optional(),
  include_deleted: z.coerce.boolean().default(false),
});

export const memoStatsQuerySchema = z.object({
  time_zone: z.string().trim().min(1).max(100).default("UTC"),
  // Space-partitioned sidebar stats; absent means the viewer's own corpus
  // (the historical, Memos-compatible semantics). `all` is accepted and
  // normalized to absent by the route, matching what the memo list and the tag
  // hierarchy already do — sending it through used to widen the corpus to every
  // memo the viewer could read, so the sidebar's three number blocks each read
  // a different set.
  space: memoSpaceSchema.optional(),
  /**
   * Length of the trailing `activity` window in local days. The heatmap's year
   * view needs 366; the default keeps the historical 84-day window. Capped so
   * one request cannot ask for an unbounded range.
   */
  days: z.coerce.number().int().min(1).max(366).default(84),
  /**
   * Local date (viewer's zone, YYYY-MM-DD) anchoring the END of the trailing
   * `activity` window. Absent means today. The year view passes the navigated
   * year's Dec 31 so a historical year renders its own cells instead of
   * sharing the trailing-today window, which covers at most its tail (issue
   * #144). Format-validated only: a future anchor just renders structural
   * zeros, the same shape the current year's grid already shows past today.
   */
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const dailyReviewQuerySchema = z.object({
  /** Local date in YYYY-MM-DD; the server matches creation month-day. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Minutes the viewer's local time is ahead of UTC (e.g. 480 for UTC+8). */
  tzOffset: z.coerce.number().int().min(-840).max(840).default(0),
});

export const reviewMarkSchema = z.object({
  memoId: z.string().trim().min(1).max(200),
  /** The viewer-local day the read happened, YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  action: z.enum(["reviewed", "mute", "unmute"]),
});

export const reviewSettingsUpdateSchema = z.object({
  excludedTags: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  restoreMuted: z.boolean().optional(),
});

export const randomMemoQuerySchema = z.object({
  /** Comma-separated memo resource names already walked through. */
  exclude: z.string().trim().max(64_000).optional(),
});

export const walkNextQuerySchema = z.object({
  memoId: z.string().trim().min(1).max(200),
  exclude: z.string().trim().max(64_000).optional(),
});

export const relatedMemosQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

export const reviewWalkViaSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tag"), tag: z.string() }),
  z.object({ type: z.literal("relation") }),
  z.object({ type: z.literal("jump") }),
]);

export const attachmentDtoSchema = z.object({
  name: z.string(),
  id: z.string(),
  memo: z.string().nullable(),
  filename: z.string(),
  content_type: z.string().nullable(),
  size: z.number().int().nonnegative(),
  state: attachmentStateSchema,
  etag: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  create_time: z.string(),
  update_time: z.string(),
  download_url: z.string(),
  preview_url: z.string(),
  /** Card-sized WebP preview; absent when none was generated at upload. */
  thumbnail_url: z.string().optional(),
});

export const memoDtoSchema = z.object({
  name: z.string(),
  id: z.string(),
  content: z.string(),
  visibility: memoVisibilitySchema,
  state: memoStatusSchema,
  pinned: z.boolean(),
  payload: memoPayloadSchema,
  create_time: z.string(),
  update_time: z.string(),
  display_time: z.string(),
  creator: z.string(),
  creator_name: z.string().optional(),
  // Submission client ("web", "voice", …); absent on legacy rows. The
  // timeline uses it for the voice-capture face (rollout §4.3).
  source: z.string().optional(),
  // Server-computed edit/manage permission for the requesting user, so
  // clients never re-derive the team permission rules locally.
  can_manage: z.boolean().optional(),
  // Lifecycle-governance permission (archive/trash/restore) for the
  // requesting user; administrators hold it on other members' team memos
  // even though they cannot edit them.
  can_govern: z.boolean().optional(),
  attachments: z.array(attachmentDtoSchema).optional(),
  // Comments under this memo the viewer can read (app timeline only).
  comment_count: z.number().int().nonnegative().optional(),
});

export const listMemosResponseSchema = z.object({
  memos: z.array(memoDtoSchema),
  next_page_token: z.string().optional(),
});

export const memoStatsResponseSchema = z.object({
  counts: z.object({
    normal: z.number().int().nonnegative(),
    archived: z.number().int().nonnegative(),
    trashed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    /** Normal-state counts per space, only present on space-scoped queries. */
    spaces: z
      .object({
        personal: z.number().int().nonnegative(),
        team: z.number().int().nonnegative(),
      })
      .optional(),
  }),
  active_days: z.number().int().nonnegative(),
  tags: z.array(
    z.object({
      name: z.string(),
      count: z.number().int().positive(),
    }),
  ),
  activity: z.array(
    z.object({
      date: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
});

export const listAttachmentsQuerySchema = z.object({
  memo: z.string().optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
});

export const bindMemoAttachmentsSchema = z.object({
  attachments: z.array(z.string()).max(100),
});

export const listAttachmentsResponseSchema = z.object({
  attachments: z.array(attachmentDtoSchema),
});

export const memoRelationDtoSchema = z.object({
  memo: z.string(),
  related_memo: z.string(),
  type: memoRelationTypeSchema,
  create_time: z.string(),
});

export const patchMemoRelationsSchema = z.object({
  relations: z
    .array(
      z.object({
        related_memo: z.string(),
        type: memoRelationTypeSchema.default("reference"),
      }),
    )
    .max(100),
});

export const listMemoRelationsResponseSchema = z.object({
  relations: z.array(memoRelationDtoSchema),
});

export const shareDtoSchema = z.object({
  name: z.string(),
  id: z.string(),
  memo: z.string(),
  token: z.string(),
  expires_at: z.string().nullable(),
  create_time: z.string(),
  update_time: z.string(),
  revoked_at: z.string().nullable(),
});

export const createShareSchema = z.object({
  expires_at: z.string().datetime().nullable().optional(),
});

export const listMemoSharesResponseSchema = z.object({
  shares: z.array(shareDtoSchema),
});

export const memoRevisionDtoSchema = z.object({
  name: z.string(),
  id: z.string(),
  memo: z.string(),
  content: z.string(),
  visibility: memoVisibilitySchema,
  payload: memoPayloadSchema,
  create_time: z.string(),
});

export const listMemoRevisionsResponseSchema = z.object({
  revisions: z.array(memoRevisionDtoSchema),
});

export const restoreMemoRevisionSchema = z.object({
  revision: z.string(),
});

export const memoRelationContextSchema = z.object({
  relation: memoRelationDtoSchema,
  memo: memoDtoSchema,
});

export const memoRelationContextResponseSchema = z.object({
  relations: z.array(memoRelationContextSchema),
  backlinks: z.array(memoRelationContextSchema),
});

export const memoContextResponseSchema = z.object({
  memo: memoDtoSchema,
  can_manage: z.boolean(),
  can_govern: z.boolean(),
  attachments: z.array(attachmentDtoSchema),
  shares: z.array(shareDtoSchema),
  relations: z.array(memoRelationContextSchema),
  backlinks: z.array(memoRelationContextSchema),
  revisions: z.array(memoRevisionDtoSchema),
  memories: z.array(memoryDtoSchema),
});

export const publicShareDtoSchema = z.object({
  share: shareDtoSchema.omit({ token: true }),
  memo: memoDtoSchema,
  attachments: z.array(attachmentDtoSchema),
});

export const exportAttachmentSchema = attachmentDtoSchema
  .omit({ download_url: true, preview_url: true })
  .extend({
    data_base64: z.string().max(48_000_000).optional(),
  });

const importAttachmentSchema = exportAttachmentSchema.partial({
  state: true,
  etag: true,
});

const importShareSchema = shareDtoSchema.partial({
  update_time: true,
  revoked_at: true,
});

export const importBundleSchema = z.object({
  version: z
    .union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
    ])
    .default(1),
  memos: z
    .array(
      memoDtoSchema
        .pick({
          name: true,
          content: true,
          visibility: true,
          state: true,
          pinned: true,
          payload: true,
          create_time: true,
          update_time: true,
          display_time: true,
        })
        .partial({
          create_time: true,
          update_time: true,
          display_time: true,
        })
        .extend({ source: z.string().max(64).optional() }),
    )
    .max(50_000),
  attachments: z.array(importAttachmentSchema).max(5_000).default([]),
  relations: z.array(memoRelationDtoSchema).max(100_000).default([]),
  shares: z.array(importShareSchema).max(10_000).default([]),
  memories: z.array(importMemorySchema).max(50_000).default([]),
  memory_revisions: z
    .array(exportMemoryRevisionSchema)
    .max(200_000)
    .default([]),
  memory_relations: z
    .array(exportMemoryRelationSchema)
    .max(100_000)
    .default([]),
  memory_resource_links: z
    .array(exportMemoryResourceLinkSchema)
    .max(100_000)
    .default([]),
  // v5: the memory ledger's evidence chain and lifecycle trail joined the
  // bundle. Both are user-owned source data (not derived state): without them a
  // round-trip would drop every "why does this fact exist" link and the whole
  // supersession narrative, which is the product's core promise.
  memory_evidence: z.array(exportMemoryEvidenceSchema).max(200_000).default([]),
  memory_events: z.array(exportMemoryEventSchema).max(200_000).default([]),
  // v4: projects/tasks/task_activity joined the self-service bundle. Rows keep
  // their namespaced ids; soft-deleted (recycle-bin) rows travel with
  // `deleted_at` so nothing is silently dropped from a backup.
  projects: z
    .array(
      z.object({
        name: z.string(),
        title: z.string(),
        description: z.string().nullable(),
        status: projectStatusSchema,
        deleted_at: z.string().nullable(),
        created_at: z.string(),
        updated_at: z.string(),
      }),
    )
    .max(10_000)
    .default([]),
  tasks: z
    .array(
      z.object({
        name: z.string(),
        project_id: z.string().nullable(),
        source_memo_id: z.string().nullable(),
        title: z.string(),
        notes: z.string().nullable(),
        status: taskStatusSchema,
        priority: taskPrioritySchema,
        due_at: z.string().nullable(),
        sort_order: z.number().int(),
        completed_at: z.string().nullable(),
        deleted_at: z.string().nullable(),
        created_at: z.string(),
        updated_at: z.string(),
      }),
    )
    .max(50_000)
    .default([]),
  task_activity: z
    .array(
      z.object({
        task_id: z.string().nullable(),
        actor_type: taskActorTypeSchema,
        actor_name: z.string().nullable(),
        action: taskActivityActionSchema,
        changes: z.record(z.string(), z.unknown()),
        created_at: z.string(),
      }),
    )
    .max(100_000)
    .default([]),
  exported_at: z.string().optional(),
});

export const importOptionsSchema = z.object({
  conflict: z.enum(["skip", "duplicate", "overwrite"]).default("duplicate"),
});

export const importResultSchema = z.object({
  imported_memos: z.number().int().nonnegative(),
  skipped_memos: z.number().int().nonnegative(),
  overwritten_memos: z.number().int().nonnegative(),
  imported_attachments: z.number().int().nonnegative(),
  imported_relations: z.number().int().nonnegative(),
  imported_shares: z.number().int().nonnegative(),
  imported_memories: z.number().int().nonnegative().default(0),
  imported_projects: z.number().int().nonnegative().default(0),
  imported_tasks: z.number().int().nonnegative().default(0),
  imported_task_activity: z.number().int().nonnegative().default(0),
});

export const dataTaskStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "expired",
]);

export const dataTaskDtoSchema = z.object({
  id: z.string(),
  kind: z.enum(["export", "import"]),
  status: dataTaskStatusSchema,
  phase: z.string(),
  progress_done: z.number().int().nonnegative(),
  progress_total: z.number().int().nonnegative(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable(),
});

export const dataTaskListResponseSchema = z.object({
  tasks: z.array(dataTaskDtoSchema),
});

export const createDataTaskResponseSchema = z.object({
  task: dataTaskDtoSchema,
});

export const createImportTaskRequestSchema = z.object({
  bundle: importBundleSchema,
  conflict: importOptionsSchema.shape.conflict.optional(),
});

export const exportManifestSchema = z.object({
  format_version: z.number().int(),
  exported_at: z.string(),
  counts: z.object({
    memos: z.number().int().nonnegative(),
    attachments: z.number().int().nonnegative(),
    relations: z.number().int().nonnegative(),
    shares: z.number().int().nonnegative(),
  }),
  data_chunks: z.array(
    z.object({
      kind: z.enum(["memos", "attachments", "relations", "shares", "settings"]),
      key: z.string(),
      record_count: z.number().int().nonnegative(),
    }),
  ),
  attachments: z.array(
    z.object({
      id: z.string(),
      filename: z.string(),
      content_type: z.string().nullable(),
      size: z.number().int().nonnegative(),
    }),
  ),
});

export const exportManifestResponseSchema = exportManifestSchema;

export const tagHierarchyNodeSchema: z.ZodType<{
  name: string;
  count: number;
  children: z.infer<typeof tagHierarchyNodeSchema>[];
}> = z.lazy(() =>
  z.object({
    name: z.string(),
    count: z.number().int().nonnegative(),
    children: z.array(tagHierarchyNodeSchema),
  }),
);

export const tagHierarchyResponseSchema = z.object({
  tags: z.array(tagHierarchyNodeSchema),
});

export const renameTagRequestSchema = z.object({
  /** Source canonical tag path, e.g. `工作` or `工作/项目A`. */
  from: z.string().trim().min(1).max(200),
  /** Destination canonical tag path, e.g. `知识/工作` or `工作`. */
  to: z.string().trim().min(1).max(200),
});

export const renameTagResponseSchema = z.object({
  renamed: z.number().int().nonnegative(),
});

export const deleteTagResponseSchema = z.object({
  removed: z.number().int().nonnegative(),
});

export const listNotificationsQuerySchema = z.object({
  page_size: z.coerce.number().int().min(1).max(100).default(50),
  page_token: z.string().optional(),
});

export const updateNotificationSchema = z.object({
  status: z.enum(["unread", "archived"]),
});

export const appNotificationDtoSchema = z.object({
  name: z.string(),
  type: z.enum([
    "memo_comment",
    "memo_mention",
    "daily_review",
    "task_overdue",
    "task_due",
  ]),
  status: z.enum(["unread", "archived"]),
  // Task-overdue rows have no memo anchor; memo_snippet carries the title.
  memo: z.string().nullable(),
  // Parent memo for comment notifications (the thread to open).
  related_memo: z.string().nullable().optional(),
  sender_name: z.string().optional(),
  memo_snippet: z.string(),
  create_time: z.string(),
});

export type CreateMemoInput = z.infer<typeof createMemoSchema>;
export type UpdateMemoInput = z.infer<typeof updateMemoSchema>;
export type ListMemosQuery = z.infer<typeof listMemosQuerySchema>;
export type MemoStatsQuery = z.infer<typeof memoStatsQuerySchema>;
/**
 * The pre-validation shape. `time_zone` and `days` carry Zod defaults, so the
 * parsed output requires them while a direct in-process caller may omit both —
 * internal callers pass literals instead of round-tripping through the schema.
 *
 * `days` is restated as `number` because `z.coerce.number()` types its input as
 * `unknown` (it accepts anything `Number()` can parse), and that widening would
 * otherwise land on every internal caller.
 */
export type MemoStatsQueryInput = Omit<
  z.input<typeof memoStatsQuerySchema>,
  "days"
> & {
  days?: number;
};
export type MemoVisibility = z.infer<typeof memoVisibilitySchema>;
export type MemoSpace = z.infer<typeof memoSpaceSchema>;
export type MemoState = z.infer<typeof memoStatusSchema>;
export type MemoOrderBy = z.infer<typeof memoOrderBySchema>;
export type MemoDto = z.infer<typeof memoDtoSchema>;
export type ListMemosResponse = z.infer<typeof listMemosResponseSchema>;
export type MemoStatsResponse = z.infer<typeof memoStatsResponseSchema>;
export type DailyReviewQuery = z.infer<typeof dailyReviewQuerySchema>;
export type RandomMemoQuery = z.infer<typeof randomMemoQuerySchema>;
export type WalkNextQuery = z.infer<typeof walkNextQuerySchema>;
export type RelatedMemosQuery = z.infer<typeof relatedMemosQuerySchema>;
export type ReviewWalkVia = z.infer<typeof reviewWalkViaSchema>;
export type DailyReviewResponse = { memos: MemoDto[] };
export type ReviewMarkInput = z.infer<typeof reviewMarkSchema>;
export type ReviewSettingsUpdate = z.infer<typeof reviewSettingsUpdateSchema>;
/** Why a note is in today's review: a past year's same day, or its age. */
export type TodayReviewReason =
  | { type: "years"; years: number }
  | { type: "ladder"; days: number };
export type TodayReviewItem = {
  memo: MemoDto;
  reason: TodayReviewReason;
  /** Already read in today's review (here or on another device). */
  reviewed: boolean;
};
export type TodayReviewResponse = { date: string; items: TodayReviewItem[] };
export type ReviewSettingsResponse = {
  excluded_tags: string[];
  muted_count: number;
};
export type RandomMemoResponse = { memo: MemoDto | null };
export type WalkNextResponse = {
  memo: MemoDto | null;
  via: ReviewWalkVia | null;
};
export type RelatedMemoEntry = MemoDto & {
  shared_tags: string[];
  via_relation: boolean;
};
export type RelatedMemosResponse = { memos: RelatedMemoEntry[] };
export type ListNotificationsQuery = z.infer<
  typeof listNotificationsQuerySchema
>;
export type UpdateNotificationInput = z.infer<typeof updateNotificationSchema>;
export type AppNotificationDto = z.infer<typeof appNotificationDtoSchema>;
export type ListAppNotificationsResponse = {
  notifications: AppNotificationDto[];
  next_page_token?: string;
};
export type AttachmentDto = z.infer<typeof attachmentDtoSchema>;
export type ListAttachmentsQuery = z.infer<typeof listAttachmentsQuerySchema>;
export type BindMemoAttachmentsInput = z.infer<
  typeof bindMemoAttachmentsSchema
>;
export type MemoRelationDto = z.infer<typeof memoRelationDtoSchema>;
export type PatchMemoRelationsInput = z.infer<typeof patchMemoRelationsSchema>;
export type ShareDto = z.infer<typeof shareDtoSchema>;
export type CreateShareInput = z.infer<typeof createShareSchema>;
export type MemoRevisionDto = z.infer<typeof memoRevisionDtoSchema>;
export type MemoContextResponse = z.infer<typeof memoContextResponseSchema>;
export type PublicShareDto = z.infer<typeof publicShareDtoSchema>;
export type ExportAttachment = z.infer<typeof exportAttachmentSchema>;
export type ImportBundle = z.infer<typeof importBundleSchema>;
export type ImportOptions = z.infer<typeof importOptionsSchema>;
export type ImportResult = z.infer<typeof importResultSchema>;
export type DataTaskDto = z.infer<typeof dataTaskDtoSchema>;
export type DataTaskStatus = z.infer<typeof dataTaskStatusSchema>;
export type DataTaskListResponse = z.infer<typeof dataTaskListResponseSchema>;
export type CreateDataTaskResponse = z.infer<
  typeof createDataTaskResponseSchema
>;
export type CreateImportTaskRequest = z.infer<
  typeof createImportTaskRequestSchema
>;
export type ExportManifest = z.infer<typeof exportManifestSchema>;
export type TagHierarchyNode = z.infer<typeof tagHierarchyNodeSchema>;
export type TagHierarchyResponse = z.infer<typeof tagHierarchyResponseSchema>;
export type RenameTagInput = z.infer<typeof renameTagRequestSchema>;
export type RenameTagResponse = z.infer<typeof renameTagResponseSchema>;
export type DeleteTagResponse = z.infer<typeof deleteTagResponseSchema>;

// A comment is plain prose under its parent memo; it inherits the parent's
// visibility, so the request carries only the text.
export const createMemoCommentSchema = z.object({
  content: z.string().trim().min(1).max(20_000),
  client_id: z.string().trim().min(1).max(128).optional(),
});
export type CreateMemoCommentRequest = z.infer<typeof createMemoCommentSchema>;
