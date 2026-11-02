import { z } from "zod";

// --- Domain enums -----------------------------------------------------------

export const projectStatusSchema = z.enum(["active", "archived"]);

export const taskStatusSchema = z.enum(["todo", "in_progress", "done"]);

export const taskPrioritySchema = z.enum(["none", "low", "medium", "high"]);

export const taskActivityActionSchema = z.enum([
  "created",
  "updated",
  "status_changed",
  "reordered",
]);

export const taskActorTypeSchema = z.enum(["user", "agent"]);

// `due_at` is a local calendar day, matching what the UI date input emits and
// what every downstream consumer (calendar aggregate, overdue reminders)
// compares as a plain string.
export const taskDueDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date.");

const dateKey = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date.");

// --- DTO --------------------------------------------------------------------

export const projectDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: projectStatusSchema,
  task_count_total: z.number().int(),
  task_count_open: z.number().int(),
  // Set while the project sits in the recycle bin; null means live.
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const taskDtoSchema = z.object({
  id: z.string(),
  // Null for tasks that are not assigned to any project yet ("全部任务" view).
  project_id: z.string().nullable(),
  // Memo the task was upgraded from (memo checkbox → task); null unless the
  // task carries the bridge. Read-time validation, no FK on purpose.
  source_memo_id: z.string().nullable(),
  title: z.string(),
  notes: z.string().nullable(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  due_at: z.string().nullable(),
  sort_order: z.number().int(),
  completed_at: z.string().nullable(),
  // Set while the task sits in the recycle bin; null means live.
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const taskActivityDtoSchema = z.object({
  id: z.number().int(),
  task_id: z.string().nullable(),
  actor_type: taskActorTypeSchema,
  actor_name: z.string().nullable(),
  action: taskActivityActionSchema,
  changes: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});

// --- REST request schemas ---------------------------------------------------

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional(),
});

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field must be updated.",
  );

export const listProjectsQuerySchema = z.object({
  status: projectStatusSchema.optional(),
  // Name substring filter (LIKE %query%).
  query: z.string().trim().max(200).optional(),
  // Recycle bin: include soft-deleted projects.
  include_deleted: z.coerce.boolean().default(false),
});

export const createTaskSchema = z.object({
  // Optional: tasks can live outside any project (unassigned).
  project_id: z.string().trim().min(1).max(256).optional(),
  title: z.string().trim().min(1).max(2_000),
  notes: z.string().trim().max(20_000).optional(),
  status: taskStatusSchema.default("todo"),
  priority: taskPrioritySchema.default("none"),
  due_at: taskDueDateSchema.optional(),
  // Memo resource name (`memos/<id>`) the task was upgraded from. Only
  // meaningful for PAT/agent flows today.
  source_memo_id: z.string().trim().min(1).max(256).optional(),
});

export const updateTaskSchema = z
  .object({
    // null unassigns the task from its project.
    project_id: z.string().trim().min(1).max(256).nullable().optional(),
    title: z.string().trim().min(1).max(2_000).optional(),
    notes: z.string().trim().max(20_000).nullable().optional(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    due_at: taskDueDateSchema.nullable().optional(),
    sort_order: z.number().int().optional(),
    source_memo_id: z.string().trim().min(1).max(256).nullable().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field must be updated.",
  );

export const listTasksQuerySchema = z.object({
  project_id: z.string().trim().max(256).optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  due_from: dateKey.optional(),
  due_to: dateKey.optional(),
  // Tasks scheduled from one memo (`memos/<id>`).
  source_memo_id: z.string().trim().max(256).optional(),
  // Recycle bin: include soft-deleted tasks.
  include_deleted: z.coerce.boolean().default(false),
  // Cursor pagination, mirroring the memos list contract.
  page_size: z.coerce.number().int().min(1).max(100).default(30),
  page_token: z.string().optional(),
});

export const listTasksResponseSchema = z.object({
  tasks: z.array(taskDtoSchema),
  next_page_token: z.string().optional(),
});

export const taskReminderCountsQuerySchema = z.object({
  date: dateKey,
});

export const memoTaskSummariesQuerySchema = z.object({
  /** Comma-separated memo resource names, at most 100 per request. */
  memo_ids: z.string().trim().min(1).max(25_700),
});

export const reorderTasksSchema = z.object({
  project_id: z.string().trim().min(1).max(256),
  // Bounded so a single request cannot fan out into an unbounded write batch.
  task_ids: z.array(z.string().trim().min(1).max(256)).max(200),
});

// --- Types ------------------------------------------------------------------

export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type TaskActivityAction = z.infer<typeof taskActivityActionSchema>;
export type TaskActorType = z.infer<typeof taskActorTypeSchema>;
export type ProjectDto = z.infer<typeof projectDtoSchema>;
export type TaskDto = z.infer<typeof taskDtoSchema>;
export type TaskActivityDto = z.infer<typeof taskActivityDtoSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
// Write inputs are typed from the pre-default shape so direct domain callers
// can omit `status`/`priority`; the HTTP layer applies the schema defaults.
export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;
export type ListTasksQuery = z.input<typeof listTasksQuerySchema>;
export type ListTasksResponse = z.infer<typeof listTasksResponseSchema>;
export type ReorderTasksInput = z.infer<typeof reorderTasksSchema>;
