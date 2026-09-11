import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { Task } from "@/api";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import {
  buildMonthGrid,
  formatMonthTitle,
  type WeekStart,
  weekdayLabels,
} from "@/lib/calendar-date";
import { cn } from "@/lib/utils";

export type CalendarDateCell = {
  notes: number;
  note_tasks: number;
  tasks: Task[];
};

export type FlareMoCalendarProps = {
  monthKey: string;
  today: string;
  selected?: string;
  // key -> notes count / due tasks; only optional for the mini calendar.
  data: Map<string, CalendarDateCell>;
  onMonthChange: (direction: 1 | -1) => void;
  onDayClick?: (dayKey: string, cell?: CalendarDateCell) => void;
  // Drop target for drag-to-reschedule of a scheduled task.
  onTaskDrop?: (dayKey: string) => void;
  // Renders task titles inside day cells (full calendar only).
  showTaskTitles?: boolean;
  className?: string;
};

const heat = (count: number) => {
  if (count <= 0) return undefined;
  if (count === 1) return "bg-primary/30";
  if (count === 2) return "bg-primary/55";
  if (count === 3) return "bg-primary/75";
  return "bg-primary";
};

// One grid, two form factors: the calendar page renders this interactive so
// dates are schedule entries; the explorer mini calendar reuses the same
// primitives in a read-only compact variant.
export const FlareMoCalendar = memo(function FlareMoCalendar({
  data,
  monthKey,
  onDayClick,
  onMonthChange,
  onTaskDrop,
  selected,
  showTaskTitles = false,
  today,
  className,
}: FlareMoCalendarProps) {
  const { locale, t } = useI18n();
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const weekStart: WeekStart = locale.startsWith("en") ? "sunday" : "monday";
  const grid = useMemo(
    () => buildMonthGrid(monthKey, weekStart),
    [monthKey, weekStart],
  );

  const weekdays = useMemo(
    () =>
      weekdayLabels(weekStart, (day) =>
        new Date(2026, 8, day).toLocaleDateString(locale, {
          weekday: "narrow",
        }),
      ),
    [weekStart, locale],
  );

  const monthTitle = useMemo(
    () => formatMonthTitle(monthKey, locale),
    [locale, monthKey],
  );

  return (
    <div className={cn("flex flex-col", className)}>
      <header className="flex items-center gap-2">
        <div className="font-heading min-w-0 flex-1 truncate text-base font-semibold">
          {monthTitle}
        </div>
        <Button
          aria-label={t("calendar.prevMonth")}
          size="icon-sm"
          type="button"
          variant="ghost"
          onClick={() => onMonthChange(-1)}
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          aria-label={t("calendar.nextMonth")}
          size="icon-sm"
          type="button"
          variant="ghost"
          onClick={() => onMonthChange(1)}
        >
          <ChevronRightIcon />
        </Button>
      </header>
      <div className="mt-2 grid grid-cols-7 text-xs text-muted-foreground">
        {weekdays.map((label) => (
          <span
            aria-hidden="true"
            key={label}
            className="px-1 pb-1 text-center"
          >
            {label}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px" data-testid="calendar-grid">
        {grid.map((day) => {
          const cell = data.get(day.key);
          const isToday = day.key === today;
          const isSelected = selected === day.key;
          const taskCount = cell?.tasks.length ?? 0;
          const overdueCount =
            cell?.tasks.filter(
              (task) =>
                task.status !== "done" &&
                task.due_at !== null &&
                task.due_at < today,
            ).length ?? 0;
          return (
            <button
              aria-current={isToday ? "date" : undefined}
              aria-label={t("calendar.day", { date: day.key })}
              data-testid={`calendar-day-${day.key}`}
              key={day.key}
              type="button"
              onClick={() => {
                setDragOverKey(null);
                onDayClick?.(day.key, cell);
              }}
              onDragOver={(event) => {
                if (!onTaskDrop) return;
                event.preventDefault();
                setDragOverKey(day.key);
              }}
              onDragLeave={() => {
                if (dragOverKey === day.key) setDragOverKey(null);
              }}
              onDrop={(event) => {
                if (!onTaskDrop) return;
                event.preventDefault();
                setDragOverKey(null);
                onTaskDrop(day.key);
              }}
              className={cn(
                "flex min-h-11 flex-col items-center rounded-md px-0.5 py-0.5 text-xs motion-safe:transition-colors motion-safe:duration-150",
                day.inMonth ? "text-foreground" : "text-muted-foreground/40",
                isToday && "ring-1 ring-flame-500",
                isSelected
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted",
                onTaskDrop &&
                  dragOverKey === day.key &&
                  "ring-2 ring-flame-500",
              )}
            >
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full tabular-nums",
                  isToday && "bg-flame-500 font-semibold text-white",
                )}
              >
                {day.key.slice(-2)}
              </span>
              {/* Heat dot: notes weight the background set, tasks pin a ring. */}
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 h-1 w-4 max-w-4 rounded-full",
                  (cell?.notes ?? 0) + taskCount > 0 &&
                    (heat(cell?.notes ?? 0) ?? "bg-primary/30"),
                )}
              />
              {showTaskTitles && taskCount > 0 ? (
                <>
                  {cell!.tasks.slice(0, 2).map((task) => (
                    <span
                      className={cn(
                        "mt-0.5 w-full truncate rounded px-0.5 text-left text-[10px] leading-4",
                        task.status === "done"
                          ? "text-muted-foreground line-through"
                          : day.key < today
                            ? "bg-destructive/10 text-destructive"
                            : "bg-muted text-foreground",
                      )}
                      key={task.id}
                    >
                      {task.title}
                    </span>
                  ))}
                  {taskCount > 2 && (
                    <span className="text-[10px] tabular-nums opacity-60">
                      +{taskCount - 2}
                    </span>
                  )}
                </>
              ) : taskCount > 0 ? (
                <>
                  <span className="mt-0.5 text-[10px] tabular-nums opacity-60">
                    {overdueCount > 0
                      ? t("calendar.dayOverdue", { count: overdueCount })
                      : t("calendar.dayTasks", { count: taskCount })}
                  </span>
                  {overdueCount > 0 && (
                    <span
                      aria-hidden="true"
                      className="mt-0.5 h-1 w-4 max-w-4 rounded-full bg-destructive"
                    />
                  )}
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
});

export type FlareMoMiniCalendarProps = {
  monthKey: string;
  today: string;
  activeDay?: string;
  onDayClick: (dayKey: string) => void;
  notes: Map<string, number>;
  tasks: Map<string, number>;
  className?: string;
};

// Read-only companion for the explorer sidebar. Shares the grid primitives
// with the full calendar; deliberately non-interactive beyond picking a day.
export const FlareMoMiniCalendar = memo(function FlareMoMiniCalendar({
  activeDay,
  className,
  monthKey,
  notes,
  onDayClick,
  tasks,
  today,
}: FlareMoMiniCalendarProps) {
  const { locale, t } = useI18n();
  const weekStart: WeekStart = locale.startsWith("en") ? "sunday" : "monday";
  const grid = useMemo(
    () => buildMonthGrid(monthKey, weekStart),
    [monthKey, weekStart],
  );
  const weekdays = useMemo(
    () =>
      weekdayLabels(weekStart, (day) =>
        new Date(2026, 8, day).toLocaleDateString(locale, {
          weekday: "narrow",
        }),
      ),
    [weekStart, locale],
  );
  const monthTitle = useMemo(
    () => formatMonthTitle(monthKey, locale),
    [locale, monthKey],
  );

  return (
    <div className={cn("text-xs", className)} data-testid="mini-calendar">
      <div className="mb-1.5 flex items-center justify-between px-0.5 font-medium">
        <span>{monthTitle}</span>
        <Button
          aria-label={t("nav.calendar")}
          size="xs"
          type="button"
          variant="ghost"
          onClick={() => onDayClick(today)}
        >
          {t("calendar.todayMini")}
        </Button>
      </div>
      <div className="grid grid-cols-7 text-muted-foreground">
        {weekdays.map((label) => (
          <span aria-hidden="true" key={label} className="text-center">
            {label}
          </span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-y-0.5">
        {grid.map((day) => {
          const noteCount = notes.get(day.key) ?? 0;
          const taskCount = tasks.get(day.key) ?? 0;
          const heatStrength =
            noteCount + taskCount <= 0
              ? undefined
              : noteCount + taskCount <= 1
                ? "bg-primary/30"
                : "bg-primary/60";
          const hasSchedule = taskCount > 0;
          return (
            <button
              aria-label={t("calendar.day", { date: day.key })}
              key={`d-${day.key}`}
              type="button"
              onClick={() => onDayClick(day.key)}
              className={cn(
                "flex h-7 w-full items-center justify-center rounded-[3px] motion-safe:transition-colors motion-safe:duration-150",
                day.inMonth ? "" : "opacity-30",
                activeDay === day.key ? "bg-accent" : "hover:bg-muted",
                hasSchedule &&
                  activeDay !== day.key &&
                  (day.key < today
                    ? "ring-2 ring-destructive/60 dark:ring-destructive/50"
                    : "ring-2 ring-flame-500/70 dark:ring-flame-400/60"),
              )}
            >
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full tabular-nums",
                  today === day.key && "bg-flame-500 font-semibold text-white",
                  heatStrength,
                )}
              >
                {day.key.slice(-2)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
});
