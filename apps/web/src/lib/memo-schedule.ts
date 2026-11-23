import { createTask, listTasks } from "@/api";
import { addDays, todayKey } from "@/lib/calendar-date";
import { memoTitle } from "@/lib/memo";
import { memoTaskLines } from "@/lib/memo-tasks";

/**
 * A date on a memo means "remind me": sending a scheduled memo files its
 * open to-dos as tasks due that day, optionally in a project. The memo stays
 * the record of the thought; the tasks are where the work is tracked, and
 * ticking either side ticks the other (server-side, matched by the task's
 * `source_memo_id` and its title, which is the to-do line's text).
 */
export type MemoSchedule = {
  /**
   * Local calendar day, `YYYY-MM-DD`, as tasks store `due_at`. Absent when
   * the author only files the to-dos into a project, with no reminder.
   */
  due?: string;
  /** `projects/<id>`; absent files the tasks under "all tasks". */
  projectId?: string;
};

/**
 * The task titles a scheduled memo turns into. Every open to-do line becomes
 * one task; a memo with no to-do lines becomes a single task named after its
 * first line of prose. A memo whose to-dos are all ticked schedules nothing.
 */
export function scheduledTaskTitles(content: string): string[] {
  const lines = memoTaskLines(content);
  if (lines.length > 0) {
    return [
      ...new Set(lines.filter((line) => !line.checked).map((l) => l.text)),
    ].filter(Boolean);
  }
  const title = memoTitle(content, 200);
  return title ? [title] : [];
}

/** Quick picks offered in the schedule menu, relative to today. */
export function scheduleQuickPicks(now = new Date()) {
  const today = todayKey(now);
  // Days until next Monday: always 1–7, so "next Monday" is never today.
  const untilMonday = (8 - now.getDay()) % 7 || 7;
  return {
    today,
    tomorrow: addDays(today, 1),
    nextMonday: addDays(today, untilMonday),
  };
}

/**
 * Files the scheduled memo's tasks. Titles already filed for this memo are
 * skipped, so replaying a queued submission never duplicates its tasks.
 * Returns how many tasks were created.
 */
export async function fileScheduledTasks(
  memoName: string,
  content: string,
  schedule: MemoSchedule,
): Promise<number> {
  const titles = scheduledTaskTitles(content);
  if (titles.length === 0) return 0;
  const existing = await listTasks({
    source_memo_id: memoName,
    page_size: 100,
  });
  const filed = new Set(existing.tasks.map((task) => task.title));
  let created = 0;
  for (const title of titles) {
    if (filed.has(title)) continue;
    await createTask({
      title,
      source_memo_id: memoName,
      ...(schedule.due ? { due_at: schedule.due } : {}),
      ...(schedule.projectId ? { project_id: schedule.projectId } : {}),
    });
    created += 1;
  }
  return created;
}
