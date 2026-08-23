import type {
  CreateTaskInput,
  TaskActivityAction,
  TaskActivityDto,
  TaskDto,
  UpdateTaskInput,
} from "@flaremo/contracts";
import type { FlareMoDb, TaskActivityRow, TaskRow, UserRow } from "@flaremo/db";
import { taskActivity, tasks } from "@flaremo/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { NotFoundError, ValidationError } from "./errors";
import { createResourceId } from "./ids";
import { requireProject } from "./projects";

/**
 * The actor behind a task mutation. Browser sessions are the owner; PATs
 * (agents and scripts) are agents. Both are first-class writers on tasks, so
 * the permission model relies on the append-only activity trail rather than
 * downgrading the agent's access.
 */
export type TaskActor = { type: "user" } | { type: "agent"; name?: string };

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

export function taskToDto(row: TaskRow): TaskDto {
  return {
    id: row.id,
    project_id: row.projectId,
    title: row.title,
    notes: row.notes,
    status: row.status,
    priority: row.priority,
    due_at: row.dueAt,
    sort_order: row.sortOrder,
    completed_at: row.completedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function taskActivityToDto(row: TaskActivityRow): TaskActivityDto {
  return {
    id: row.id,
    task_id: row.taskId,
    actor_type: row.actorType,
    actor_name: row.actorName,
    action: row.action,
    changes: row.changes,
    created_at: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Ownership / permission
// ---------------------------------------------------------------------------

async function requireTask(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<TaskRow> {
  const row = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, user.id)))
    .get();
  if (!row) throw new NotFoundError(`Task not found: ${id}`);
  return row;
}

// ---------------------------------------------------------------------------
// Activity trail
// ---------------------------------------------------------------------------

async function appendActivity(
  db: FlareMoDb,
  user: UserRow,
  actor: TaskActor,
  taskId: string | null,
  action: TaskActivityAction,
  changes: Record<string, unknown>,
) {
  await db.insert(taskActivity).values({
    taskId,
    userId: user.id,
    actorType: actor.type,
    actorName: actor.type === "agent" ? (actor.name ?? null) : null,
    action,
    changes,
    createdAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Create / read
// ---------------------------------------------------------------------------

export async function createTask(
  db: FlareMoDb,
  user: UserRow,
  actor: TaskActor,
  input: CreateTaskInput,
): Promise<TaskDto> {
  const projectId = parseTaskProjectId(input.project_id);
  await requireProject(db, user, projectId);

  const title = input.title.trim();
  if (!title) throw new ValidationError("Task title cannot be empty.");

  const status = input.status ?? "todo";
  const priority = input.priority ?? "none";

  const now = new Date().toISOString();
  const row = await db
    .insert(tasks)
    .values({
      id: createResourceId("tasks"),
      userId: user.id,
      projectId,
      title,
      notes: input.notes?.trim() || null,
      status,
      priority,
      dueAt: input.due_at?.trim() || null,
      sortOrder: 0,
      completedAt: status === "done" ? now : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  await appendActivity(db, user, actor, row.id, "created", {
    project_id: projectId,
    title,
    status,
  });

  return taskToDto(row);
}

export async function getTask(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<TaskDto> {
  return taskToDto(await requireTask(db, user, id));
}

export async function listTasks(
  db: FlareMoDb,
  user: UserRow,
  input: { projectId?: string; status?: TaskRow["status"] } = {},
): Promise<TaskDto[]> {
  const filters = [eq(tasks.userId, user.id)];
  if (input.projectId) {
    filters.push(eq(tasks.projectId, parseTaskProjectId(input.projectId)));
  }
  if (input.status) filters.push(eq(tasks.status, input.status));

  const rows = await db
    .select()
    .from(tasks)
    .where(and(...filters))
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt), asc(tasks.id));
  return rows.map(taskToDto);
}

export async function listTaskActivity(
  db: FlareMoDb,
  user: UserRow,
  taskId: string,
): Promise<TaskActivityDto[]> {
  await requireTask(db, user, taskId);
  const rows = await db
    .select()
    .from(taskActivity)
    .where(
      and(eq(taskActivity.taskId, taskId), eq(taskActivity.userId, user.id)),
    )
    .orderBy(asc(taskActivity.createdAt), asc(taskActivity.id));
  return rows.map(taskActivityToDto);
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateTask(
  db: FlareMoDb,
  user: UserRow,
  actor: TaskActor,
  id: string,
  input: UpdateTaskInput,
): Promise<TaskDto> {
  const existing = await requireTask(db, user, id);
  const next = { ...existing };
  const changes: Record<string, unknown> = {};

  if (input.project_id !== undefined) {
    next.projectId = parseTaskProjectId(input.project_id);
    await requireProject(db, user, next.projectId);
    changes.project_id = next.projectId;
  }
  if (input.title !== undefined) {
    next.title = input.title.trim();
    if (!next.title) throw new ValidationError("Task title cannot be empty.");
    changes.title = next.title;
  }
  if (input.notes !== undefined) {
    next.notes = input.notes?.trim() || null;
    changes.notes = next.notes;
  }
  if (input.priority !== undefined) {
    next.priority = input.priority;
    changes.priority = input.priority;
  }
  if (input.due_at !== undefined) {
    next.dueAt = input.due_at?.trim() || null;
    changes.due_at = next.dueAt;
  }
  if (input.sort_order !== undefined) {
    next.sortOrder = input.sort_order;
    changes.sort_order = input.sort_order;
  }

  let statusChanged = false;
  if (input.status !== undefined && input.status !== existing.status) {
    statusChanged = true;
    next.status = input.status;
    next.completedAt =
      input.status === "done" ? new Date().toISOString() : null;
    changes.status = input.status;
    changes.completed_at = next.completedAt;
  }

  const now = new Date().toISOString();
  next.updatedAt = now;

  await db
    .update(tasks)
    .set({
      projectId: next.projectId,
      title: next.title,
      notes: next.notes,
      status: next.status,
      priority: next.priority,
      dueAt: next.dueAt,
      sortOrder: next.sortOrder,
      completedAt: next.completedAt,
      updatedAt: now,
    })
    .where(and(eq(tasks.id, id), eq(tasks.userId, user.id)));

  const action: TaskActivityAction = statusChanged
    ? "status_changed"
    : "updated";
  await appendActivity(db, user, actor, id, action, changes);

  return taskToDto(await requireTask(db, user, id));
}

// ---------------------------------------------------------------------------
// Reorder
// ---------------------------------------------------------------------------

export async function reorderTasks(
  db: FlareMoDb,
  user: UserRow,
  actor: TaskActor,
  projectId: string,
  taskIds: string[],
): Promise<TaskDto[]> {
  const normalizedProjectId = parseTaskProjectId(projectId);
  await requireProject(db, user, normalizedProjectId);

  // Only reorder tasks the user actually owns within this project; a stray id
  // is ignored rather than failing the whole reorder.
  const owned = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, user.id),
        eq(tasks.projectId, normalizedProjectId),
        inArray(tasks.id, taskIds),
      ),
    );

  const now = new Date().toISOString();
  const byId = new Map(owned.map((row) => [row.id, row]));
  const ordered = taskIds.filter((id) => byId.has(id));
  for (const [index, id] of ordered.entries()) {
    await db
      .update(tasks)
      .set({ sortOrder: index, updatedAt: now })
      .where(and(eq(tasks.id, id), eq(tasks.userId, user.id)));
  }

  // A reorder is project-scoped, so the activity row has no single task id.
  await appendActivity(db, user, actor, null, "reordered", {
    project_id: normalizedProjectId,
    task_ids: ordered,
  });

  return listTasks(db, user, { projectId: normalizedProjectId });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function hardDeleteTask(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<{ ok: true }> {
  await requireTask(db, user, id);
  await db
    .delete(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, user.id)));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTaskProjectId(value: string): string {
  return value.startsWith("projects/") ? value : `projects/${value}`;
}
