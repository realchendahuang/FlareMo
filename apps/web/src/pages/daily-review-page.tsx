import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  CheckIcon,
  EyeOffIcon,
  FootprintsIcon,
  MessageSquarePlusIcon,
  PlusIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getMemoStats,
  getTodayReview,
  markReviewMemo,
  type TodayReviewItem,
  type TodayReviewReason,
  updateMemo,
} from "@/api";
import { MemoComments } from "@/components/memo-comments";
import { MemoSnapshotCard } from "@/components/memo-snapshot-card";
import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ReviewTabs } from "@/components/workspace/review-tabs";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { WorkspacePageHeader } from "@/components/workspace/workspace-page-header";
import { type TranslationKey, type TranslationParams, useI18n } from "@/i18n";
import { addDays, formatFullDayHeader, todayKey } from "@/lib/calendar-date";
import { errorMessage } from "@/lib/error";
import { getMemoResourceId } from "@/lib/memo";
import { queryKeys } from "@/lib/query-keys";
import { ACTIVITY_WINDOW_DAYS } from "@/lib/time-horizon";
import { cn } from "@/lib/utils";
import { ReviewSettingsDialog } from "./review/review-settings-dialog";

const COMPOSE_SEARCH = {
  compose: true,
  q: undefined,
  tag: undefined,
  view: undefined,
  space: undefined,
  untagged: undefined,
} as const;

type Translate = (key: TranslationKey, params?: TranslationParams) => string;

/** "3 years ago today", "5 days ago", "3 weeks ago", "4 months ago". */
export function reviewReasonLabel(reason: TodayReviewReason, t: Translate) {
  if (reason.type === "years") {
    return reason.years === 1
      ? t("review.oneYearAgoToday")
      : t("review.yearsAgoToday", { count: reason.years });
  }
  if (reason.days < 14) return t("review.daysAgo", { count: reason.days });
  if (reason.days < 60) {
    return t("review.weeksAgo", { count: Math.round(reason.days / 7) });
  }
  return t("review.monthsAgo", { count: Math.round(reason.days / 30) });
}

