import { apiRequest } from "./client";
import type {
  CreateProjectRequest,
  CreateTaskRequest,
  Project,
  Task,
  UpdateProjectRequest,
  UpdateTaskRequest,
} from "./types";

// --- Projects ---------------------------------------------------------------

export async function listProjects(
  params: {
    status?: Project["status"];
    query?: string;
    include_deleted?: boolean;
  } = {},
) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.query) query.set("query", params.query);
  if (params.include_deleted) query.set("include_deleted", "true");
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiRequest<{ projects: Project[] }>(`/api/app/projects${suffix}`);
}

export async function createProject(input: CreateProjectRequest) {
  return apiRequest<{ project: Project }>("/api/app/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateProject(id: string, input: UpdateProjectRequest) {
  return apiRequest<{ project: Project }>(
    `/api/app/projects/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export async function archiveProject(id: string, archived: boolean) {
  return apiRequest<{ project: Project }>(
    `/api/app/projects/${encodeURIComponent(id)}/${
      archived ? "archive" : "unarchive"
    }`,
    { method: "POST" },
  );
}

export async function deleteProject(id: string) {
  return apiRequest<{ ok: true }>(
    `/api/app/projects/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

// DELETE is a soft delete; this pulls a binned project — and the tasks that
// went with it — back out of the recycle bin.
export async function restoreProject(id: string) {
  return apiRequest<{ project: Project }>(
    `/api/app/projects/${encodeURIComponent(id)}/restore`,
    { method: "POST" },
  );
}

// --- Tasks ------------------------------------------------------------------

export async function listTasks(
  params: {
    project_id?: string;
    status?: Task["status"];
    priority?: Task["priority"];
    due_from?: string;
    due_to?: string;
    source_memo_id?: string;
    include_deleted?: boolean;
    page_size?: number;
    page_token?: string;
  } = {},
) {
  const query = new URLSearchParams();
  if (params.project_id) query.set("project_id", params.project_id);
  if (params.status) query.set("status", params.status);
  if (params.priority) query.set("priority", params.priority);
  if (params.due_from) query.set("due_from", params.due_from);
  if (params.due_to) query.set("due_to", params.due_to);
  if (params.source_memo_id) query.set("source_memo_id", params.source_memo_id);
  if (params.include_deleted) query.set("include_deleted", "true");
  if (params.page_size) query.set("page_size", String(params.page_size));
  if (params.page_token) query.set("page_token", params.page_token);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiRequest<{ tasks: Task[]; next_page_token?: string }>(
    `/api/app/tasks${suffix}`,
  );
}

/** Two counts for the sidebar strip; no task rows cross the wire. */
export async function getTaskReminderCounts(date: string) {
  return apiRequest<{ due_today: number; overdue: number }>(
    `/api/app/tasks/reminders?date=${encodeURIComponent(date)}`,
  );
}

/** Tasks attached to the memos currently on screen, one request per page. */
export async function listTasksForSourceMemos(memoIds: string[]) {
  const query = new URLSearchParams({ memo_ids: memoIds.join(",") });
  return apiRequest<{ tasks: Task[] }>(
    `/api/app/tasks/badges?${query.toString()}`,
  );
}

/**
 * Every live task matching the filter, following the cursor. A single page
 * holds 30 rows by default, which silently dropped tasks from the board, the
 * reminders and the memo badges once a user had more than that. Capped at
 * 2 000 rows (20 full pages) so a runaway cursor cannot loop forever.
 */
export async function listAllTasks(
  params: Omit<
    Parameters<typeof listTasks>[0],
    "page_token" | "page_size"
  > = {},
) {
  const tasks: Task[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const result = await listTasks({
      ...params,
      page_size: 100,
      page_token: pageToken,
    });
    tasks.push(...result.tasks);
    pageToken = result.next_page_token;
    if (!pageToken) break;
  }
  return { tasks };
}

// A project-scoped sort: assigns `sort_order` = list index to every id given.
export async function reorderTasks(projectId: string, taskIds: string[]) {
  return apiRequest<{ tasks: Task[] }>("/api/app/tasks/reorder", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, task_ids: taskIds }),
  });
}

export async function createTask(input: CreateTaskRequest) {
  return apiRequest<{ task: Task }>("/api/app/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateTask(id: string, input: UpdateTaskRequest) {
  return apiRequest<{ task: Task }>(
    `/api/app/tasks/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export async function deleteTask(id: string) {
  return apiRequest<{ ok: true }>(`/api/app/tasks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// DELETE is a soft delete; this pulls a binned task back out of the bin.
export async function restoreTask(id: string) {
  return apiRequest<{ task: Task }>(
    `/api/app/tasks/${encodeURIComponent(id)}/restore`,
    { method: "POST" },
  );
}
