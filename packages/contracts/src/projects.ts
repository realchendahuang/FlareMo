import { z } from "zod";

// --- Domain enums -----------------------------------------------------------

export const projectStatusSchema = z.enum(["active", "archived"]);

export const taskStatusSchema = z.enum(["todo", "in_progress", "done"]);

export const taskPrioritySchema = z.enum(["none", "low", "medium", "high"]);

export const taskActivityActionSchema = z.enum([
  "created",
  "updated",
  "status_changed",
  "deleted",
  "reordered",
]);

export const taskActorTypeSchema = z.enum(["user", "agent"]);

// --- DTO --------------------------------------------------------------------

export const projectDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: projectStatusSchema,
  task_count_total: z.number().int(),
  task_count_open: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const taskDtoSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string(),
  notes: z.string().nullable(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  due_at: z.string().nullable(),
  sort_order: z.number().int(),
  completed_at: z.string().nullable(),
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
});

export const createTaskSchema = z.object({
  project_id: z.string().trim().min(1).max(256),
  title: z.string().trim().min(1).max(2_000),
  notes: z.string().trim().max(20_000).optional(),
  status: taskStatusSchema.default("todo"),
  priority: taskPrioritySchema.default("none"),
  due_at: z.string().trim().max(64).optional(),
});

export const updateTaskSchema = z
  .object({
    project_id: z.string().trim().min(1).max(256).optional(),
    title: z.string().trim().min(1).max(2_000).optional(),
    notes: z.string().trim().max(20_000).nullable().optional(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    due_at: z.string().trim().max(64).nullable().optional(),
    sort_order: z.number().int().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field must be updated.",
  );

export const listTasksQuerySchema = z.object({
  project_id: z.string().trim().max(256).optional(),
  status: taskStatusSchema.optional(),
});

export const reorderTasksSchema = z.object({
  project_id: z.string().trim().min(1).max(256),
  task_ids: z.array(z.string().trim().min(1).max(256)),
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
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type ReorderTasksInput = z.infer<typeof reorderTasksSchema>;