/** The query both this page and the home banner read. */
export function useTodayReviewQuery(enabled = true) {
  const today = useMemo(() => todayKey(), []);
  const tzOffset = useMemo(() => -new Date().getTimezoneOffset(), []);
  return useQuery({
    queryKey: queryKeys.review.today(today, tzOffset),
    queryFn: () => getTodayReview(today, tzOffset),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Today's review: a short stack of old notes read one at a time. The server
 * picks it (the same day in past years, then one note each from about a
 * week, a few weeks, a few months and most of a year back) and remembers
 * what was read, so a reload or another device resumes where the reader
 * stopped and a read note sits out the next month. On each card the reader
 * can add a line of today's thinking, archive a note that has had its day,
 * or keep it out of the review for good.
 */
export function DailyReviewPage() {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const today = useMemo(() => todayKey(), []);
  const tzOffset = useMemo(() => -new Date().getTimezoneOffset(), []);
  const reviewKey = queryKeys.review.today(today, tzOffset);
  const reviewQuery = useTodayReviewQuery();
  const items = reviewQuery.data?.items ?? [];

  const [currentName, setCurrentName] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const startedRef = useRef(false);

  // Resume at the first note not read yet; a fully read stack opens on the
  // closing card.
  useEffect(() => {
    if (startedRef.current || !reviewQuery.data) return;
    startedRef.current = true;
    const firstUnread = reviewQuery.data.items.find((item) => !item.reviewed);
    if (firstUnread) setCurrentName(firstUnread.memo.name);
    else setFinished(reviewQuery.data.items.length > 0);
  }, [reviewQuery.data]);

  const foundIndex = items.findIndex((item) => item.memo.name === currentName);
  const cursor = foundIndex >= 0 ? foundIndex : 0;
  const item = items[cursor];
  const atLast = cursor >= items.length - 1;
  const readCount = items.filter((entry) => entry.reviewed).length;

  const patchItems = (
    update: (items: TodayReviewItem[]) => TodayReviewItem[],
  ) => {
    queryClient.setQueryData<typeof reviewQuery.data>(reviewKey, (data) =>
      data ? { ...data, items: update(data.items) } : data,
    );
  };

  const markRead = useMutation({
    mutationFn: (memoName: string) =>
      markReviewMemo({ memoId: memoName, date: today, action: "reviewed" }),
    onMutate: (memoName) => {
      patchItems((list) =>
        list.map((entry) =>
          entry.memo.name === memoName ? { ...entry, reviewed: true } : entry,
        ),
      );
    },
    // A lost read only means the note may come back sooner; no toast.
  });

  const goTo = (index: number) => {
    setFinished(false);
    setReplyFor(null);
    const target = items[index];
    if (target) setCurrentName(target.memo.name);
  };

  const keyActionsRef = useRef({ next: () => {}, back: () => {} });
  keyActionsRef.current = {
    next: () => {
      if (finished || !item) return;
      if (!item.reviewed) markRead.mutate(item.memo.name);
      setReplyFor(null);
      if (atLast) setFinished(true);
      else goTo(cursor + 1);
    },
    back: () => {
      if (finished) {
        setFinished(false);
        return;
      }
      if (cursor > 0) goTo(cursor - 1);
    },
  };

  /** Take the current card out of the stack and move on to the next one. */
  const dropCurrent = (memoName: string) => {
    const index = items.findIndex((entry) => entry.memo.name === memoName);
    const next = items[index + 1] ?? null;
    patchItems((list) => list.filter((entry) => entry.memo.name !== memoName));
    setReplyFor(null);
    if (next) setCurrentName(next.memo.name);
    else setFinished(items.length > 1);
  };
  /** Undo puts the note back in the stack and on screen. */
  const restore = (memoName: string) => {
    setFinished(false);
    setCurrentName(memoName);
    void queryClient.invalidateQueries({ queryKey: queryKeys.review.all });
  };

  const archive = useMutation({
    mutationFn: (memoId: string) => updateMemo(memoId, { status: "archived" }),
    onSuccess: (_data, memoId) => {
      const memoName = `memos/${memoId}`;
      dropCurrent(memoName);
      void queryClient.invalidateQueries({ queryKey: queryKeys.memos.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.memoStats.all });
      toast.success(t("review.archived"), {
        action: {
          label: t("common.undo"),
          onClick: () => {
            void updateMemo(memoId, { status: "normal" })
              .then(() => {
                restore(memoName);
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.memos.all,
                });
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.memoStats.all,
                });
              })
              .catch((error: unknown) =>
                toast.error(errorMessage(error, t("toast.requestFailed"))),
              );
          },
        },
      });
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.requestFailed"))),
  });

  const mute = useMutation({
    mutationFn: (memoName: string) =>
      markReviewMemo({ memoId: memoName, date: today, action: "mute" }),
    onSuccess: (_data, memoName) => {
      dropCurrent(memoName);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.review.settings,
      });
      toast.success(t("review.muted"), {
        action: {
          label: t("common.undo"),
          onClick: () => {
            void markReviewMemo({
              memoId: memoName,
              date: today,
              action: "unmute",
            })
              .then(() => {
                restore(memoName);
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.review.settings,
                });
              })
              .catch((error: unknown) =>
                toast.error(errorMessage(error, t("toast.requestFailed"))),
              );
          },
        },
      });
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.requestFailed"))),
  });

  // ← and → page through the stack, as on the walk; typing is left alone.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target?.closest(
          "input, textarea, [contenteditable=true], [role=dialog]",
        )
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

  const ready = reviewQuery.isSuccess;
  const remaining = items.length - readCount;
  const busy = archive.isPending || mute.isPending;

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
      <div className="flex flex-col gap-4 py-2">
        <div className="flex items-start gap-3 px-1">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="font-heading text-xl font-semibold tracking-tight">
              {formatFullDayHeader(today, locale)}
            </h2>
            <p className="text-sm text-muted-foreground">
              {!ready
                ? "\u00a0"
                : items.length === 0
                  ? t("review.todayIntroEmpty")
                  : remaining === 0
                    ? t("review.todayIntroDone", { count: items.length })
                    : t("review.todayIntro", { count: remaining })}
            </p>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={t("review.settingsTitle")}
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setSettingsOpen(true)}
                />
              }
            >
              <SlidersHorizontalIcon />
            </TooltipTrigger>
            <TooltipContent>{t("review.settingsTitle")}</TooltipContent>
          </Tooltip>
        </div>

        {reviewQuery.isLoading && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-1 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}
        {reviewQuery.isError && (
          <QueryErrorState
            className="min-h-56 border text-muted-foreground"
            isRetrying={reviewQuery.isFetching}
            onRetry={() => void reviewQuery.refetch()}
          />
        )}

        {ready && items.length === 0 && (
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

        {ready && items.length > 0 && (
          <>
            <DeckProgress
              current={cursor}
              finished={finished}
              items={items}
              onJump={goTo}
            />
            {finished ? (
              <DoneCard
                count={items.length}
                today={today}
                onReadAgain={() => goTo(0)}
              />
            ) : (
              item && (
                <>
                  <div
                    className="motion-safe:animate-rise"
                    key={item.memo.name}
                  >
                    <MemoSnapshotCard
                      badge={reviewReasonLabel(item.reason, t)}
                      locale={locale}
                      memo={item.memo}
                    >
                      {replyFor === item.memo.name && (
                        <MemoComments
                          autoFocus
                          canComment
                          memoId={getMemoResourceId(item.memo)}
                          variant="inline"
                        />
                      )}
                    </MemoSnapshotCard>
                  </div>
                  <div className="flex items-center gap-1">
                    <CardAction
                      active={replyFor === item.memo.name}
                      icon={<MessageSquarePlusIcon />}
                      label={t("review.reply")}
                      onClick={() =>
                        setReplyFor((value) =>
                          value === item.memo.name ? null : item.memo.name,
                        )
                      }
                    />
                    {item.memo.can_manage !== false && (
                      <CardAction
                        disabled={busy}
                        icon={<ArchiveIcon />}
                        label={t("review.archive")}
                        onClick={() =>
                          archive.mutate(getMemoResourceId(item.memo))
                        }
                      />
                    )}
                    <CardAction
                      disabled={busy}
                      icon={<EyeOffIcon />}
                      label={t("review.mute")}
                      onClick={() => mute.mutate(item.memo.name)}
                    />
                    <div className="ms-auto flex items-center gap-1">
                      <Button
                        aria-label={t("review.previous")}
                        disabled={cursor === 0}
                        size="icon"
                        title={t("review.previous")}
                        variant="ghost"
                        onClick={() => keyActionsRef.current.back()}
                      >
                        <ArrowLeftIcon />
                      </Button>
                      <Button
                        title={t("review.walkKeyHint")}
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
                  </div>
                </>
              )
            )}
          </>
        )}
      </div>
      <ReviewSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </WorkspaceLayout>
  );
}

