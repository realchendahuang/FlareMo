import { Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  FootprintsIcon,
  PlusIcon,
  ShuffleIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getRandomWalkMemo, getWalkNextMemo } from "@/api";
import { MemoSnapshotCard } from "@/components/memo-snapshot-card";
import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ReviewTabs } from "@/components/workspace/review-tabs";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { WorkspacePageHeader } from "@/components/workspace/workspace-page-header";
import { type TranslationKey, useI18n } from "@/i18n";
import { formatMemoTime } from "@/lib/memo";
import { cn } from "@/lib/utils";
import {
  type Season,
  seasonOf,
  summarizeWalk,
  type WalkStep,
  yearOf,
} from "@/lib/walk";

const SEASON_KEYS: Record<Season, TranslationKey> = {
  spring: "review.season.spring",
  summer: "review.season.summer",
  autumn: "review.season.autumn",
  winter: "review.season.winter",
};

export function RandomWalkPage() {
  const { locale, t } = useI18n();
  const [steps, setSteps] = useState<WalkStep[]>([]);
  const [cursor, setCursor] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [pending, setPending] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const startedRef = useRef(false);

  const start = useCallback(async () => {
    setPending(true);
    setLoadError(false);
    try {
      const { memo } = await getRandomWalkMemo();
      setSteps(memo ? [{ memo, via: null }] : []);
      setCursor(0);
      setExhausted(false);
      setFinished(false);
    } catch {
      setLoadError(true);
    } finally {
      setPending(false);
    }
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void start();
  }, [start]);

  const walk = async () => {
    const last = steps.at(-1);
    if (!last || pending) return;
    setPending(true);
    setLoadError(false);
    try {
      const { memo, via } = await getWalkNextMemo(
        last.memo.name,
        steps.map((step) => step.memo.name),
      );
      if (!memo) {
        setExhausted(true);
      } else {
        setSteps((current) => [...current, { memo, via }]);
        setCursor(steps.length);
        setExhausted(false);
      }
    } catch {
      setLoadError(true);
    } finally {
      setPending(false);
    }
  };

  const restart = () => {
    void start();
  };

  // Keyboard walking, so a long wander needs no pointer: → or J continues,
  // ← or K steps back through the trail. Typing in a field is left alone.
  const keyActionsRef = useRef<{ walk: () => void; back: () => void }>({
    walk: () => {},
    back: () => {},
  });
  keyActionsRef.current = {
    walk: () =>
      cursor < steps.length - 1 ? setCursor(cursor + 1) : void walk(),
    back: () => setCursor((current) => Math.max(0, current - 1)),
  };
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
        keyActionsRef.current.walk();
      } else if (event.key === "ArrowLeft" || event.key === "k") {
        event.preventDefault();
        keyActionsRef.current.back();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const step = steps[cursor];

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
            <FootprintsIcon className="size-4 shrink-0 text-brand-600 dark:text-brand-400" />
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
        <div className="flex flex-col gap-1 px-1">
          <h2 className="font-heading text-xl font-semibold tracking-tight">
            {t("nav.randomWalk")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("review.walkIntro")}
          </p>
        </div>
        {finished ? (
          <WalkPostcard onRestart={restart} pending={pending} steps={steps} />
        ) : (
          <>
            {pending && steps.length === 0 && (
              <Skeleton className="h-64 w-full" />
            )}
            {loadError && (
              <QueryErrorState
                className="min-h-72 border text-muted-foreground"
                isRetrying={pending}
                onRetry={() => void (steps.length > 0 ? walk() : start())}
              />
            )}
            {!pending && !loadError && steps.length === 0 && (
              <Empty className="min-h-72 border border-border/60 bg-card/50 motion-safe:animate-rise">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FootprintsIcon className="size-5" />
                  </EmptyMedia>
                  <EmptyTitle>{t("review.walkEmptyTitle")}</EmptyTitle>
                  <EmptyDescription>
                    {t("review.walkEmptyDescription")}
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
                    {t("review.writeFirstMemo")}
                  </Button>
                </EmptyContent>
              </Empty>
            )}
            {step && (
              <>
                <MemoSnapshotCard
                  badge={viaLabel(step, t)}
                  key={step.memo.name}
                  locale={locale}
                  memo={step.memo}
                />
                <div className="flex items-center gap-2">
                  <Button
                    disabled={cursor === 0}
                    variant="ghost"
                    onClick={() => keyActionsRef.current.back()}
                  >
                    <ArrowLeftIcon data-icon="inline-start" />
                    {t("review.walkBack")}
                  </Button>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {t("review.walkKeyHint")}
                  </span>
                  <Button
                    className="ms-auto"
                    disabled={pending}
                    variant="ghost"
                    onClick={() => setFinished(true)}
                  >
                    {t("review.walkFinish")}
                  </Button>
                  <Button
                    disabled={
                      pending || (exhausted && cursor >= steps.length - 1)
                    }
                    onClick={() =>
                      cursor < steps.length - 1
                        ? setCursor(cursor + 1)
                        : void walk()
                    }
                  >
                    {pending ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <FootprintsIcon data-icon="inline-start" />
                    )}
                    {t("review.walkContinue")}
                    <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                </div>
                {exhausted && (
                  <div className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">
                      {t("review.walkExhausted")}
                    </p>
                    <p className="mt-1">{t("review.walkExhaustedHint")}</p>
                    <Button
                      className="mt-3"
                      size="sm"
                      variant="outline"
                      onClick={restart}
                    >
                      <ShuffleIcon data-icon="inline-start" />
                      {t("review.walkAgain")}
                    </Button>
                  </div>
                )}
                {steps.length > 1 && (
                  <nav
                    aria-label={t("review.walkHistory", {
                      count: steps.length,
                    })}
                    className="flex flex-col gap-2"
                  >
                    <p className="px-1 text-xs text-muted-foreground">
                      {t("review.walkHistory", { count: steps.length })}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {steps.map((item, index) => (
                        <button
                          aria-current={index === cursor ? "step" : undefined}
                          className={cn(
                            // A selector, like FilterPill: card face and
                            // hairline at rest, solid ink when current.
                            "flex h-8 w-8 items-center justify-center rounded-lg border text-xs tabular-nums motion-safe:transition-colors motion-safe:duration-150",
                            index === cursor
                              ? "border-foreground bg-foreground text-background"
                              : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                          key={item.memo.name}
                          title={formatMemoTime(item.memo.create_time, locale)}
                          type="button"
                          onClick={() => setCursor(index)}
                        >
                          {index + 1}
                        </button>
                      ))}
                    </div>
                  </nav>
                )}
              </>
            )}
          </>
        )}
      </div>
    </WorkspaceLayout>
  );
}

