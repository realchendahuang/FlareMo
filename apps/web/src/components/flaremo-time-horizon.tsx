/**
 * FlareMoTimeHorizon — 四维纯粹高级时间视界
 *
 * 核心设计哲学 (双态彻底分工)：
 * 1. 热力图态 (Heatmap Mode) ——【纯粹的克制，只展示热力与力度】：
 *    - 画布中间彻底去除所有文字说明、数字标牌与文字描述。
 *    - 纯靠方块的点阵与色彩深浅传达节奏与能量状态，极致高级、沉静。
 *    - 尺度层层递进：年 365天微点 / 月 30天饱满热力毯 / 周 168小时横条矩阵 / 日 24小时全景时间能量流。
 * 2. 日历图态 (Calendar Mode) ——【展示信息本身】：
 *    - 相同网格与结构，显示月份、日期、星期、整点时间与条数信息。
 * 3. 严格零 Emoji，外轴极简，信息仅在悬停时于最底线静默提示。
 */
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { getHourlyActivity, getMemoStats, listMemos } from "@/api";
import { useI18n } from "@/i18n";
import {
  addMonths,
  buildWeekGrid,
  dayFilterQuery,
  formatMonthTitle,
  monthOf,
  nextDay,
  prevDay,
  todayKey,
  type WeekStart,
} from "@/lib/calendar-date";
import {
  ACTIVITY_WINDOW_DAYS,
  buildActivityCountMap,
  monthRangeOf,
  parseDayKey,
  shiftDayKey,
  weekRangeOf,
  yearOf,
} from "@/lib/time-horizon";
import { cn } from "@/lib/utils";
import { DayHorizonPureView } from "./time-horizon/day-horizon-view";
import { MonthHorizonPureView } from "./time-horizon/month-horizon-view";
import type {
  DisplayMode,
  FlareMoTimeHorizonProps,
  TimeHorizonTab,
} from "./time-horizon/shared";
import { WeekHorizonPureView } from "./time-horizon/week-horizon-view";
import { YearHorizonPureView } from "./time-horizon/year-horizon-view";

export type {
  DisplayMode,
  FlareMoTimeHorizonProps,
  TimeHorizonTab,
} from "./time-horizon/shared";

