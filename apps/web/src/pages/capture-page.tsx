import { CAPTURE_MAX_TEXT } from "@flaremo/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { Mic, Square } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createMemo, getCaptureStatus, updateMemo } from "@/api";
import { authClient } from "@/auth-client";
import { SubpageHeader } from "@/components/subpage-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import {
  CaptureController,
  captureIsActive,
} from "@/lib/audio-capture/controller";
import {
  CaptureDraftStore,
  captureDraftId,
  type LocalCapture,
  loadCapture,
  newLocalCapture,
} from "@/lib/audio-capture/local-session";
import { openMicrophone } from "@/lib/audio-capture/microphone";
import { CaptureTranscriptAccumulator } from "@/lib/audio-capture/transcript";

export function CapturePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const userId = session.data?.user.id ?? "";
  const draftId = useMemo(() => captureDraftId(userId), [userId]);
  const store = useMemo(() => new CaptureDraftStore(draftId), [draftId]);
  const status = useQuery({
    queryKey: ["capture-status", userId],
    queryFn: getCaptureStatus,
    staleTime: 30_000,
    retry: false,
  });
  const [controller] = useState(
    () =>
      new CaptureController({
        microphone: openMicrophone,
        status: getCaptureStatus,
        socket: () =>
          new WebSocket(
            `${location.origin.replace(/^http/, "ws")}/api/app/capture/ws`,
          ),
      }),
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const [local, setLocal] = useState(newLocalCapture);
  const [recovery, setRecovery] = useState<LocalCapture | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [draftError, setDraftError] = useState(false);
  const [cleanupError, setCleanupError] = useState(false);
  const [now, setNow] = useState(Date.now());
  const savingRef = useRef(false);
  const savedRef = useRef(false);
  const savedMemoRef = useRef<Awaited<ReturnType<typeof createMemo>> | null>(
    null,
  );
  const submittedMemoRef = useRef<Parameters<typeof createMemo>[0] | null>(
    null,
  );
  const localRef = useRef(local);
  localRef.current = local;
  const transcript = useRef(new CaptureTranscriptAccumulator());
  const tail = useRef<HTMLDivElement>(null);
  const active = captureIsActive(snapshot.state);
  const unsaved = active || review || Boolean(recovery);
  const blocker = useBlocker({
    disabled: !unsaved,
    enableBeforeUnload: true,
    shouldBlockFn: () => !savedRef.current,
    withResolver: true,
  });
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadCapture(draftId).then((value) => {
      if (!cancelled) {
        if (value) store.markRecovered();
        setRecovery(value);
        setLoaded(true);
      }
    });
    const hidden = () => {
      if (document.hidden) controller.interrupt();
    };
    const pageHide = () => {
      controller.interrupt();
      controller.dispose();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", pageHide);
    return () => {
      cancelled = true;
      controller.dispose();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", pageHide);
      if (!savedRef.current && !savedMemoRef.current && localRef.current.text)
        void store.save(localRef.current).catch(() => undefined);
    };
  }, [controller, draftId, store]);

  useEffect(() => {
    if (!snapshot.startedAt) return;
    const text = transcript.current.sync(
      snapshot.sentences,
      snapshot.startedAt,
      snapshot.sentenceVersion,
    );
    setLocal((value) =>
      mergeCaptureSnapshot(
        value,
        text,
        snapshot.startedAt,
        snapshot.stoppedAt,
        snapshot.gap,
      ),
    );
    if (snapshot.state === "review") setReview(true);
  }, [
    snapshot.gap,
    snapshot.sentences,
    snapshot.sentenceVersion,
    snapshot.startedAt,
    snapshot.state,
    snapshot.stoppedAt,
  ]);

  useEffect(() => {
    if (!loaded || savedRef.current || (!local.text && !review)) return;
    const timer = window.setTimeout(
      () => {
        void store
          .save(local)
          .then((ok) => setDraftError(!ok))
          .catch(() => setDraftError(true));
      },
      review ? 250 : 500,
    );
    return () => window.clearTimeout(timer);
  }, [local, loaded, review, store]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  useEffect(() => {
    if (!snapshot.microphoneActive || !navigator.wakeLock) return;
    let cancelled = false;
    let lock: WakeLockSentinel | undefined;
    void navigator.wakeLock
      .request("screen")
      .then((value) => {
        if (cancelled) void value.release();
        else lock = value;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      void lock?.release();
    };
  }, [snapshot.microphoneActive]);
  useEffect(() => {
    if (snapshot.partial || snapshot.sentenceVersion)
      tail.current?.scrollIntoView({ block: "nearest" });
  }, [snapshot.partial, snapshot.sentenceVersion]);

  const start = () => {
    savedRef.current = false;
    setReview(false);
    setSaveError(false);
    setCleanupError(false);
    savedMemoRef.current = null;
    submittedMemoRef.current = null;
    transcript.current.reset();
    setLocal(newLocalCapture());
    void controller.start();
  };
  const discard = async () => {
    const cleared = await store.clear();
    if (!cleared) {
      setDraftError(true);
      return;
    }
    savedRef.current = true;
    savedMemoRef.current = null;
    submittedMemoRef.current = null;
    transcript.current.reset();
    controller.reset();
    setReview(false);
    setRecovery(null);
    setLocal(newLocalCapture());
    setSaveError(false);
    setDraftError(false);
    setCleanupError(false);
  };
  const save = async () => {
    if (savingRef.current || !local.text.trim()) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      let memo = savedMemoRef.current;
      if (!memo) {
        const content = `# ${t("capture.title")}\n\n${t("capture.recordedAt")}: ${new Date(local.startedAt).toLocaleString()}\n\n${t("capture.duration")}: ${formatDuration(local.duration)}\n\n${local.gap ? `${t("capture.gap")}\n\n` : ""}---\n\n${local.text.trim()}`;
        const input: Parameters<typeof createMemo>[0] = {
          content,
          visibility: local.visibility,
          source: "voice",
          payload: {
            tags: Array.from(new Set(["voice", ...local.tags])),
            client_id: local.clientId,
          },
        };
        const previousInput = submittedMemoRef.current;
        submittedMemoRef.current = input;
        memo = await createOrReconcileCaptureMemo(input, previousInput);
        savedMemoRef.current = memo;
      }
      const cleared = await store.clear();
      if (!cleared) {
        setCleanupError(true);
        return;
      }
      savedRef.current = true;
      setDraftError(false);
      setCleanupError(false);
      await Promise.all(
        ["memos", "memo-stats", "tags", "tag-hierarchy"].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
      await navigate({ to: "/memo/$memoId", params: { memoId: memo.id } });
    } catch {
      setSaveError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const stopAndLeave = async () => {
    if (blocker.status !== "blocked" || leaving) return;
    const proceed = blocker.proceed;
    const wasActive = captureIsActive(controller.getSnapshot().state);
    setLeaving(true);
    try {
      if (wasActive) {
        await controller.stop();
        if (captureIsActive(controller.getSnapshot().state)) {
          await new Promise<void>((resolve) => {
            const unsubscribe = controller.subscribe(() => {
              if (!captureIsActive(controller.getSnapshot().state)) {
                unsubscribe();
                resolve();
              }
            });
          });
        }
      }
      const finalSnapshot = controller.getSnapshot();
      const text = finalSnapshot.startedAt
        ? transcript.current.sync(
            finalSnapshot.sentences,
            finalSnapshot.startedAt,
          )
        : localRef.current.text;
      const value = wasActive
        ? mergeCaptureSnapshot(
            localRef.current,
            text,
            finalSnapshot.startedAt,
            finalSnapshot.stoppedAt,
            finalSnapshot.gap,
          )
        : localRef.current;
      localRef.current = value;
      let persisted = true;
      if (value.text) {
        persisted = await store.save(value).catch(() => false);
        setDraftError(!persisted);
      }
      // A failed explicit write gets one final best-effort retry during unmount.
      savedRef.current = persisted;
      proceed();
    } finally {
      setLeaving(false);
    }
  };
  const elapsed =
    active && snapshot.startedAt
      ? Math.max(
          0,
          Math.floor(((snapshot.stoppedAt ?? now) - snapshot.startedAt) / 1000),
        )
      : local.duration;
  const statusText =
    snapshot.state === "requesting_permission"
      ? t("capture.requestingPermission")
      : snapshot.state === "connecting"
        ? t("capture.connecting")
        : snapshot.state === "reconnecting"
          ? t("capture.reconnecting")
          : snapshot.state === "stopping"
            ? t("capture.stopping")
            : snapshot.state === "recording"
              ? t("capture.recording")
              : t("capture.description");

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 bg-background px-4 py-6 sm:px-6">
      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open && !leaving && blocker.status === "blocked")
            blocker.reset();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("capture.leaveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(active ? "capture.leaveRecording" : "capture.leaveUnsaved")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaving}>
              {t(active ? "capture.continueRecording" : "common.cancel")}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={leaving}
              onClick={() => void stopAndLeave()}
            >
              {t(
                leaving
                  ? "capture.stopping"
                  : active
                    ? "capture.stopAndLeave"
                    : "capture.leavePage",
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SubpageHeader />
      <div>
        <h1 className="text-2xl font-semibold">
          {t(review ? "capture.review" : "capture.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("capture.foreground")}
        </p>
      </div>
      {draftError && (
        <p role="alert" className="rounded-lg border p-3 text-sm">
          {t("capture.draftUnavailable")}
        </p>
      )}
      {snapshot.error && (
        <p role="alert" className="rounded-lg border p-3 text-sm">
          {t(`capture.${snapshot.error}`)}
        </p>
      )}
      {(snapshot.gap || local.gap) && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("capture.gap")}
        </p>
      )}
      {recovery && (
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <h2 className="font-medium">{t("capture.recovery")}</h2>
          <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
            {recovery.text}
          </p>
          <div className="flex gap-3">
            <Button
              variant="brand"
              onClick={() => {
                setLocal(recovery);
                setReview(true);
                setRecovery(null);
              }}
            >
              {t("capture.restore")}
            </Button>
            <DiscardButton onDiscard={discard} />
          </div>
        </section>
      )}
      {!recovery && (
        <>
          <div className="rounded-xl border bg-card p-5">
            <div
              role="timer"
              className="font-mono text-3xl tabular-nums"
              aria-label={t("capture.duration")}
            >
              {formatDuration(elapsed)}
            </div>
            {!review && (
              <p
                role="status"
                aria-live="polite"
                className={`mt-3 flex items-center gap-2 text-sm ${
                  snapshot.state === "recording"
                    ? "font-medium text-primary"
                    : "text-muted-foreground"
                }`}
              >
                {snapshot.microphoneActive && (
                  <span
                    aria-hidden
                    className="relative flex size-5 shrink-0 items-center justify-center"
                  >
                    <span className="absolute size-5 rounded-full bg-primary/20 motion-safe:animate-ping" />
                    <Mic className="relative size-3.5" strokeWidth={2.5} />
                  </span>
                )}
                {statusText}
              </p>
            )}
          </div>
          {review ? (
            <>
              <label className="flex flex-col gap-2 text-sm font-medium">
                {t("capture.transcript")}
                <textarea
                  aria-label={t("capture.transcript")}
                  className="min-h-72 w-full resize-y rounded-xl border bg-card p-4 text-base leading-relaxed font-normal"
                  maxLength={CAPTURE_MAX_TEXT}
                  value={local.text}
                  disabled={saving || cleanupError}
                  onChange={(event) =>
                    setLocal((value) => ({
                      ...value,
                      text: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                {t("capture.tags")}
                <input
                  className="rounded-lg border bg-card p-3 text-base"
                  value={local.tags.join(", ")}
                  disabled={saving || cleanupError}
                  onChange={(event) =>
                    setLocal((value) => ({
                      ...value,
                      tags: event.target.value
                        .split(",")
                        .map((tag) => tag.trim().replace(/^#/, "").slice(0, 64))
                        .slice(0, 20),
                    }))
                  }
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                {t("capture.visibility")}
                <select
                  className="rounded-lg border bg-card p-3 text-base"
                  value={local.visibility}
                  disabled={saving || cleanupError}
                  onChange={(event) =>
                    setLocal((value) => ({
                      ...value,
                      visibility:
                        event.target.value === "public" ? "public" : "private",
                    }))
                  }
                >
                  <option value="private">{t("capture.private")}</option>
                  <option value="public">{t("capture.public")}</option>
                </select>
              </label>
              {saveError && <p role="alert">{t("capture.saveFailed")}</p>}
              {cleanupError && <p role="alert">{t("capture.cleanupFailed")}</p>}
              <div className="flex gap-3">
                {!cleanupError && (
                  <DiscardButton onDiscard={discard} disabled={saving} />
                )}
                <Button
                  className="flex-1"
                  variant="brand"
                  size="lg"
                  disabled={saving || !local.text.trim()}
                  onClick={() => void save()}
                >
                  {t(
                    saving
                      ? "capture.saving"
                      : cleanupError
                        ? "capture.retryCleanup"
                        : "capture.save",
                  )}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div
                role="log"
                aria-label={t("capture.transcript")}
                aria-live="off"
                className="max-h-[45dvh] min-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border bg-card p-4 text-base leading-relaxed"
              >
                {snapshot.sentences.length > 100 && (
                  <p className="text-sm text-muted-foreground">
                    {t("capture.recentSentences")}
                  </p>
                )}
                {snapshot.sentences.slice(-100).map((sentence) => (
                  <p className="mb-3" key={sentence.id}>
                    {sentence.text}
                  </p>
                ))}
                <p className="text-muted-foreground">
                  {snapshot.partial ||
                    (!snapshot.sentences.length ? t("capture.empty") : "")}
                </p>
                <div ref={tail} />
              </div>
              {active ? (
                <Button
                  variant="destructive"
                  size="lg"
                  onClick={() => void controller.stop()}
                  disabled={snapshot.state === "stopping"}
                >
                  <Square />
                  {t(
                    snapshot.state === "stopping"
                      ? "capture.stopping"
                      : "capture.stop",
                  )}
                </Button>
              ) : (
                <Button
                  variant="brand"
                  size="lg"
                  onClick={start}
                  disabled={!loaded || !status.data?.available}
                >
                  <Mic />
                  {t("capture.start")}
                </Button>
              )}
              {!status.isPending && !status.data?.available && (
                <p role="status" className="text-sm text-muted-foreground">
                  {t("capture.unavailable")}
                </p>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}

function mergeCaptureSnapshot(
  value: LocalCapture,
  text: string,
  startedAt: number | null,
  stoppedAt: number | null,
  gap: boolean,
): LocalCapture {
  if (!startedAt) return value;
  return {
    ...value,
    text,
    startedAt,
    duration: Math.max(
      0,
      Math.floor(((stoppedAt ?? Date.now()) - startedAt) / 1000),
    ),
    gap,
  };
}

async function createOrReconcileCaptureMemo(
  input: Parameters<typeof createMemo>[0],
  previousInput: Parameters<typeof createMemo>[0] | null,
) {
  const memo = await createMemo(input);
  if (captureMemoMatchesInput(memo, input)) return memo;

  // A create response can be lost after D1 commits. A retry then returns the
  // row for the same client_id. Reconcile only when that row still matches
  // the exact previous attempt, so another tab's edit is never overwritten.
  if (
    memo.payload.client_id !== input.payload?.client_id ||
    !previousInput ||
    !captureMemoMatchesInput(memo, previousInput)
  ) {
    throw new Error("Capture memo changed after its initial save");
  }
  const desiredTags = normalizedCaptureTags(input);
  return updateMemo(memo.id, {
    content: input.content,
    visibility: input.visibility,
    payload: {
      ...memo.payload,
      ...input.payload,
      tags: desiredTags,
    },
  });
}

function captureMemoMatchesInput(
  memo: Awaited<ReturnType<typeof createMemo>>,
  input: Parameters<typeof createMemo>[0],
) {
  const desiredTags = normalizedCaptureTags(input);
  const currentTags = Array.from(new Set(memo.payload.tags ?? [])).sort();
  return (
    memo.content === input.content &&
    memo.visibility === input.visibility &&
    desiredTags.length === currentTags.length &&
    desiredTags.every((tag, index) => tag === currentTags[index])
  );
}

function normalizedCaptureTags(input: Parameters<typeof createMemo>[0]) {
  return Array.from(new Set(input.payload?.tags ?? [])).sort();
}

function DiscardButton({
  onDiscard,
  disabled = false,
}: {
  onDiscard: () => Promise<void>;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          {t("capture.discard")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("capture.discard")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("capture.discardConfirm")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void onDiscard()}
          >
            {t("capture.discard")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
function formatDuration(totalSeconds: number) {
  return [
    Math.floor(totalSeconds / 3600),
    Math.floor((totalSeconds % 3600) / 60),
    Math.floor(totalSeconds % 60),
  ]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}
