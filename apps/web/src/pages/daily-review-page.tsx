import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  CheckIcon,
  FootprintsIcon,
  PlusIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getDailyReview, getMemoStats, listMemos, type Memo } from "@/api";
import { MemoSnapshotCard } from "@/components/memo-snapshot-card";
import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ReviewTabs } from "@/components/workspace/review-tabs";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { WorkspacePageHeader } from "@/components/workspace/workspace-page-header";
import { type TranslationKey, type TranslationParams, useI18n } from "@/i18n";
import {
  addDays,
  formatFullDayHeader,
  formatWeekday,
  isoDay,
  todayKey,
} from "@/lib/calendar-date";
import { extractTags } from "@/lib/memo";
import { queryKeys } from "@/lib/query-keys";
import { ACTIVITY_WINDOW_DAYS } from "@/lib/time-horizon";
import { cn } from "@/lib/utils";

const COMPOSE_SEARCH = {
  compose: true,
  q: undefined,
  tag: undefined,
  view: undefined,
  space: undefined,
  untagged: undefined,
} as const;

/**
 * Today's review: a short stack of old notes read one at a time (the same
 * day in past years, then a few from about a week, a month, a quarter and
 * half a year back), and under it a look at the last seven days of writing.
 * Reading one note at a time is the point: a list of old notes gets skimmed
 * like a second timeline, a single card gets read.
 */