// ============================================================================
// Root Component
// ============================================================================
export const FlareMoTimeHorizon = memo(function FlareMoTimeHorizon({
  stats,
  streak: _streak,
  timeZone,
  space,
  onDaySelect,
  onNavigate,
  hoveredDate,
  onHoverDate,
  className,
}: FlareMoTimeHorizonProps) {
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const today = useMemo(() => todayKey(), []);

  const [tab, setTab] = useState<TimeHorizonTab>("month");
  const displayMode: DisplayMode = "calendar";
  const [selectedDay, setSelectedDay] = useState<string>(today);
  const [currentMonthKey, setCurrentMonthKey] = useState<string>(
    monthOf(today),
  );
  const [currentWeekBase, setCurrentWeekBase] = useState<string>(today);
  const [currentYear, setCurrentYear] = useState<number>(yearOf(today));
  const [hoveredTip, setHoveredTip] = useState<string | null>(null);

  const weekStart: WeekStart = locale.startsWith("en") ? "sunday" : "monday";
  const tz = useMemo(() => new Date().getTimezoneOffset(), []);

  // Map daily counts
  const notesCountMap = useMemo(
    () => buildActivityCountMap(stats.activity),
    [stats.activity],
  );

  // The shared stats query is anchored to today, so a historical year would
  // inherit a trailing-366-days slice that covers at most its tail and render
  // the rest as zeroes (issue #144). The year view asks for the navigated
  // year's own window (until Dec 31); the counter read behind it scales with
  // active hours in the range, not memo count, so 2019 costs no more than
  // today.
  // Deliberately do NOT fall back to stats.activity while loading: that array
  // is anchored to today and for a historical year would show the tail ~3
  // months with real data and the rest as zeroes — a misleading partial
  // picture. An empty array renders uniform "no records" colour instead,
  // which is at least honest while the request resolves.
  const yearStatsQuery = useQuery({
    queryKey: ["memo-stats-year", space, timeZone, currentYear],
    queryFn: ({ signal }) =>
      getMemoStats(
        timeZone,
        space,
        ACTIVITY_WINDOW_DAYS,
        `${currentYear}-12-31`,
        signal,
      ),
    enabled: tab === "year",
    staleTime: 60_000,
    retry: false,
  });
  const yearActivity =
    tab === "year" ? (yearStatsQuery.data?.activity ?? []) : stats.activity;

  // Hourly query for Day view (24 hours)
  const dayHourlyQuery = useQuery({
    queryKey: ["stats-hourly-day", selectedDay, tz],
    queryFn: ({ signal }) =>
      getHourlyActivity({ date: selectedDay }, tz, signal),
    staleTime: 60_000,
    enabled: tab === "day",
  });

  // Memo query for Day view 15-minute fine-grained resolution (24 hours x 4 slots = 96 micro-slits)
  const dayMemosQuery = useQuery({
    queryKey: ["memos-day-slots", selectedDay],
    queryFn: ({ signal }) =>
      listMemos({ q: dayFilterQuery(selectedDay), page_size: 100 }, signal),
    staleTime: 30_000,
    enabled: tab === "day",
  });

  // Month range calculations for hourly query (1st to last of current month)
  const { from: monthFrom, to: monthTo } = monthRangeOf(currentMonthKey);

  const monthHourlyQuery = useQuery({
    queryKey: ["stats-hourly-month", monthFrom, monthTo, tz],
    queryFn: ({ signal }) =>
      getHourlyActivity({ from: monthFrom, to: monthTo }, tz, signal),
    staleTime: 60_000,
    enabled: tab === "month",
  });

  // Week range calculations (7 days x 24 hours)
  const weekDays = useMemo(
    () => buildWeekGrid(currentWeekBase, weekStart),
    [currentWeekBase, weekStart],
  );
  const { from: weekFrom, to: weekTo } = weekRangeOf(weekDays, today);

  const weekHourlyQuery = useQuery({
    queryKey: ["stats-hourly-week", weekFrom, weekTo, tz],
    queryFn: ({ signal }) =>
      getHourlyActivity({ from: weekFrom, to: weekTo }, tz, signal),
    staleTime: 60_000,
    enabled: tab === "week",
  });

  const handleSelectDay = (day: string) => {
    setSelectedDay(day);
    onDaySelect?.(day);
  };

  /** Drill-down: Year -> Month */
  const drillToMonth = (monthKey: string) => {
    setCurrentMonthKey(monthKey);
    setTab("month");
  };

  /** Drill-down: Month -> Week */
  const drillToWeek = (day: string) => {
    handleSelectDay(day);
    setCurrentWeekBase(day);
    setTab("week");
  };

  /** Drill-down: Week -> Day */
  const drillToDay = (day: string) => {
    handleSelectDay(day);
    setTab("day");
  };

  /** Jump to Timeline search for this day */
  const jumpToTimeline = (day: string) => {
    handleSelectDay(day);
    void navigate({
      to: "/",
      search: (current) => ({
        compose: current.compose,
        q: dayFilterQuery(day),
        space: current.space,
        tag: undefined,
        untagged: undefined,
        view: "all",
      }),
    });
    onNavigate?.();
  };

  // ── Range Title ────────────────────────────────────────────────────────────
  const rangeTitle = useMemo(() => {
    if (tab === "year") return t("explorer.yearTitle", { year: currentYear });
    if (tab === "month") return formatMonthTitle(currentMonthKey, locale);
    if (tab === "week") {
      const first = weekDays[0];
      const last = weekDays[6];
      if (!first || !last) return "";
      const fmt = new Intl.DateTimeFormat(locale, {
        month: "numeric",
        day: "numeric",
      });
      return `${fmt.format(parseDayKey(first.key))} – ${fmt.format(parseDayKey(last.key))}`;
    }
    // day
    const d = parseDayKey(selectedDay);
    const fmt = new Intl.DateTimeFormat(locale, {
      month: "numeric",
      day: "numeric",
      weekday: "short",
    });
    return fmt.format(d);
  }, [tab, currentYear, currentMonthKey, weekDays, selectedDay, locale, t]);

  // ── Navigation ─────────────────────────────────────────────────────────────
  const handlePrev = () => {
    if (tab === "year") setCurrentYear((y) => y - 1);
    else if (tab === "month") setCurrentMonthKey((m) => addMonths(-1, m));
    else if (tab === "week") setCurrentWeekBase((b) => shiftDayKey(b, -7));
    else setSelectedDay((d) => prevDay(d));
  };

  const handleNext = () => {
    if (tab === "year") setCurrentYear((y) => y + 1);
    else if (tab === "month") setCurrentMonthKey((m) => addMonths(1, m));
    else if (tab === "week") setCurrentWeekBase((b) => shiftDayKey(b, 7));
    else setSelectedDay((d) => nextDay(d));
  };

  const isAwayFromToday = useMemo(() => {
    if (tab === "day") return selectedDay !== today;
    if (tab === "month") return currentMonthKey !== monthOf(today);
    if (tab === "week") return !weekDays.some((d) => d.key === today);
    if (tab === "year") return currentYear !== yearOf(today);
    return false;
  }, [tab, selectedDay, today, currentMonthKey, weekDays, currentYear]);

  const handleJumpToday = () => {
    setSelectedDay(today);
    setCurrentMonthKey(monthOf(today));
    setCurrentWeekBase(today);
    setCurrentYear(yearOf(today));
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {/* ── Top Bar: 4 Tabs + Quick Today Jump ────────────────────────────── */}
      <div className="flex items-center justify-between px-0.5">
        <div
          aria-label={t("explorer.timeViewLabel")}
          className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/40 p-0.5 dark:border-border/40 dark:bg-muted/30"
          role="tablist"
        >
          {(
            [
              ["year", t("explorer.tab.year")],
              ["month", t("explorer.tab.month")],
              ["week", t("explorer.tab.week")],
              ["day", t("explorer.tab.day")],
            ] as const
          ).map(([id, label]) => (
            <button
              aria-selected={tab === id}
              className={cn(
                "min-w-[30px] rounded px-2 py-0.5 text-xs font-medium tabular-nums transition-colors cursor-pointer",
                tab === id
                  ? "bg-background text-foreground shadow-2xs font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
              key={id}
              role="tab"
              type="button"
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Quick Return to Today when navigated away */}
        {isAwayFromToday ? (
          <button
            aria-label={t("explorer.backToToday")}
            className="rounded-md border border-border/60 bg-background/80 px-2 py-0.5 text-xs font-medium text-foreground/80 shadow-2xs transition-colors hover:border-brand-500/50 hover:bg-background hover:text-brand-600 dark:border-border/40 dark:bg-muted/30 dark:hover:text-brand-400 cursor-pointer"
            type="button"
            onClick={handleJumpToday}
          >
            {t("explorer.today")}
          </button>
        ) : null}
      </div>

      {/* ── Range Navigator ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-1">
        <button
          aria-label={t("explorer.previousPeriod")}
          className="rounded p-1 text-foreground/70 hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
          type="button"
          onClick={handlePrev}
        >
          <ChevronLeftIcon className="size-3.5" />
        </button>
        <span className="text-xs font-semibold text-foreground">
          {rangeTitle}
        </span>
        <button
          aria-label={t("explorer.nextPeriod")}
          className="rounded p-1 text-foreground/70 hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
          type="button"
          onClick={handleNext}
        >
          <ChevronRightIcon className="size-3.5" />
        </button>
      </div>

      {/* ── Unified High-Impact Canvas Container (~240px Tall) ─────────────── */}
      <div
        className="relative flex min-h-[238px] flex-col justify-center rounded-xl border border-border/70 bg-muted/30 p-2.5 shadow-2xs dark:border-border/50 dark:bg-muted/20 overflow-hidden"
        data-testid="activity-heatmap"
      >
        <div
          key={tab}
          className={cn(
            "w-full transition-all",
            tab === "day"
              ? "animate-horizon-flip"
              : tab === "week"
                ? "animate-horizon-zoom"
                : tab === "month"
                  ? "animate-horizon-zoom"
                  : "animate-horizon-flip",
          )}
        >
          {/* YEAR VIEW: 365 Days across 12 Month Dot Clusters */}
          {tab === "year" && (
            <YearHorizonPureView
              activity={yearActivity}
              displayMode={displayMode}
              today={today}
              weekStart={weekStart}
              year={currentYear}
              onDrillToMonth={drillToMonth}
              onHoverTip={setHoveredTip}
            />
          )}

          {/* MONTH VIEW: 7 Columns x 5~6 Rows of Solid Cohesive Heatmap Tiles */}
          {tab === "month" && (
            <MonthHorizonPureView
              displayMode={displayMode}
              hourlyData={monthHourlyQuery.data?.hours ?? []}
              hoveredDate={hoveredDate}
              isLoading={monthHourlyQuery.isLoading}
              locale={locale}
              monthKey={currentMonthKey}
              notesCountMap={notesCountMap}
              selectedDay={selectedDay}
              today={today}
              weekStart={weekStart}
              onDrillToWeek={drillToWeek}
              onHoverDate={onHoverDate}
              onHoverTip={setHoveredTip}
            />
          )}

          {/* WEEK VIEW: 7 Days x 24 Hours Micro-Stream (168 Squares) */}
          {tab === "week" && (
            <WeekHorizonPureView
              days={weekDays}
              displayMode={displayMode}
              hourlyData={weekHourlyQuery.data?.hours ?? []}
              isLoading={weekHourlyQuery.isLoading}
              selectedDay={selectedDay}
              today={today}
              onDrillToDay={drillToDay}
              onHoverTip={setHoveredTip}
            />
          )}

          {/* DAY VIEW: 24-Hour Panoramic Energy Spectrum (Time Stream) */}
          {tab === "day" && (
            <DayHorizonPureView
              displayMode={displayMode}
              hourlyData={dayHourlyQuery.data?.hours ?? []}
              isLoading={dayHourlyQuery.isLoading || dayMemosQuery.isLoading}
              memos={dayMemosQuery.data?.memos ?? []}
              selectedDay={selectedDay}
              today={today}
              onHoverTip={setHoveredTip}
              onJumpToTimeline={jumpToTimeline}
            />
          )}
        </div>
      </div>

      {/* ── Bottom Single-Line Micro Tooltip (Hover Details Only) ────────── */}
      <div className="flex h-4 items-center justify-between px-1 text-[11px] text-muted-foreground select-none">
        <span className="truncate">{hoveredTip ?? ""}</span>
      </div>
    </div>
  );
});
