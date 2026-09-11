import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
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

  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: () => listTasks(),
  });
  const tasks = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of tasksQuery.data?.tasks ?? []) {
      if (!task.due_at || task.status === "done") continue;
      if (task.due_at < rangeStart || task.due_at > rangeEnd) continue;
      map.set(task.due_at, (map.get(task.due_at) ?? 0) + 1);
    }
    return map;
  }, [tasksQuery.data, rangeStart, rangeEnd]);

  const jump = (day: string) => {
    void navigate({ to: `/?q=${encodeURIComponent(dayFilterQuery(day))}` });
  };

  return (
    <FlareMoMiniCalendar
      monthKey={monthKey}
      notes={notes}
      tasks={tasks}
      today={today}
      onDayClick={jump}
    />
  );
}
