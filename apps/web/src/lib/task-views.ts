import { useQuery } from "@tanstack/react-query";
import { listAllTasks, type Task } from "@/api";
import { addDays, todayKey } from "@/lib/calendar-date";
import { queryKeys } from "@/lib/query-keys";

/**
 * The one task cache every surface reads: the board, the sidebar reminders,
 * the daily review, keyword search and the memo badges. One key, one fetch
 * of every live task, so ticking a task anywhere moves it everywhere.
 */
export const allTasksQuery = {
  queryKey: queryKeys.tasks.all,
  queryFn: () => listAllTasks(),
} as const;

export function useAllTasks(options: { enabled?: boolean } = {}) {
  return useQuery({ ...allTasksQuery, enabled: options.enabled ?? true });
}

/**
 * Smart lists of the to-do page. They cut across projects, so a project is
 * where work is grouped and a view is when it is due.
 * - today: open and due today or earlier, plus what was finished today;
 * - upcoming: open and due within the next seven days;
 * - all: every live task.
 */
export type TaskView = "today" | "upcoming" | "all";

export const TASK_VIEWS: TaskView[] = ["today", "upcoming", "all"];

export function isTaskView(value: unknown): value is TaskView {
  return TASK_VIEWS.includes(value as TaskView);
}

export function taskInView(task: Task, view: TaskView, today = todayKey()) {
  if (view === "all") return true;
  if (!task.due_at) return false;
  const due = task.due_at.slice(0, 10);
  if (view === "today") {
    if (task.status !== "done") return due <= today;
    return (task.completed_at ?? "").slice(0, 10) === today && due <= today;
  }
  return task.status !== "done" && due > today && due <= addDays(today, 7);
}

/** Open tasks a view would show; the sidebar badge counts these. */
export function openCountInView(tasks: Task[], view: TaskView) {
  const today = todayKey();
  return tasks.filter(
    (task) => task.status !== "done" && taskInView(task, view, today),
  ).length;
}

/** Tasks filed from each memo, keyed by `memos/<id>`. */
export function tasksBySourceMemo(tasks: Task[]) {
  const index = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.source_memo_id) continue;
    const list = index.get(task.source_memo_id);
    if (list) list.push(task);
    else index.set(task.source_memo_id, [task]);
  }
  return index;
}
