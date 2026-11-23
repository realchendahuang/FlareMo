import type {
  CreateTaskInput,
  TaskActivityAction,
  TaskActivityDto,
  TaskDto,
  UpdateTaskInput,
} from "@flaremo/contracts";
import type { FlareMoDb, TaskActivityRow, TaskRow, UserRow } from "@flaremo/db";
import { taskActivity, tasks } from "@flaremo/db";
import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { chunkForD1, d1IdsPerStatement } from "./d1-limits";
import { NotFoundError, ValidationError } from "./errors";
import { createResourceId, parseResourceName } from "./ids";
import { setMemoTaskLineState } from "./memo-task-sync";
import { getMemoById } from "./memos-read";
import { updateMemo } from "./memos-write";
import { requireProject } from "./projects";

// D1 caps bound parameters per statement at 100. Leave room for the cutoff
// predicate that is repeated on delete after the initial candidate read.
const HARD_DELETE_BATCH_SIZE = 96;

/**
 * The actor behind a task mutation. Browser sessions are the owner; PATs
 * (agents and scripts) are agents. Both are first-class writers on tasks, so
 * the permission model relies on the append-only activity trail rather than
 * downgrading the agent's access.
 */
export type TaskActor = { type: "user" } | { type: "agent"; name?: string };

export type ListTasksOptions = {
  projectId?: string | null;
  status?: TaskRow["status"];
  priority?: TaskRow["priority"];
  /** Inclusive lower bound on `due_at` (YYYY-MM-DD). */
  dueFrom?: string | null;
  /** Inclusive upper bound on `due_at` (YYYY-MM-DD). */
  dueTo?: string | null;
  /** Only tasks scheduled from this memo (`memos/<id>` or a bare id). */
  sourceMemoId?: string | null;
  /** Recycle bin: include soft-deleted tasks. */
  includeDeleted?: boolean;
  pageSize?: number;
  pageToken?: string;
};

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