function WalkPostcard({
  onRestart,
  pending,
  steps,
}: {
  onRestart: () => void;
  pending: boolean;
  steps: WalkStep[];
}) {
  const { t } = useI18n();
  const summary = summarizeWalk(steps);
  const start = summary.earliest ? spanPoint(summary.earliest, t) : null;
  const end = summary.latest ? spanPoint(summary.latest, t) : null;

  return (
    <Card className="border-brand-300/40 ring-brand-400/20 dark:border-brand-400/25">
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-xs font-medium text-muted-foreground">
          {t("review.postcardTitle")}
        </p>
        <p className="font-heading text-2xl font-semibold">
          {t("review.postcardStats", {
            count: summary.count,
            characters: summary.characters,
          })}
        </p>
        {start && end && (
          <p className="text-sm text-muted-foreground">
            {start === end ? start : t("review.timeSpan", { start, end })}
          </p>
        )}
        <Button
          className="mt-2"
          disabled={pending}
          variant="outline"
          onClick={onRestart}
        >
          <ShuffleIcon data-icon="inline-start" />
          {t("review.walkAgain")}
        </Button>
      </CardContent>
    </Card>
  );
}

function viaLabel(
  step: WalkStep,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
) {
  if (!step.via) return null;
  if (step.via.type === "tag") {
    return t("review.viaTag", { tag: step.via.tag });
  }
  return step.via.type === "relation"
    ? t("review.viaRelation")
    : t("review.viaJump");
}

function spanPoint(
  value: string,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
) {
  const season = seasonOf(value);
  const year = yearOf(value);
  if (!season || year === null) return "";
  return t("review.spanPoint", { year, season: t(SEASON_KEYS[season]) });
}
