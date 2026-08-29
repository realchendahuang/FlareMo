import { FootprintsIcon, Loader2Icon, ShuffleIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getRandomWalkMemo, getWalkNextMemo } from "@/api";
import { MemoSnapshotCard } from "@/components/memo-snapshot-card";
import { SubpageHeader } from "@/components/subpage-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
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

  const step = steps[cursor];

  return (
    <div className="min-h-svh bg-background px-4 py-5 sm:py-8">
      <main className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
        <SubpageHeader />

        <div className="px-1">
          <h1 className="font-heading text-xl font-semibold">
            {t("nav.randomWalk")}
          </h1>
        </div>

        {finished ? (
          <WalkPostcard onRestart={restart} pending={pending} steps={steps} />
        ) : (
          <>
            {pending && steps.length === 0 && (
              <Skeleton className="h-64 w-full" />
            )}
            {loadError && (
              <Empty className="min-h-72 border">
                <EmptyHeader>
                  <EmptyTitle>{t("list.errorTitle")}</EmptyTitle>
                  <EmptyDescription>
                    {t("list.errorDescription")}
                  </EmptyDescription>
                </EmptyHeader>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  onClick={() => void (steps.length > 0 ? walk() : start())}
                >
                  {t("common.retry")}
                </Button>
              </Empty>
            )}
            {!pending && !loadError && steps.length === 0 && (
              <Empty className="min-h-72 border">
                <EmptyHeader>
                  <EmptyTitle>{t("review.walkEmptyTitle")}</EmptyTitle>
                  <EmptyDescription>
                    {t("review.walkEmptyDescription")}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {step && (
              <>
                <MemoSnapshotCard
                  badge={viaLabel(step, t)}
                  locale={locale}
                  memo={step.memo}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={pending || exhausted}
                    onClick={() => void walk()}
                  >
                    {pending ? (
                      <Loader2Icon
                        className="animate-spin"
                        data-icon="inline-start"
                      />
                    ) : (
                      <FootprintsIcon data-icon="inline-start" />
                    )}
                    {t("review.walkContinue")}
                  </Button>
                  <Button
                    disabled={pending}
                    variant="outline"
                    onClick={() => setFinished(true)}
                  >
                    {t("review.walkFinish")}
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
                            "flex h-8 w-8 items-center justify-center rounded-lg border text-xs tabular-nums motion-safe:transition-colors motion-safe:duration-150",
                            index === cursor
                              ? "border-primary bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
      </main>
    </div>
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
    <Card className="border-flame-300/40 ring-flame-400/20 dark:border-flame-400/25">
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-xs tracking-[0.3em] text-muted-foreground uppercase">
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