export function DailyReviewPage() {
  const { locale, t } = useI18n();
  const today = useMemo(() => todayKey(), []);
  const tzOffset = useMemo(() => -new Date().getTimezoneOffset(), []);
  const reviewQuery = useQuery({
    queryKey: ["daily-review", today, tzOffset],
    queryFn: () => getDailyReview(today, tzOffset),
    retry: false,
  });

  // One page of recent notes feeds both the spaced-repetition ladder and
  // the week's tags.
  const recentQuery = useQuery({
    queryKey: ["daily-review-ladder", today],
    queryFn: () => listMemos({ page_size: 100, state: "normal" }),
    retry: false,
  });

  const deck = useMemo(() => {
    const onThisDay = reviewQuery.data?.memos ?? [];
    const shown = new Set(onThisDay.map((memo) => memo.name));
    const ladder = (recentQuery.data?.memos ?? []).filter(
      (memo) => !shown.has(memo.name),
    );
    return buildReviewDeck([...onThisDay, ...ladder], today, t);
  }, [reviewQuery.data, recentQuery.data, today, t]);

  const [cursor, setCursor] = useState(0);
  const [finished, setFinished] = useState(false);
  const atLast = cursor >= deck.length - 1;
  const item = deck[Math.min(cursor, deck.length - 1)];

  const keyActionsRef = useRef({ next: () => {}, back: () => {} });
  keyActionsRef.current = {
    next: () => {
      if (finished || deck.length === 0) return;
      if (atLast) setFinished(true);
      else setCursor((value) => value + 1);
    },
    back: () => {
      if (finished) {
        setFinished(false);
        return;
      }
      setCursor((value) => Math.max(0, value - 1));
    },
  };
  // ← and → page through the stack, as on the walk; typing is left alone.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target?.closest("input, textarea, [contenteditable=true]")
      ) {
        return;
      }
      if (event.key === "ArrowRight" || event.key === "j") {
        event.preventDefault();
        keyActionsRef.current.next();
      } else if (event.key === "ArrowLeft" || event.key === "k") {
        event.preventDefault();
        keyActionsRef.current.back();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const isLoading = reviewQuery.isLoading || recentQuery.isLoading;
  const failedQuery = reviewQuery.isError
    ? reviewQuery
    : recentQuery.isError
      ? recentQuery
      : null;
  const ready = !isLoading && !failedQuery;

  return (
    <WorkspaceLayout
      header={({
        sidebarCollapsed,
        toggleSidebarCollapsed,
        mobileSheetOpen,
        setMobileSheetOpen,
        explorer,
      }) => (
        <WorkspacePageHeader
          explorer={explorer}
          icon={
            <CalendarDaysIcon className="size-4 shrink-0 text-brand-600 dark:text-brand-400" />
          }
          mobileSheetOpen={mobileSheetOpen}
          setMobileSheetOpen={setMobileSheetOpen}
          sidebarCollapsed={sidebarCollapsed}
          title={t("nav.review")}
          actions={<ReviewTabs />}
          toggleSidebarCollapsed={toggleSidebarCollapsed}
        />
      )}
    >
      <div className="flex flex-col gap-8 py-2">
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 px-1">
            <h2 className="font-heading text-xl font-semibold tracking-tight">
              {formatFullDayHeader(today, locale)}
            </h2>
            <p className="text-sm text-muted-foreground">
              {!ready
                ? "\u00a0"
                : deck.length > 0
                  ? t("review.todayIntro", { count: deck.length })
                  : t("review.todayIntroEmpty")}
            </p>
          </div>

          {isLoading && (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-1 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          )}
          {failedQuery && (
            <QueryErrorState
              className="min-h-56 border text-muted-foreground"
              isRetrying={failedQuery.isFetching}
              onRetry={() => void failedQuery.refetch()}
            />
          )}

          {ready && deck.length === 0 && (
            <Card className="border-dashed bg-transparent shadow-none ring-0">
              <CardContent className="flex flex-col items-start gap-3 py-2">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">
                    {t("review.dailyEmptyTitle")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t("review.dailyEmptyDescription")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    render={<Link search={COMPOSE_SEARCH} to="/" />}
                    size="sm"
                    variant="outline"
                  >
                    <PlusIcon data-icon="inline-start" />
                    {t("review.writeTodayMemo")}
                  </Button>
                  <Button
                    render={<Link to="/review/walk" />}
                    size="sm"
                    variant="ghost"
                  >
                    <FootprintsIcon data-icon="inline-start" />
                    {t("review.goWalk")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {ready && deck.length > 0 && (
            <>
              <DeckProgress
                current={finished ? deck.length : cursor}
                finished={finished}
                total={deck.length}
                onJump={(index) => {
                  setFinished(false);
                  setCursor(index);
                }}
              />
              {finished ? (
                <Card className="motion-safe:animate-rise">
                  <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
                    <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <CheckIcon className="size-4" />
                    </span>
                    <div className="flex flex-col gap-1">
                      <p className="font-heading text-lg font-semibold">
                        {t("review.doneTitle")}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {t("review.doneDescription", { count: deck.length })}
                      </p>
                    </div>
                    <div className="mt-1 flex flex-wrap justify-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setFinished(false);
                          setCursor(0);
                        }}
                      >
                        <RotateCcwIcon data-icon="inline-start" />
                        {t("review.readAgain")}
                      </Button>
                      <Button render={<Link to="/review/walk" />} size="sm">
                        <FootprintsIcon data-icon="inline-start" />
                        {t("review.goWalk")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                item && (
                  <>
                    <div
                      className="motion-safe:animate-rise"
                      key={item.memo.name}
                    >
                      <MemoSnapshotCard
                        badge={item.label}
                        locale={locale}
                        memo={item.memo}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        disabled={cursor === 0}
                        variant="ghost"
                        onClick={() => keyActionsRef.current.back()}
                      >
                        <ArrowLeftIcon data-icon="inline-start" />
                        {t("review.previous")}
                      </Button>
                      <span className="ms-auto hidden text-xs text-muted-foreground sm:inline">
                        {t("review.walkKeyHint")}
                      </span>
                      <Button
                        className="ms-auto sm:ms-0"
                        onClick={() => keyActionsRef.current.next()}
                      >
                        {atLast ? t("review.finish") : t("review.next")}
                        {atLast ? (
                          <CheckIcon data-icon="inline-end" />
                        ) : (
                          <ArrowRightIcon data-icon="inline-end" />
                        )}
                      </Button>
                    </div>
                  </>
                )
              )}
            </>
          )}
        </section>

        <RecentWeek recent={recentQuery.data?.memos} today={today} />
      </div>
    </WorkspaceLayout>
  );
}

/** One segment per note; read ones darker, the current one solid ink. */
function DeckProgress({
  current,
  finished,
  total,
  onJump,
}: {
  current: number;
  finished: boolean;
  total: number;
  onJump: (index: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 px-1">
      <div className="flex flex-1 gap-1">
        {Array.from({ length: total }, (_, index) => (
          <button
            aria-current={!finished && index === current ? "step" : undefined}
            aria-label={t("review.deckProgress", {
              current: index + 1,
              total,
            })}
            className="group/seg flex h-4 flex-1 items-center outline-none"
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
            key={index}
            type="button"
            onClick={() => onJump(index)}
          >
            <span
              className={cn(
                "h-1 w-full rounded-full motion-safe:transition-colors motion-safe:duration-200 group-hover/seg:bg-foreground/50 group-focus-visible/seg:ring-2 group-focus-visible/seg:ring-ring/40",
                finished || index < current
                  ? "bg-foreground/35"
                  : index === current
                    ? "bg-foreground"
                    : "bg-border",
              )}
            />
          </button>
        ))}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {t("review.deckProgress", {
          current: finished ? total : current + 1,
          total,
        })}
      </span>
    </div>
  );
}

/**
 * The last seven days at a glance: how much, on how many days, about what.
 * Counts come from the sidebar's stats query (same cache entry); tags from
 * the recent page the ladder already loaded.
 */
function RecentWeek({
  recent,
  today,
}: {
  recent: Memo[] | undefined;
  today: string;
}) {
  const { locale, t } = useI18n();
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const statsQuery = useQuery({
    queryKey: queryKeys.memoStats.forWindow(
      "all",
      timeZone,
      ACTIVITY_WINDOW_DAYS,
    ),
    queryFn: () => getMemoStats(timeZone, "all", ACTIVITY_WINDOW_DAYS),
    staleTime: 30_000,
    retry: false,
  });

  const days = useMemo(() => {
    const byDate = new Map(
      (statsQuery.data?.activity ?? []).map((day) => [day.date, day.count]),
    );
    return Array.from({ length: 7 }, (_, index) => {
      const key = addDays(today, index - 6);
      return { key, count: byDate.get(key) ?? 0 };
    });
  }, [statsQuery.data, today]);
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const activeDays = days.filter((day) => day.count > 0).length;
  const peak = Math.max(1, ...days.map((day) => day.count));

  const topTags = useMemo(() => {
    const since = addDays(today, -6);
    const counts = new Map<string, number>();
    for (const memo of recent ?? []) {
      const day = isoDay(new Date(memo.display_time ?? memo.create_time));
      if (day < since) continue;
      for (const tag of memo.payload.tags ?? extractTags(memo.content)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [recent, today]);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="px-1 text-xs font-medium text-muted-foreground">
        {t("review.weekTitle")}
      </h2>
      <Card>
        <CardContent className="flex flex-col gap-5">
          {statsQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="flex items-end gap-6">
              <div className="flex shrink-0 flex-col gap-1.5">
                <p className="text-2xl leading-none font-semibold tabular-nums">
                  {total}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("review.weekCount")}
                </p>
                <p className="pt-2 text-xs text-muted-foreground tabular-nums">
                  {t("review.weekActiveDays", { count: activeDays })}
                </p>
              </div>
              <div className="flex h-24 flex-1 items-end gap-1.5 sm:gap-2.5">
                {days.map((day) => {
                  const isToday = day.key === today;
                  const weekday = new Date(`${day.key}T12:00:00`).getDay();
                  return (
                    <div
                      className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
                      key={day.key}
                      title={`${day.key} · ${day.count}`}
                    >
                      <div className="flex w-full flex-1 items-end justify-center">
                        <div
                          className={cn(
                            "w-full max-w-6 rounded-[3px] motion-safe:transition-[height] motion-safe:duration-300",
                            day.count === 0
                              ? "h-0.5 bg-border"
                              : isToday
                                ? "bg-primary"
                                : "bg-foreground/25",
                          )}
                          style={
                            day.count > 0
                              ? {
                                  height: `${Math.max(12, (day.count / peak) * 100)}%`,
                                }
                              : undefined
                          }
                        />
                      </div>
                      <span
                        className={cn(
                          "text-[11px] leading-none text-muted-foreground",
                          isToday && "font-medium text-foreground",
                        )}
                      >
                        {formatWeekday(weekday, locale, "narrow")}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-border/60 pt-4 text-xs text-muted-foreground">
            {topTags.length > 0 ? (
              <>
                <span>{t("review.weekTopTags")}</span>
                {topTags.map(([tag, count]) => (
                  <Link
                    className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-foreground/80 hover:text-foreground"
                    key={tag}
                    search={{ ...COMPOSE_SEARCH, compose: undefined, tag }}
                    to="/"
                  >
                    #{tag}
                    <span className="text-muted-foreground tabular-nums">
                      {count}
                    </span>
                  </Link>
                ))}
              </>
            ) : (
              <span>
                {total > 0 ? t("review.weekNoTags") : t("review.weekEmpty")}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

type ReviewItem = {
  memo: Memo;
  label: string;
};

/** Rungs of the first-year ladder, nearest first. */
const LADDER = [
  { key: "ladder-7d", maxDays: 7, title: "review.ladder7d" },
  { key: "ladder-30d", maxDays: 30, title: "review.ladder30d" },
  { key: "ladder-90d", maxDays: 90, title: "review.ladder90d" },
  { key: "ladder-180d", maxDays: 366, title: "review.ladder180d" },
] as const;

/** Notes kept per ladder rung: a nudge, not a second timeline. */
const PER_RUNG = 2;

/** "On this day" notes kept per year, so a busy anniversary stays short. */
const PER_YEAR = 3;

function buildReviewDeck(
  memos: Memo[],
  todayStr: string,
  t: (key: TranslationKey, params?: TranslationParams) => string,
): ReviewItem[] {
  // Whole local calendar days between two `YYYY-MM-DD` keys; noon anchors
  // keep a daylight-saving shift from moving the result.
  const daysBetween = (from: string, to: string) =>
    Math.round(
      (new Date(`${to}T12:00:00`).getTime() -
        new Date(`${from}T12:00:00`).getTime()) /
        86_400_000,
    );
  const years = new Map<number, Memo[]>();
  const rungs = new Map<string, Memo[]>();
  const seen = new Set<string>();

  for (const memo of memos) {
    if (seen.has(memo.name)) continue;
    seen.add(memo.name);
    const timeStr = memo.display_time ?? memo.create_time;
    // The memo's day as the author saw it. The stored time is UTC, so
    // slicing the string put a note written at 07:00 in UTC+8 on the
    // previous day, and today's notes leaked into the review.
    const memoDay = isoDay(new Date(timeStr));
    // The review looks back; anything written today is not a memory yet.
    if (memoDay >= todayStr) continue;

    // Whole years by the calendar: the anniversary must have come round, so
    // a note from 2025-10-30 is "a year ago" on 2026-10-30 (365 days), and a
    // December note is not "a year ago" in January.
    let yearsAgo = Number(todayStr.slice(0, 4)) - Number(memoDay.slice(0, 4));
    if (memoDay.slice(5) > todayStr.slice(5)) yearsAgo -= 1;

    if (yearsAgo >= 1) {
      const list = years.get(yearsAgo) ?? [];
      if (list.length < PER_YEAR) list.push(memo);
      years.set(yearsAgo, list);
      continue;
    }
    const diffDays = daysBetween(memoDay, todayStr);
    const rung = LADDER.find((item) => diffDays <= item.maxDays);
    if (!rung) continue;
    const list = rungs.get(rung.key) ?? [];
    if (list.length < PER_RUNG) list.push(memo);
    rungs.set(rung.key, list);
  }

  const deck: ReviewItem[] = [];
  for (const [count, list] of [...years.entries()].sort(([a], [b]) => b - a)) {
    const label =
      count === 1
        ? t("review.oneYearAgoToday")
        : t("review.yearsAgoToday", { count });
    for (const memo of list) deck.push({ memo, label });
  }
  // Furthest back first: the older a note, the more it has to say again.
  for (const rung of [...LADDER].reverse()) {
    for (const memo of rungs.get(rung.key) ?? []) {
      deck.push({ memo, label: t(rung.title) });
    }
  }
  return deck;
}
