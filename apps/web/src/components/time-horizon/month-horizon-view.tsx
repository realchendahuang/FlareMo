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

export function MonthHorizonPureView({
  monthKey,
  today,
  selectedDay,
  locale,
  weekStart,
  notesCountMap,
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
  const hourlyDailyTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of hourlyData ?? []) {
      totals.set(row.date, (totals.get(row.date) ?? 0) + row.count);
    }
    return totals;
  }, [hourlyData]);

  return (
    <div className="flex flex-col gap-1.5">
      {/* 7 Weekday Headers: Clear orientation for the 7 columns */}
      <div className="grid grid-cols-7 gap-1">
        {["col-0", "col-1", "col-2", "col-3", "col-4", "col-5", "col-6"].map(
          (colId, i) => (
            <div
              className={cn(
                "text-center text-[10px] font-medium font-mono transition-opacity",
                displayMode === "calendar"
                  ? "text-foreground/75 dark:text-foreground/70 font-semibold"
                  : "text-foreground/60 dark:text-foreground/50",
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
                className="h-8.5 w-full rounded-[5px] border border-dashed border-border/20 bg-muted/10 opacity-30 pointer-events-none"
                key={cell.key}
              />
            );
          }

          const totalCount =
            hourlyDailyTotals.get(cell.key) ??
            notesCountMap.get(cell.key) ??
            0;
          const isToday = cell.key === today;
          const isSelected = cell.key === selectedDay;
          const dayNum = Number(cell.key.slice(8));
          const [q0, q1, q2, q3] = dayQuadrants.get(cell.key) ?? [0, 0, 0, 0];

          // ── 100% 对齐年视图：统一采用相同的质感与深浅阶梯 ──
          const activityStyle =
            totalCount <= 0
              ? "border-transparent bg-muted-foreground/15 dark:bg-muted/30 text-foreground/75 dark:text-foreground/70 hover:bg-muted-foreground/25 dark:hover:bg-muted/45"
              : totalCount === 1
                ? "border-primary/20 bg-primary/35 dark:border-primary/30 dark:bg-primary/30 text-brand-900 dark:text-white font-semibold shadow-2xs hover:bg-primary/45"
                : totalCount === 2
                  ? "border-primary/30 bg-primary/55 dark:border-primary/40 dark:bg-primary/50 text-brand-950 dark:text-white font-bold shadow-2xs hover:bg-primary/65"
                  : totalCount <= 4
                    ? "border-primary/50 bg-primary/75 dark:border-primary/60 dark:bg-primary/75 text-white font-bold shadow-xs hover:bg-primary/85"
                    : "border-primary bg-primary text-white dark:border-primary dark:bg-primary font-bold shadow-sm hover:brightness-110";

          return (
            <button
              className={cn(
                "group relative flex h-8.5 w-full items-center justify-center rounded-[5px] border transition-all select-none cursor-pointer active:scale-95",
                activityStyle,
                // ── 对齐年视图选中卡片：柔和品牌色微环与微气泡底色 ──
                isSelected &&
                  "border-brand-500/70 ring-1.5 ring-brand-500/35 bg-brand-500/15 dark:bg-brand-500/25 z-20 scale-[1.02] shadow-2xs",
                // ── 今日未选中时的柔和轮廓 ──
                !isSelected &&
                  isToday &&
                  "border-brand-500/40 ring-1 ring-brand-500/20 shadow-2xs font-bold",
                hoveredDate === cell.key && !isSelected && "scale-105 z-10",
                !isSelected && "hover:scale-105 hover:z-10",
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
                    "text-[12px] font-mono tabular-nums leading-none transition-opacity group-hover:opacity-0",
                    totalCount >= 3
                      ? "text-white font-bold drop-shadow-2xs"
                      : totalCount === 2
                        ? "text-brand-950 dark:text-white font-bold"
                        : totalCount === 1
                          ? "text-brand-800 dark:text-brand-200 font-semibold"
                          : "text-foreground/85 font-medium",
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
                    "absolute bottom-1 left-1/2 -translate-x-1/2 size-1 rounded-full transition-colors",
                    totalCount >= 3
                      ? "bg-white/80"
                      : "bg-foreground/50 dark:bg-foreground/60",
                  )}
                />
              )}

              {/* Hover Stacked Micro-Stripes: Previews the single vertical column of Day view! */}
              <div className="absolute inset-0 flex flex-col justify-center gap-[1.5px] p-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-background/95 dark:bg-background/95 rounded-[4px] shadow-xs pointer-events-none">
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
