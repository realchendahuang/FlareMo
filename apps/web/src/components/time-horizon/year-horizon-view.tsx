// ============================================================================
// 1. Year Horizon View (365 Micro-Dots, Clean Division of Labor)
// ============================================================================
import { useMemo } from "react";
import type { MemoStatsResponse } from "@/api";
import { useI18n } from "@/i18n";
import { heatmapColor } from "@/lib/activity";
import type { WeekStart } from "@/lib/calendar-date";
import { buildActivityCountMap } from "@/lib/time-horizon";
import { cn } from "@/lib/utils";
import type { DisplayMode } from "./shared";

export function YearHorizonPureView({
  year,
  today,
  weekStart,
  activity,
  displayMode,
  onDrillToMonth,
  onHoverTip,
}: {
  year: number;
  today: string;
  weekStart: WeekStart;
  activity: MemoStatsResponse["activity"];
  displayMode: DisplayMode;
  onDrillToMonth: (monthKey: string) => void;
  onHoverTip: (tip: string | null) => void;
}) {
  const { locale, t } = useI18n();
  // Month names come from Intl rather than a translated table, so every locale
  // (and every future one) is correct without a catalog entry per month.
  const monthShort = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short" }),
    [locale],
  );
  const countMap = useMemo(() => buildActivityCountMap(activity), [activity]);

  // Build 12 calendar arrays for each month
  const monthGrids = useMemo(() => {
    return Array.from({ length: 12 }, (_, m) => {
      const monthKey = `${year}-${String(m + 1).padStart(2, "0")}`;
      const daysCount = new Date(year, m + 1, 0).getDate();
      const firstDow = new Date(year, m, 1).getDay(); // 0 is Sunday
      const lead = weekStart === "monday" ? (firstDow + 6) % 7 : firstDow;

      let monthTotal = 0;
      let monthActiveDays = 0;

      const cells: Array<{
        key: string;
        day?: number;
        count?: number;
        isPad?: boolean;
      }> = [];
      // Leading padding
      for (let p = 0; p < lead; p++) {
        cells.push({ key: `pad-${m}-${p}`, isPad: true });
      }
      // Real days
      for (let d = 1; d <= daysCount; d++) {
        const key = `${monthKey}-${String(d).padStart(2, "0")}`;
        const c = countMap.get(key) ?? 0;
        monthTotal += c;
        if (c > 0) monthActiveDays++;
        cells.push({ key, day: d, count: c, isPad: false });
      }

      return {
        monthIndex: m,
        monthKey,
        label: monthShort.format(new Date(year, m, 1)),
        total: monthTotal,
        activeDays: monthActiveDays,
        cells,
      };
    });
  }, [year, weekStart, countMap, monthShort]);

  return (
    <div className="grid grid-cols-3 gap-x-2.5 gap-y-2 py-0.5">
      {monthGrids.map((m) => {
        const isCurrentMonth = today.startsWith(m.monthKey);

        return (
          <button
            className={cn(
              "group relative flex flex-col rounded-lg border p-1.5 transition-all text-start",
              displayMode === "heatmap"
                ? cn(
                    "border-border/50 bg-background/50 hover:border-brand-500/40 hover:bg-background/80 dark:border-border/20 dark:bg-background/20 dark:hover:border-brand-500/40 dark:hover:bg-brand-500/5",
                    isCurrentMonth &&
                      "border-brand-500/60 ring-1 ring-brand-500/30 bg-brand-500/[0.03] dark:bg-brand-500/10",
                  )
                : cn(
                    "border-border/70 bg-card/75 hover:border-brand-500/50 hover:bg-card dark:border-border/40 dark:bg-card/45 dark:hover:border-brand-500/50 dark:hover:bg-brand-500/5",
                    isCurrentMonth &&
                      "border-brand-500 bg-brand-500/10 ring-1 ring-brand-500/30",
                  ),
            )}
            key={m.monthKey}
            type="button"
            onClick={() => onDrillToMonth(m.monthKey)}
            onMouseEnter={() =>
              onHoverTip(
                t("explorer.yearMonthSummary", {
                  year,
                  month: m.label,
                  count: m.total,
                  days: m.activeDays,
                }),
              )
            }
            onMouseLeave={() => onHoverTip(null)}
          >
            {/* Top axis: ONLY in Calendar mode! In Heatmap mode, strictly NO TEXT! */}
            {displayMode === "calendar" ? (
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-foreground/80 dark:text-foreground/75">
                  {m.label}
                </span>
                {m.total > 0 && (
                  <span className="text-[10px] font-mono tabular-nums text-brand-600 dark:text-brand-400">
                    {m.total}
                  </span>
                )}
              </div>
            ) : null}

            {/* 7 Columns Micro-Dots Matrix (~30 Dots per Month) */}
            <div className="grid grid-cols-7 gap-[2px]">
              {m.cells.map((cell) => {
                if (cell.isPad) {
                  return <div className="size-[5.5px]" key={cell.key} />;
                }
                const isDayToday = cell.key === today;
                const count = cell.count ?? 0;

                return (
                  <div
                    className={cn(
                      "size-[5.5px] rounded-[1px] transition-all",
                      heatmapColor(count),
                      isDayToday && "ring-1 ring-brand-500 scale-125 z-10",
                      "group-hover:opacity-95",
                    )}
                    key={cell.key}
                  />
                );
              })}
            </div>
          </button>
        );
      })}
    </div>
  );
}