export function taskToDto(row: TaskRow): TaskDto {
  return {
    id: row.id,
    project_id: row.projectId,
    source_memo_id: row.sourceMemoId,
    title: row.title,
    notes: row.notes,
    status: row.status,
    priority: row.priority,
    due_at: row.dueAt,
    sort_order: row.sortOrder,
    completed_at: row.completedAt,
    deleted_at: row.deletedAt,
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
// Day math (mirrors apps/web/src/lib/calendar-date.ts)
// ---------------------------------------------------------------------------

/**
 * The day after a `YYYY-MM-DD` key. Used to turn "up to and including day D"
 * into an exclusive upper bound, so tasks whose stored value carries a time
 * component (legacy rows; writes are date-only today) still land on day D.
 */
export function nextDayKey(key: string): string {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Ownership / permission
// ---------------------------------------------------------------------------

/**
 * Resolve one of the caller's tasks. The default read excludes recycle-bin
 * rows (soft-deleted tasks 404 to every live read); the restore path opts back
 * in with `includeDeleted`.
 */
async function requireTask(
  db: FlareMoDb,
  user: UserRow,
  id: string,
  options: { includeDeleted?: boolean } = {},
): Promise<TaskRow> {
  const filters = [eq(tasks.id, id), eq(tasks.userId, user.id)];
  if (!options.includeDeleted) filters.push(isNull(tasks.deletedAt));
  const row = await db
    .select()
    .from(tasks)
    .where(and(...filters))
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
  const title = input.title.trim();
  if (!title) throw new ValidationError("Task title cannot be empty.");

  // An omitted or empty project id creates an unassigned task; a provided id
  // must still be one of the caller's projects.
  const projectId = input.project_id
    ? parseTaskProjectId(input.project_id)
    : null;
  if (projectId) await requireProject(db, user, projectId);

  const status = input.status ?? "todo";
  const priority = input.priority ?? "none";
  const sourceMemoId = normalizeSourceMemoId(input.source_memo_id);

  const now = new Date().toISOString();
  const row = await db
    .insert(tasks)
    .values({
      id: createResourceId("tasks"),
      userId: user.id,
      projectId,
      sourceMemoId,
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

const TASKS_PAGE_MAX = 100;

/**
 * List tasks with recycle-bin exclusion, project/status/priority/due-range
 * filters and cursor pagination. The cursor mirrors the memos list contract
 * (`page_size`/`page_token`, token = base64 sort key + id) so clients consume
 * both endpoints the same way.
 */
export async function listTasks(
  db: FlareMoDb,
  user: UserRow,
  input: ListTasksOptions = {},
): Promise<{ tasks: TaskDto[]; nextPageToken?: string }> {
  const pageSize = Math.min(
    Math.max(input.pageSize ?? TASKS_PAGE_MAX, 1),
    TASKS_PAGE_MAX,
  );
  const filters = [eq(tasks.userId, user.id)];
  if (!input.includeDeleted) filters.push(isNull(tasks.deletedAt));
  if (input.projectId) {
    filters.push(eq(tasks.projectId, parseTaskProjectId(input.projectId)));
  }
  if (input.status) filters.push(eq(tasks.status, input.status));
  if (input.priority) filters.push(eq(tasks.priority, input.priority));
  if (input.dueFrom) filters.push(gte(tasks.dueAt, input.dueFrom));
  if (input.dueTo) filters.push(lt(tasks.dueAt, nextDayKey(input.dueTo)));
  if (input.sourceMemoId) {
    filters.push(
      eq(tasks.sourceMemoId, normalizeSourceMemoId(input.sourceMemoId) ?? ""),
    );
  }
  const cursor = input.pageToken
    ? decodeTaskPageToken(input.pageToken)
    : undefined;
  if (cursor) {
    // Resume strictly after the cursor row on the (sortOrder, createdAt, id)
    // tie-break chain, matching the ORDER BY.
    const cursorFilter = or(
      gt(tasks.sortOrder, cursor.sortOrder),
      and(
        eq(tasks.sortOrder, cursor.sortOrder),
        or(
          gt(tasks.createdAt, cursor.createdAt),
          and(eq(tasks.createdAt, cursor.createdAt), gt(tasks.id, cursor.id)),
        ),
      ),
    );
    if (cursorFilter) filters.push(cursorFilter);
  }

  const rows = await db
    .select()
    .from(tasks)
    .where(and(...filters))
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt), asc(tasks.id))
    .limit(pageSize + 1);

  const page = rows.slice(0, pageSize);
  const next =
    rows.length > pageSize ? (page.at(-1) as TaskRow | undefined) : undefined;
  return {
    tasks: page.map(taskToDto),
    nextPageToken: next
      ? encodeTaskPageToken({
          sortOrder: next.sortOrder,
          createdAt: next.createdAt,
          id: next.id,
        })
      : undefined,
  };
}

/**
 * Counts for the sidebar reminder strip. One grouped query instead of
 * hydrating every open task: the strip only renders two integers.
 */
export async function getTaskReminderCounts(
  db: FlareMoDb,
  user: UserRow,
  date: string,
): Promise<{ due_today: number; overdue: number }> {
  const next = nextDayKey(date);
  const row = await db
    .select({
      due_today: sql<number>`coalesce(sum(case when ${tasks.dueAt} >= ${date} and ${tasks.dueAt} < ${next} then 1 else 0 end), 0)`,
      overdue: sql<number>`coalesce(sum(case when ${tasks.dueAt} < ${date} then 1 else 0 end), 0)`,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, user.id),
        isNull(tasks.deletedAt),
        isNotNull(tasks.dueAt),
        // `done` is the only closed state; todo/in_progress both count.
        inArray(tasks.status, ["todo", "in_progress"]),
      ),
    )
    .get();
  return {
    due_today: Number(row?.due_today ?? 0),
    overdue: Number(row?.overdue ?? 0),
  };
}

/**
 * Tasks linked to a page of memos, fetched once for the whole page instead of
 * every card subscribing to the all-tasks cache. Chunked because the memo
 * page can be 100 ids and D1 binds 100 parameters per statement.
 */
export async function listTasksForSourceMemos(
  db: FlareMoDb,
  user: UserRow,
  memoIds: readonly string[],
): Promise<TaskDto[]> {
  const ids = [
    ...new Set(
      memoIds
        .map((memoId) => normalizeSourceMemoId(memoId))
        .filter((id): id is string => id !== null),
    ),
  ];
  if (ids.length === 0) return [];
  const rows: TaskRow[] = [];
  for (const chunk of chunkForD1(ids, d1IdsPerStatement(2))) {
    rows.push(
      ...(await db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.userId, user.id),
            isNull(tasks.deletedAt),
            inArray(tasks.sourceMemoId, chunk),
          ),
        )
        .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt), asc(tasks.id))),
    );
  }
  return rows.map(taskToDto);
}

