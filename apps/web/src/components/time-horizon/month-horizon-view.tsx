// ============================================================================
// 2. Month Horizon View (Seamless Full-Tile Calendar Heatmap Carpet)
// ============================================================================
import { useMemo } from "react";
import { useI18n } from "@/i18n";
import {
  buildMonthGrid,
  type WeekStart,
  weekdayHeaders,
} from "@/lib/calendar-date";
import { buildDayQuadrants } from "@/lib/time-horizon";
import { cn } from "@/lib/utils";
import type { DisplayMode } from "./shared";

export type HourlyActivityRow = {
  date: string;
  hour: number;
  count: number;
};

/**
 * Sum month-scoped hourly rows into per-local-day totals.
 *
 * `getHourlyActivity` returns every hour of every day in the requested range
 * (zero hours included), so summing by `date` yields the day total the heat
 * grid needs without a second request. Exported so the aggregation can be
 * unit-tested without rendering the view.
 */
export function aggregateHourlyDailyTotals(
  hours: readonly HourlyActivityRow[] | undefined,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of hours ?? []) {
    totals.set(row.date, (totals.get(row.date) ?? 0) + row.count);
  }
  return totals;
}

export function MonthHorizonPureView({
  monthKey,
  today,
  selectedDay,
  locale,
  weekStart,
  notesCountMap,
  preferHourlyHeat,
  hourlyData,
  isLoading: _isLoading,
  displayMode,
  hoveredDate,
  onDrillToWeek,
  onDrillToDay,
  onHoverDate,
  onHoverTip,
}: {
  monthKey: string;
  today: string;
  selectedDay: string;
  locale: string;
  weekStart: WeekStart;
  notesCountMap: Map<string, number>;
  /**
   * Whether the hourly aggregation may drive the heat colors. False while a
   * space partition is active, because the hourly endpoint is author-scoped
   * and has no team partition to mirror the space-filtered stats.
   */
  preferHourlyHeat: boolean;
  hourlyData?: Array<{ date: string; hour: number; count: number }>;
  isLoading?: boolean;
  displayMode: DisplayMode;
  hoveredDate?: string | null;
  onDrillToWeek?: (day: string) => void;
  onDrillToDay?: (day: string) => void;
  onHoverDate?: (day: string | null) => void;
  onHoverTip: (tip: string | null) => void;
}) {
  const { t } = useI18n();
  const grid = useMemo(
    () => buildMonthGrid(monthKey, weekStart, true),
    [monthKey, weekStart],
  );
  const headers = weekdayHeaders(weekStart, locale, "narrow");

  // Map daily quadrants (night, morning, afternoon, evening) for the hover stacked-stripes preview
  const dayQuadrants = useMemo(
    () => buildDayQuadrants(hourlyData ?? []),
    [hourlyData],
  );

  // Aggregate daily totals from the month-scoped hourly query. This is the
  // primary source because it's anchored to the exact month from/to via
  // monthHourlyQuery, so historical months outside the shared stats' trailing
  // 366-day window (which is anchored to "today" for streak/tags) still render
  // correct heat colors. Fall back to notesCountMap only while the month
  // query is still in flight.
  const hourlyDailyTotals = useMemo(
    () => aggregateHourlyDailyTotals(hourlyData),
    [hourlyData],
  );

  return (
    <div className="flex flex-col gap-1.5">
      {/* 7 Weekday Headers: Clear orientation for the 7 columns */}
      <div className="grid grid-cols-7 gap-1">
        {["col-0", "col-1", "col-2", "col-3", "col-4", "col-5", "col-6"].map(
          (colId, i) => (
            <div
              className={cn(
                "pb-0.5 text-center text-xs font-medium text-muted-foreground/80",
              )}
              key={colId}
            >
              {headers[i]}
            </div>
          ),
        )}
      </div>

      {/* Grid of Days: 7 Columns x 5~6 Rows of Solid, Cohesive Tiles */}
      <div className="grid grid-cols-7 gap-1">
        {grid.map((cell) => {
          if (!cell.inMonth) {
            return (
              <div
                aria-hidden="true"
                className="pointer-events-none mx-auto aspect-square w-full max-w-8"
                key={cell.key}
              />
            );
          }

          const totalCount = preferHourlyHeat
            ? (hourlyDailyTotals.get(cell.key) ??
              notesCountMap.get(cell.key) ??
              0)
            : (notesCountMap.get(cell.key) ?? 0);
          const isToday = cell.key === today;
          const isSelected = cell.key === selectedDay;
          const dayNum = Number(cell.key.slice(8));
          const [q0, q1, q2, q3] = dayQuadrants.get(cell.key) ?? [0, 0, 0, 0];

          // ── 100% 对齐年视图：统一采用相同的质感与深浅阶梯 ──
          // Ember 3 heat: the tint carries the activity, the figure stays
          // ink (red numerals on every busy day read as alarms). Only the
          // busiest step is solid, with its own foreground.
          const activityStyle =
            totalCount <= 0
              ? "text-foreground/70 hover:bg-muted"
              : totalCount === 1
                ? "bg-primary/10 text-foreground hover:bg-primary/16 dark:bg-primary/14"
                : totalCount === 2
                  ? "bg-primary/20 text-foreground hover:bg-primary/26 dark:bg-primary/24"
                  : totalCount <= 4
                    ? "bg-primary/36 text-foreground hover:bg-primary/42 dark:bg-primary/40"
                    : "bg-primary font-medium text-primary-foreground hover:bg-primary/90";
          return (
            <button
              className={cn(
                "group relative mx-auto flex aspect-square w-full max-w-8 cursor-pointer items-center justify-center rounded-md outline-none transition-colors select-none focus-visible:ring-3 focus-visible:ring-ring/30",
                activityStyle,
                // Selection is an ink ring (works over every heat level);
                // today is marked by weight + the dot below, not a box.
                isSelected && "z-10 ring-[1.5px] ring-foreground/75",
                isToday && "font-semibold",
                hoveredDate === cell.key &&
                  !isSelected &&
                  "ring-1 ring-foreground/25",
              )}
              key={cell.key}
              type="button"
              onClick={() => (onDrillToWeek ?? onDrillToDay)?.(cell.key)}
              onMouseEnter={() => {
                onHoverDate?.(cell.key);
                if (totalCount > 0) {
                  onHoverTip(
                    `${cell.key} · ${t("explorer.dayBreakdown", {
                      count: totalCount,
                      q0,
                      q1,
                      q2,
                      q3,
                    })}`,
                  );
                } else {
                  onHoverTip(`${cell.key} · ${t("explorer.noRecords")}`);
                }
              }}
              onMouseLeave={() => {
                onHoverDate?.(null);
                onHoverTip(null);
              }}
            >
              {/* Calendar Mode: 日期数字始终 100% 绝对水平垂直居中，不放任何跳动数字 */}
              {displayMode === "calendar" ? (
                <span
                  className={cn(
                    "text-xs leading-none tabular-nums transition-opacity group-hover:opacity-0",
                    totalCount > 0 ? "font-semibold" : "font-normal",
                    // Room for the today dot underneath, even in a 24px cell.
                    isToday && "-translate-y-[2px]",
                  )}
                >
                  {dayNum}
                </span>
              ) : null}

              {/* 今日专属指示微点（Today Micro-Dot, 绝不形成下划线错觉） */}
              {isToday && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute bottom-[2px] left-1/2 -translate-x-1/2 size-[3px] rounded-full transition-colors",
                    totalCount >= 5 ? "bg-primary-foreground/85" : "bg-primary",
                  )}
                />
              )}

              {/* Hover Stacked Micro-Stripes: Previews the single vertical column of Day view! */}
              <div className="absolute inset-0 flex flex-col justify-center gap-[1.5px] p-1 opacity-0 group-hover:opacity-100 transition-opacity rounded-md bg-card pointer-events-none ring-1 ring-border">
                <div
                  className={cn(
                    "h-[2px] w-full rounded-[0.5px] transition-colors",
                    q0 > 0
                      ? "bg-primary"
                      : "bg-muted-foreground/20 dark:bg-muted/40",
                  )}
                  title={t("explorer.periodNight")}
                />
                <div
                  className={cn(
                    "h-[2px] w-full rounded-[0.5px] transition-colors",
                    q1 > 0
                      ? "bg-primary"
                      : "bg-muted-foreground/20 dark:bg-muted/40",
                  )}
                  title={t("explorer.periodMorning")}
                />
                <div
                  className={cn(
                    "h-[2px] w-full rounded-[0.5px] transition-colors",
                    q2 > 0
                      ? "bg-primary"
                      : "bg-muted-foreground/20 dark:bg-muted/40",
                  )}
                  title={t("explorer.periodAfternoon")}
                />
                <div
                  className={cn(
                    "h-[2px] w-full rounded-[0.5px] transition-colors",
                    q3 > 0
                      ? "bg-primary"
                      : "bg-muted-foreground/20 dark:bg-muted/40",
                  )}
                  title={t("explorer.periodEvening")}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