/** A quiet card action: icon only on a phone, icon and label from `sm` up. */
function CardAction({
  active = false,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      aria-pressed={active || undefined}
      className={cn(
        "text-muted-foreground hover:text-foreground",
        active && "bg-muted text-foreground",
      )}
      disabled={disabled}
      size="sm"
      title={label}
      variant="ghost"
      onClick={onClick}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}

/** One segment per note: read ones mid-grey, the current one solid ink. */
function DeckProgress({
  current,
  finished,
  items,
  onJump,
}: {
  current: number;
  finished: boolean;
  items: TodayReviewItem[];
  onJump: (index: number) => void;
}) {
  const { t } = useI18n();
  const total = items.length;
  return (
    <div className="flex items-center gap-3 px-1">
      <div className="flex flex-1 gap-1">
        {items.map((entry, index) => (
          <button
            aria-current={!finished && index === current ? "step" : undefined}
            aria-label={t("review.deckProgress", {
              current: index + 1,
              total,
            })}
            className="group/seg flex h-4 flex-1 items-center outline-none"
            key={entry.memo.name}
            type="button"
            onClick={() => onJump(index)}
          >
            <span
              className={cn(
                "h-1 w-full rounded-full motion-safe:transition-colors motion-safe:duration-200 group-hover/seg:bg-foreground/50 group-focus-visible/seg:ring-2 group-focus-visible/seg:ring-ring/40",
                !finished && index === current
                  ? "bg-foreground"
                  : entry.reviewed
                    ? "bg-foreground/35"
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
 * The closing card. One line about the week sits here instead of a chart:
 * the sidebar heatmap already shows how much was written, and the review is
 * about what was written.
 */
function DoneCard({
  count,
  today,
  onReadAgain,
}: {
  count: number;
  today: string;
  onReadAgain: () => void;
}) {
  const { t } = useI18n();
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  // Same cache entry as the sidebar heatmap.
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
  const weekCount = useMemo(() => {
    const since = addDays(today, -6);
    return (statsQuery.data?.activity ?? [])
      .filter((day) => day.date >= since && day.date <= today)
      .reduce((sum, day) => sum + day.count, 0);
  }, [statsQuery.data, today]);

  return (
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
            {t("review.doneDescription", { count })}
          </p>
          {statsQuery.isSuccess && (
            <p className="text-sm text-muted-foreground">
              {weekCount > 0
                ? t("review.doneWeek", { count: weekCount })
                : t("review.doneWeekEmpty")}
            </p>
          )}
        </div>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="outline" onClick={onReadAgain}>
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
  );
}
