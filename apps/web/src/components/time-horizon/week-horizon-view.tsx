import { useMemo } from "react";
import { useI18n } from "@/i18n";
import { heatmapColor } from "@/lib/activity";
import { buildWeekSlotCountMap } from "@/lib/time-horizon";
import { cn } from "@/lib/utils";
import { type DisplayMode, parseDayKey } from "./shared";

export function WeekHorizonPureView({
  days,
  hourlyData,
  isLoading,
  today,
  selectedDay,
  displayMode,
  onDrillToDay,
  onHoverTip,
}: {
  days: Array<{ key: string }>;
  hourlyData: Array<{ date: string; hour: number; count: number }>;
  isLoading: boolean;
  today: string;
  selectedDay: string;
  displayMode: DisplayMode;
  onDrillToDay: (day: string) => void;
  onHoverTip: (tip: string | null) => void;
}) {
  const { locale, t } = useI18n();
  const countMap = useMemo(
    () => buildWeekSlotCountMap(hourlyData),
    [hourlyData],
  );

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  // Narrow weekday from Intl, not a hardcoded character table: zh renders
  // 日/一/二…, en S/M/T…, and every other locale gets its own shape.
  const weekdayNarrow = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "narrow" }),
    [locale],
  );

  return (
    <div className="flex flex-col gap-1.5">
      {/* 7 Column Headers on the Top Axis (Weekday + Date, 对齐年视图当前月卡片风格) */}
      <div className="flex items-center gap-1">
        {/* Left spacer matching Y axis */}
        <div className="w-4 shrink-0" />

        <div className="grid flex-1 grid-cols-7 gap-1">
          {days.map((d) => {
            const dateObj = parseDayKey(d.key);
            const isToday = d.key === today;
            const isSelected = d.key === selectedDay;
            const weekdayStr = weekdayNarrow.format(dateObj);

            return (
              <button
                className={cn(
                  "flex flex-col items-center rounded-lg py-1 px-0.5 transition-all cursor-pointer border",
                  isSelected
                    ? "border-brand-500/60 ring-1 ring-brand-500/30 bg-brand-500/10 shadow-2xs"
                    : isToday
                      ? "border-brand-500/30 bg-brand-500/[0.04] hover:bg-brand-500/10"
                      : "border-transparent hover:bg-muted/40 dark:hover:bg-white/[0.04]",
                )}
                key={d.key}
                type="button"
                onClick={() => onDrillToDay(d.key)}
              >
                {displayMode === "calendar" ? (
                  <>
                    <span
                      className={cn(
                        "text-xs font-medium leading-none mb-0.5 transition-colors",
                        isSelected || isToday
                          ? "text-brand-600 dark:text-brand-400 font-semibold"
                          : "text-muted-foreground",
                      )}
                    >
                      {weekdayStr}
                    </span>
                    <span
                      className={cn(
                        "text-xs leading-tight transition-colors",
                        isSelected || isToday
                          ? "font-bold text-brand-600 dark:text-brand-400"
                          : "font-semibold text-foreground/85",
                      )}
                    >
                      {dateObj.getDate()}
                    </span>
                  </>
                ) : (
                  <span
                    className={cn(
                      "text-[10px] font-mono font-medium transition-colors",
                      isSelected || isToday
                        ? "text-brand-600 dark:text-brand-400 font-bold"
                        : "text-muted-foreground",
                    )}
                  >
                    {weekdayStr}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 7 Columns x 24 Rows Grid (168 Pure Squares, 100% 对齐年视图微点质感与深浅) */}
      <div className="flex gap-1">
        {/* Left Y-axis hour scale indicators (00, 06, 12, 18, 23) */}
        <div className="flex w-4 shrink-0 flex-col justify-between py-0.5 text-[9px] font-mono font-medium text-foreground/75 dark:text-foreground/70 select-none">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>23</span>
        </div>

        {/* 7 Columns: 24 micro-blocks each */}
        <div className="grid flex-1 grid-cols-7 gap-1">
          {days.map((d) => (
            <div className="flex flex-col gap-[2px]" key={`col-${d.key}`}>
              {hours.map((h) => {
                const count = countMap.get(`${d.key}_${h}`) ?? 0;
                const tip = `${d.key} ${String(h).padStart(2, "0")}:00 · ${t("explorer.notesCount", { count })}`;
                return (
                  <button
                    aria-label={tip}
                    className={cn(
                      "h-[7px] w-full rounded-[1.5px] transition-all cursor-pointer active:scale-95",
                      heatmapColor(count),
                      count > 0 && "hover:brightness-110",
                      count <= 0 &&
                        "hover:bg-muted-foreground/25 dark:hover:bg-muted/45",
                      isLoading && "opacity-50",
                      "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                      "hover:scale-110 hover:z-10",
                    )}
                    key={`${d.key}_${h}`}
                    type="button"
                    onClick={() => onDrillToDay(d.key)}
                    onFocus={() => onHoverTip(tip)}
                    onBlur={() => onHoverTip(null)}
                    onMouseEnter={() => onHoverTip(tip)}
                    onMouseLeave={() => onHoverTip(null)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
