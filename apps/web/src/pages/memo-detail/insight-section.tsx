import type { MemoInsightDto } from "@flaremo/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SparklesIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createMemoInsight, deleteMemoInsight, getMemoInsight } from "@/api";
import { InsightResultView } from "@/components/insight-result-view";
import { Alert } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

/** Poll cadence and the cap after which the browser stops waiting (§9 flow). */
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 60_000;

/**
 * The note detail page's AI insight entry.
 *
 * FlareMo does not run a model: creating the task only enqueues it for a
 * connected executor, so the UI polls the task it created for at most a
 * minute. The insight id lives in this component, which is also why leaving
 * the page stops polling — the result is displayed for this visit only (the
 * P2 scope; a history view is deliberately not part of it).
 */
export function InsightSection({ memoId }: { memoId: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [insightId, setInsightId] = useState<string | null>(null);
  const [createdInsight, setCreatedInsight] = useState<MemoInsightDto | null>(
    null,
  );
  // Bumped by "check again" to re-arm the wait window.
  const [pollRound, setPollRound] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const createMutation = useMutation({
    mutationFn: () => createMemoInsight({ kind: "note", memo_ids: [memoId] }),
    onMutate: () => {
      setCreatedInsight(null);
      setInsightId(null);
      setPollRound(0);
      setTimedOut(false);
    },
    onSuccess: ({ insight }) => {
      setCreatedInsight(insight);
      setInsightId(insight.id);
    },
  });

  const insightQuery = useQuery({
    queryKey: queryKeys.insights.detail(insightId ?? "none"),
    queryFn: () => getMemoInsight(insightId as string),
    enabled: insightId !== null,
    retry: false,
    refetchInterval: (query) => {
      if (timedOut) return false;
      const status = query.state.data?.insight.status;
      if (status === "done" || status === "failed") return false;
      return POLL_INTERVAL_MS;
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: pollRound is the deliberate re-arm trigger for a new 60s window, not a value the timer reads.
  useEffect(() => {
    if (insightId === null) return undefined;
    setTimedOut(false);
    const timer = window.setTimeout(() => setTimedOut(true), POLL_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [insightId, pollRound]);

  const insight = insightQuery.data?.insight ?? createdInsight;
  const status = insight?.status;
  const waiting =
    status !== undefined &&
    status !== "done" &&
    status !== "failed" &&
    !timedOut &&
    !insightQuery.isError;
  const waitingTimedOut =
    status !== undefined &&
    status !== "done" &&
    status !== "failed" &&
    timedOut &&
    !insightQuery.isError;

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteMemoInsight(id),
    onSuccess: (_value, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.insights.detail(id) });
      setCreatedInsight(null);
      setInsightId(null);
      setTimedOut(false);
      setConfirmingDelete(false);
      toast.success(t("insight.deleted"));
    },
    onError: (error) => {
      toast.error(errorMessage(error, t("insight.deleteFailed")));
    },
  });

  const handleCheckAgain = () => {
    setPollRound((round) => round + 1);
    if (insightId !== null) void insightQuery.refetch();
  };

  // Failed tasks cannot be reset through the browser (that transition is
  // PAT-only), so a retry drops the failed row and enqueues a fresh task.
  const handleRetry = async () => {
    const current = insight;
    if (current) {
      await deleteMemoInsight(current.id).catch(() => undefined);
      queryClient.removeQueries({
        queryKey: queryKeys.insights.detail(current.id),
      });
    }
    setCreatedInsight(null);
    setInsightId(null);
    createMutation.mutate();
  };

  const handleDelete = () => {
    const id = insight?.id;
    setConfirmingDelete(false);
    if (id) deleteMutation.mutate(id);
  };

  return (
    <section
      className="flex flex-col gap-3 border-t border-border/60 pt-4"
      data-slot="insight-section"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <SparklesIcon className="size-3.5 text-brand-600 dark:text-brand-400" />
          {t("insight.title")}
        </h2>
        {!insight && (
          <Button
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
            size="sm"
            variant="outline"
          >
            {createMutation.isPending ? (
              <Spinner data-icon="inline-start" className="size-3.5" />
            ) : (
              <SparklesIcon data-icon="inline-start" />
            )}
            {createMutation.isPending
              ? t("insight.creating")
              : t("insight.generate")}
          </Button>
        )}
      </div>

      {!insight && !createMutation.isPending && (
        <p className="text-xs leading-relaxed text-pretty text-muted-foreground">
          {t("insight.description")}
        </p>
      )}

      {createMutation.isError && (
        <Alert variant="destructive">
          {errorMessage(createMutation.error, t("insight.createFailed"))}
        </Alert>
      )}

      {insightQuery.isError && (
        <div className="flex flex-col items-start gap-2">
          <Alert variant="destructive">{t("insight.loadFailed")}</Alert>
          <Button onClick={handleCheckAgain} size="sm" variant="outline">
            {t("insight.checkAgain")}
          </Button>
        </div>
      )}

      {waiting && (
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-2 text-sm">
            <Spinner className="size-3.5" />
            {t("insight.pending")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("insight.pendingHint")}
          </p>
        </div>
      )}

      {waitingTimedOut && (
        <div className="flex flex-col items-start gap-2">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium">{t("insight.timeoutTitle")}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("insight.timeoutDescription")}
            </p>
          </div>
          <Button onClick={handleCheckAgain} size="sm" variant="outline">
            {t("insight.checkAgain")}
          </Button>
        </div>
      )}

      {status === "failed" && (
        <div className="flex flex-col items-start gap-2">
          <Alert variant="destructive">
            <p className="font-medium">{t("insight.failedTitle")}</p>
            <p className="mt-0.5 text-xs">
              {insight?.error?.trim() || t("insight.failedFallback")}
            </p>
          </Alert>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={createMutation.isPending}
              onClick={() => void handleRetry()}
              size="sm"
              variant="outline"
            >
              {t("insight.retry")}
            </Button>
            <Button
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmingDelete(true)}
              size="sm"
              variant="ghost"
            >
              {t("insight.delete")}
            </Button>
          </div>
        </div>
      )}

      {status === "done" && (
        <div className="flex flex-col items-start gap-2">
          <div className="w-full rounded-lg border border-border/60 bg-muted/30 p-3">
            {insight?.result === null || insight?.result === undefined ? (
              <p className="text-sm text-muted-foreground">
                {t("insight.emptyResult")}
              </p>
            ) : (
              <InsightResultView result={insight.result} />
            )}
          </div>
          <Button
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmingDelete(true)}
            size="sm"
            variant="ghost"
          >
            <Trash2Icon data-icon="inline-start" />
            {t("insight.delete")}
          </Button>
        </div>
      )}

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("insight.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("insight.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                handleDelete();
              }}
            >
              {t("insight.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
