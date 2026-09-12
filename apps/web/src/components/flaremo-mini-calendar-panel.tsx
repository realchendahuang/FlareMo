import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertCircleIcon } from "lucide-react";
import { useMemo } from "react";
import type { MemoStatsResponse } from "@/api";
import { listTasks } from "@/api";
import { FlareMoMiniCalendar } from "@/components/flaremo-calendar";
import { useI18n } from "@/i18n";
import {
  buildMonthGrid,
  dayFilterQuery,
  monthOf,
  todayKey,
  type WeekStart,
} from "@/lib/calendar-date";

// Explorer-side glanceable calendar. Notes come from the activity feed the
// heatmap already loaded (last 90 days, always covering the current month);
// dues are read straight from the user's task list. Clicking a day filters
// the timeline to that day.
//
// Reminders are exported separately because the explorer keeps them mounted
// above the trend/calendar switch: switching to the trend view must not hide
// open work.

// Open dues inside the visible month grid, keyed by day, plus the two roll-ups
// the reminders show. Both roll-ups are scoped to the grid so「本月已逾期」keeps
// meaning this month rather than all time. Mirrors what the mini calendar
// highlights, so the reminders and the grid never disagree.
function useOpenTasks(rangeStart: string, rangeEnd: string) {
  const today = useMemo(() => todayKey(), []);
  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: () => listTasks(),
  });
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
  return buildMonthGrid(monthOf(today), weekStart);
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
  return (
    <>
      {dueToday > 0 && (
        <Link
          className="mb-1.5 flex items-center gap-1.5 rounded-md px-1 py-1 text-xs font-medium text-flame-700 dark:text-flame-200 bg-flame-100 dark:bg-flame-400/12 motion-safe:transition-colors motion-safe:duration-150 hover:bg-flame-100/80 dark:hover:bg-flame-400/20 focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="mini-calendar-today-notice"
          to="/calendar"
        >
          <AlertCircleIcon className="shrink-0" />
          {t("calendar.overdueToday", { count: dueToday })}
        </Link>
      )}
      {overdue > 0 && (
        <p className="mb-1 px-1 text-xs text-destructive">
          {t("calendar.overdueCount", { count: overdue })}
        </p>
      )}
    </>
  );
}

export function MiniCalendarPanel({
  activity,
}: {
  activity: MemoStatsResponse["activity"];
}) {
  const { locale } = useI18n();
  const navigate = useNavigate();
  const today = useMemo(() => todayKey(), []);
  const monthKey = monthOf(today);
  const weekStart: WeekStart = locale.startsWith("en") ? "sunday" : "monday";
  const grid = useMemo(
    () => buildMonthGrid(monthKey, weekStart),
    [monthKey, weekStart],
  );
  const rangeStart = grid[0].key;
  const rangeEnd = grid[grid.length - 1].key;
  const notes = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of activity) {
      if (
        entry.count > 0 &&
        entry.date >= rangeStart &&
        entry.date <= rangeEnd
      ) {
        map.set(entry.date, entry.count);
      }
    }
    return map;
  }, [activity, rangeStart, rangeEnd]);

  const { map: openTasks } = useOpenTasks(rangeStart, rangeEnd);

  const jump = (day: string) => {
    void navigate({ to: `/?q=${encodeURIComponent(dayFilterQuery(day))}` });
  };

  return (
    <FlareMoMiniCalendar
      monthKey={monthKey}
      notes={notes}
      tasks={openTasks}
      today={today}
      onDayClick={jump}
    />
  );
}