// A reorder is a project-scoped event and is the only writer that shifts many
// `sort_order` values at once, so the cursor carries the full tie-break chain
// (sortOrder, createdAt, id) matching the ORDER BY above.
type TaskCursor = { sortOrder: number; createdAt: string; id: string };

function encodeTaskPageToken(value: TaskCursor) {
  return btoa(JSON.stringify(value));
}

function decodeTaskPageToken(token: string): TaskCursor {
  try {
    const parsed = JSON.parse(atob(token)) as Partial<TaskCursor>;
    if (
      typeof parsed.sortOrder === "number" &&
      typeof parsed.createdAt === "string" &&
      typeof parsed.id === "string"
    ) {
      return parsed as TaskCursor;
    }
  } catch {
    // The validation error below gives callers one stable failure shape.
  }
  throw new ValidationError("Invalid page token");
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
    // null unassigns the task; a value must be one of the caller's projects.
    next.projectId = input.project_id
      ? parseTaskProjectId(input.project_id)
      : null;
    if (next.projectId) await requireProject(db, user, next.projectId);
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
  if (input.source_memo_id !== undefined) {
    next.sourceMemoId = normalizeSourceMemoId(input.source_memo_id);
    changes.source_memo_id = next.sourceMemoId;
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
      sourceMemoId: next.sourceMemoId,
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

  const wasDone = existing.status === "done";
  const isDone = next.status === "done";
  if (statusChanged && wasDone !== isDone && next.sourceMemoId) {
    await syncSourceMemoLine(db, user, next.sourceMemoId, next.title, isDone);
  }

  return taskToDto(await requireTask(db, user, id));
}

/**
 * Completing (or reopening) a task ticks the matching to-do line in the memo
 * it came from. Best effort: a memo that is gone, no longer the caller's to
 * edit, or no longer carries the line simply stays as it is.
 */
async function syncSourceMemoLine(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
  title: string,
  checked: boolean,
) {
  try {
    const memo = await getMemoById(db, user, memoId);
    if (memo.userId !== user.id || memo.status === "trashed") return;
    const content = setMemoTaskLineState(memo.content, title, checked);
    if (content === null) return;
    await updateMemo(db, user, memoId, { content });
  } catch {
    // The task update stands on its own.
  }
}

// ---------------------------------------------------------------------------
// Reorder
// ---------------------------------------------------------------------------

// Bounded so one request fans out into at most one bounded write batch.
const REORDER_MAX_TASKS = 200;

/**
 * Reorder a project's tasks in one D1 batch (a single implicit transaction).
 * A task id that does not belong to this project under this user is a hard
 * validation error, not a silent ignore — a stray id almost always means the
 * client mixed up boards.
 */
export async function reorderTasks(
  db: FlareMoDb,
  user: UserRow,
  actor: TaskActor,
  projectId: string,
  taskIds: string[],
): Promise<TaskDto[]> {
  if (taskIds.length > REORDER_MAX_TASKS) {
    throw new ValidationError(
      `Cannot reorder more than ${REORDER_MAX_TASKS} tasks at once.`,
    );
  }
  if (new Set(taskIds).size !== taskIds.length) {
    throw new ValidationError("Reorder task ids must be unique.");
  }
  const normalizedProjectId = parseTaskProjectId(projectId);
  await requireProject(db, user, normalizedProjectId);

  if (taskIds.length > 0) {
    // The ownership probe carries `userId` and `projectId` on top of the id
    // list, so it must be chunked as N + 2 bound parameters. The contract allows
    // 200 ids; one unbounded `inArray` would fail at 99.
    const ownedIds = new Set<string>();
    for (const idChunk of chunkForD1(taskIds, d1IdsPerStatement(2))) {
      const owned = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.userId, user.id),
            eq(tasks.projectId, normalizedProjectId),
            isNull(tasks.deletedAt),
            inArray(tasks.id, idChunk),
          ),
        );
      for (const row of owned) ownedIds.add(row.id);
    }
    const stray = taskIds.filter((id) => !ownedIds.has(id));
    if (stray.length > 0) {
      throw new ValidationError(
        `Task does not belong to this project: ${stray[0]}`,
      );
    }
  }

  const now = new Date().toISOString();
  const updateStatements = taskIds.map((id, index) =>
    db
      .update(tasks)
      .set({ sortOrder: index, updatedAt: now })
      .where(and(eq(tasks.id, id), eq(tasks.userId, user.id))),
  );
  // A reorder is project-scoped, so the activity row has no single task id.
  const activityStatement = db.insert(taskActivity).values({
    taskId: null,
    userId: user.id,
    actorType: actor.type,
    actorName: actor.type === "agent" ? (actor.name ?? null) : null,
    action: "reordered",
    changes: {
      project_id: normalizedProjectId,
      task_ids: taskIds,
    },
    createdAt: now,
  });
  await db.batch([
    ...updateStatements,
    activityStatement,
  ] as unknown as Parameters<FlareMoDb["batch"]>[0]);

  const listed = await listTasks(db, user, { projectId: normalizedProjectId });
  return listed.tasks;
}

