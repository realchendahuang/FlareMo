import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarDaysIcon, PlusIcon } from "lucide-react";
import { useMemo } from "react";
import { getDailyReview, listMemos, type Memo } from "@/api";
import { MemoSnapshotCard } from "@/components/memo-snapshot-card";
import { QueryErrorState } from "@/components/query-error-state";
import { TodayTasks } from "@/components/today-tasks";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { WorkspacePageHeader } from "@/components/workspace/workspace-page-header";
import { type TranslationKey, type TranslationParams, useI18n } from "@/i18n";
import { isoDay, todayKey } from "@/lib/calendar-date";

export function DailyReviewPage() {
  const { locale, t } = useI18n();
  const today = useMemo(() => todayKey(), []);
  const tzOffset = useMemo(() => -new Date().getTimezoneOffset(), []);
  const reviewQuery = useQuery({
    queryKey: ["daily-review", today, tzOffset],
    queryFn: () => getDailyReview(today, tzOffset),
    retry: false,
  });

  // Spaced-repetition ladder: a few notes from about a week, a month, a
  // quarter and half a year back, shown under "on this day" (or alone in a
  // first year, when there is no "this day" yet). One page of recent notes
  // feeds it; each rung keeps its two newest.
  const intervalQuery = useQuery({
    queryKey: ["daily-review-ladder", today],
    queryFn: () => listMemos({ page_size: 100, state: "normal" }),
    enabled: Boolean(reviewQuery.data),
    retry: false,
  });

  const groups = useMemo(() => {
    const onThisDay = reviewQuery.data?.memos ?? [];
    const shown = new Set(onThisDay.map((memo) => memo.name));
    const ladder = (intervalQuery.data?.memos ?? []).filter(
      (memo) => !shown.has(memo.name),
    );
    return buildReviewGroups([...onThisDay, ...ladder], today, t);
  }, [reviewQuery.data, intervalQuery.data, today, t]);

  const isInitialLoading = reviewQuery.isLoading;
  // The ladder only runs when on-this-day came back empty; a failed ladder
  // must surface as an error rather than masquerade as "nothing to review".
  const failedQuery = reviewQuery.isError
    ? reviewQuery
    : intervalQuery.isError
      ? intervalQuery
      : null;

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
          title={t("nav.dailyReview")}
          toggleSidebarCollapsed={toggleSidebarCollapsed}
        />
      )}
    >
      <div className="flex flex-col gap-4 py-2">
        <TodayTasks />
        {isInitialLoading && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
        {failedQuery && (
          <QueryErrorState
            className="min-h-72 border text-muted-foreground"
            isRetrying={failedQuery.isFetching}
            onRetry={() => void failedQuery.refetch()}
          />
        )}
        {reviewQuery.data &&
          !isInitialLoading &&
          groups.length === 0 &&
          !intervalQuery.isLoading &&
          !intervalQuery.isError && (
            <Empty className="min-h-72 border border-border/60 bg-card/50 motion-safe:animate-rise">
              <EmptyHeader>
                <EmptyMedia
                  className="bg-accent text-accent-foreground"
                  variant="icon"
                >
                  <CalendarDaysIcon className="size-5" />
                </EmptyMedia>
                <EmptyTitle>{t("review.dailyEmptyTitle")}</EmptyTitle>
                <EmptyDescription>
                  {t("review.dailyEmptyDescription")}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  render={
                    <Link
                      search={{
                        compose: true,
                        q: undefined,
                        tag: undefined,
                        view: undefined,
                        space: undefined,
                        untagged: undefined,
                      }}
                      to="/"
                    />
                  }
                  size="sm"
                  variant="outline"
                >
                  <PlusIcon className="size-4" data-icon="inline-start" />
                  {t("review.writeTodayMemo")}
                </Button>
              </EmptyContent>
            </Empty>
          )}
        {groups.map((group) => (
          <section className="flex flex-col gap-3" key={group.key}>
            <h2 className="px-1 text-sm font-medium text-muted-foreground">
              {group.title}
            </h2>
            {group.memos.map((memo) => (
              <MemoSnapshotCard key={memo.name} locale={locale} memo={memo} />
            ))}
          </section>
        ))}
      </div>
    </WorkspaceLayout>
  );
}

type ReviewGroup = {
  key: string;
  title: string;
  memos: Memo[];
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

function buildReviewGroups(
  memos: Memo[],
  todayStr: string,
  t: (key: TranslationKey, params?: TranslationParams) => string,
): ReviewGroup[] {
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

  for (const memo of memos) {
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
      list.push(memo);
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

  const groups: ReviewGroup[] = [...years.entries()]
    .sort(([a], [b]) => a - b)
    .map(([count, list]) => ({
      key: `years-${count}`,
      title:
        count === 1
          ? t("review.oneYearAgoToday")
          : t("review.yearsAgoToday", { count }),
      memos: list,
    }));
  for (const rung of LADDER) {
    const list = rungs.get(rung.key);
    if (list?.length)
      groups.push({ key: rung.key, title: t(rung.title), memos: list });
  }
  return groups;
}
