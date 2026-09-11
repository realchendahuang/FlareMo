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
export function MiniCalendarPanel({
  activity,
}: {
  activity: MemoStatsResponse["activity"];
}) {
  const { locale, t } = useI18n();
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

  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: () => listTasks(),
  });
  const openTasks = useMemo(() => {
    const map = new Map<string, number>();
    let overdue = 0;
    for (const task of tasksQuery.data?.tasks ?? []) {
      if (!task.due_at || task.status === "done") continue;
      if (task.due_at < rangeStart || task.due_at > rangeEnd) continue;
      map.set(task.due_at, (map.get(task.due_at) ?? 0) + 1);
      if (task.due_at < today) overdue += 1;
    }
    return { map, overdue };
  }, [tasksQuery.data, rangeStart, rangeEnd, today]);

  const jump = (day: string) => {
    void navigate({ to: `/?q=${encodeURIComponent(dayFilterQuery(day))}` });
  };

  const dueToday = openTasks.map.get(today) ?? 0;

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
      {openTasks.overdue > 0 && (
        <p className="mb-1 px-1 text-xs text-destructive">
          {t("calendar.overdueCount", { count: openTasks.overdue })}
        </p>
      )}
      <FlareMoMiniCalendar
        monthKey={monthKey}
        notes={notes}
        tasks={openTasks.map}
        today={today}
        onDayClick={jump}
      />
    </>
  );
}