// ---------------------------------------------------------------------------
// Recycle bin (soft delete)
// ---------------------------------------------------------------------------

/**
 * Soft-delete a task: it disappears from every live read path and lands in the
 * recycle bin until restore or the daily TTL purge. The activity trail stays
 * in place while the task is binned.
 */
export async function deleteTask(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<{ ok: true }> {
  await requireTask(db, user, id);
  const now = new Date().toISOString();
  await db
    .update(tasks)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(eq(tasks.id, id), eq(tasks.userId, user.id), isNull(tasks.deletedAt)),
    );
  return { ok: true };
}

export async function restoreTask(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<TaskDto> {
  await requireTask(db, user, id, { includeDeleted: true });
  await db
    .update(tasks)
    .set({ deletedAt: null, updatedAt: new Date().toISOString() })
    .where(and(eq(tasks.id, id), eq(tasks.userId, user.id)));
  return taskToDto(await requireTask(db, user, id));
}

/**
 * Hard-delete tasks whose recycle-bin TTL expired. The FK cascade removes
 * their activity rows. Projects hard-delete through their own sweep
 * (projects.ts), whose FK cascade covers the tasks binned together with them.
 */
export async function hardDeleteExpiredTasks(
  db: FlareMoDb,
  cutoff: string,
): Promise<number> {
  let deleted = 0;
  while (true) {
    const expired = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(lt(tasks.deletedAt, cutoff))
      .limit(HARD_DELETE_BATCH_SIZE)
      .all();
    if (expired.length === 0) break;

    const removed = await db
      .delete(tasks)
      .where(
        and(
          lt(tasks.deletedAt, cutoff),
          inArray(
            tasks.id,
            expired.map((row) => row.id),
          ),
        ),
      )
      .returning({ id: tasks.id });
    deleted += removed.length;
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// parseResourceName normalizes a bare id ("abc") or a namespaced one
// ("projects/abc") to the namespaced form, so callers can pass either.
function parseTaskProjectId(value: string): string {
  return parseResourceName(value.trim(), "projects");
}

// The bridge back to the memo a task was upgraded from. No FK on purpose: a
// memo can be hard-deleted without touching its upgraded tasks, and the DTO
// consumer validates the reference at read time.
function normalizeSourceMemoId(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? parseResourceName(trimmed, "memos") : null;
}
