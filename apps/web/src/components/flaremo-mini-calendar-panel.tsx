import { Link } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { useI18n } from "@/i18n";
import {
  buildMonthGrid,
  monthOf,
  todayKey,
  type WeekStart,
} from "@/lib/calendar-date";
import { useAllTasks } from "@/lib/task-views";

// Reminders shown above the time horizon in the explorer: open tasks due today
// or overdue. Deep-links straight to /projects where the user can manage and
// resolve them.

function useOpenTasks(rangeStart: string, rangeEnd: string) {
  const today = useMemo(() => todayKey(), []);
  const tasksQuery = useAllTasks();
  return useMemo(() => {
    const map = new Map<string, number>();
    let overdue = 0;
    let dueToday = 0;
    for (const task of tasksQuery.data?.tasks ?? []) {
      if (!task.due_at || task.status === "done") continue;
      if (task.due_at < rangeStart || task.due_at > rangeEnd) continue;
      map.set(task.due_at, (map.get(task.due_at) ?? 0) + 1);
      if (task.due_at < today) overdue += 1;
      if (task.due_at === today) dueToday += 1;
    }
    return { dueToday, map, overdue };
  }, [tasksQuery.data, rangeStart, rangeEnd, today]);
}

function currentMonthGrid(locale: string, today: string) {
  const weekStart: WeekStart = locale.startsWith("en") ? "sunday" : "monday";
  return buildMonthGrid(monthOf(today), weekStart, true);
}

export function MiniCalendarReminders() {
  const { locale, t } = useI18n();
  const today = useMemo(() => todayKey(), []);
  const grid = useMemo(() => currentMonthGrid(locale, today), [locale, today]);
  const { dueToday, overdue } = useOpenTasks(
    grid[0].key,
    grid[grid.length - 1].key,
  );

  if (dueToday <= 0 && overdue <= 0) return null;
  // One quiet line per reminder, styled like a sidebar row: a coloured dot
  // carries the urgency so the text can stay ink instead of shouting red.
  return (
    <div className="-mx-1 mb-2 flex flex-col">
      {dueToday > 0 && (
        <ReminderLink
          dotClassName="bg-brand-500"
          testId="mini-calendar-today-notice"
        >
          {t("calendar.overdueToday", { count: dueToday })}
        </ReminderLink>
      )}
      {overdue > 0 && (
        <ReminderLink dotClassName="bg-destructive">
          {t("calendar.overdueCount", { count: overdue })}
        </ReminderLink>
      )}
    </div>
  );
}

function ReminderLink({
  children,
  dotClassName,
  testId,
}: {
  children: ReactNode;
  dotClassName: string;
  testId?: string;
}) {
  return (
    <Link
      className="flex h-7 items-center gap-2 rounded-md px-2.5 text-xs text-foreground/75 outline-none motion-safe:transition-colors motion-safe:duration-150 hover:bg-muted/70 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/25"
      data-testid={testId}
      search={{ view: "today" }}
      to="/projects"
    >
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${dotClassName}`}
      />
      <span className="min-w-0 truncate">{children}</span>
    </Link>
  );
}
