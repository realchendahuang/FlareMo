import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getDailyReview, type Memo } from "@/api";
import { MemoSnapshotCard } from "@/components/memo-snapshot-card";
import { SubpageHeader } from "@/components/subpage-header";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";

export function DailyReviewPage() {
  const { locale, t } = useI18n();
  const today = useMemo(() => formatLocalDate(new Date()), []);
  const tzOffset = useMemo(() => -new Date().getTimezoneOffset(), []);
  const reviewQuery = useQuery({
    queryKey: ["daily-review", today, tzOffset],
    queryFn: () => getDailyReview(today, tzOffset),
    retry: false,
  });
  const groups = useMemo(
    () => groupByYearsAgo(reviewQuery.data?.memos ?? []),
    [reviewQuery.data],
  );

  return (
    <div className="min-h-svh bg-background px-4 py-5 sm:py-8">
      <main className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
        <SubpageHeader />

        <div className="px-1">
          <h1 className="font-heading text-xl font-semibold">
            {t("nav.dailyReview")}
          </h1>
        </div>

        {reviewQuery.isLoading && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
        {reviewQuery.isError && (
          <Empty className="min-h-72 border">
            <EmptyHeader>
              <EmptyTitle>{t("list.errorTitle")}</EmptyTitle>
              <EmptyDescription>{t("list.errorDescription")}</EmptyDescription>
            </EmptyHeader>
            <Button
              className="mt-2"
              size="sm"
              variant="outline"
              onClick={() => void reviewQuery.refetch()}
            >
              {t("common.retry")}
            </Button>
          </Empty>
        )}
        {reviewQuery.data && groups.length === 0 && (
          <Empty className="min-h-72 border">
            <EmptyHeader>
              <EmptyTitle>{t("review.dailyEmptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("review.dailyEmptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {groups.map((group) => (
          <section className="flex flex-col gap-3" key={group.yearsAgo}>
            <h2 className="px-1 text-sm font-medium text-muted-foreground">
              {group.yearsAgo === 1
                ? t("review.oneYearAgoToday")
                : t("review.yearsAgoToday", { count: group.yearsAgo })}
            </h2>
            {group.memos.map((memo) => (
              <MemoSnapshotCard key={memo.name} locale={locale} memo={memo} />
            ))}
          </section>
        ))}
      </main>
    </div>
  );
}

type YearGroup = {
  yearsAgo: number;
  memos: Memo[];
};

function groupByYearsAgo(memos: Memo[]): YearGroup[] {
  const currentYear = new Date().getFullYear();
  const groups: YearGroup[] = [];
  for (const memo of memos) {
    const year = new Date(memo.create_time).getFullYear();
    const yearsAgo = currentYear - year;
    if (Number.isNaN(yearsAgo) || yearsAgo < 1) continue;
    const group = groups.at(-1);
    if (group && group.yearsAgo === yearsAgo) {
      group.memos.push(memo);
    } else {
      groups.push({ yearsAgo, memos: [memo] });
    }
  }
  return groups;
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
