import {
  CAPTURE_MAX_DURATION_MS,
  CAPTURE_MAX_TEXT,
} from "@flaremo/contracts/constants";
import { Link } from "@tanstack/react-router";
import { Mic, Square } from "lucide-react";
import {
  CaptureButton,
  type CaptureButtonState,
  CapturePauseButton,
} from "@/components/capture/capture-button";
import { CaptureTranscribing } from "@/components/capture/capture-transcribing";
import { CaptureWaveform } from "@/components/capture/capture-waveform";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { WorkspacePageHeader } from "@/components/workspace/workspace-page-header";
import { useI18n } from "@/i18n";
import { formatDuration } from "@/lib/format-duration";
import { vibrate } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import {
  CaptureReviewForm,
  DiscardButton,
} from "./capture/capture-review-form";
import { useCaptureSession } from "./capture/use-capture-session";
import { useCaptureSubmit } from "./capture/use-capture-submit";

export function CapturePage() {
  const { t } = useI18n();
  const session = useCaptureSession();
  const {
    status,
    canManageVoiceService,
    controller,
    snapshot,
    transcribing,
    transcribeProgress,
    active,
    local,
    setLocal,
    recovery,
    setRecovery,
    loaded,
    review,
    setReview,
    logLeaving,
    saving,
    saveError,
    draftError,
    cleanupError,
    keepAudio,
    updateKeepAudio,
    now,
    getWaveform,
    tail,
    blocker,
    leaving,
    start,
    discard,
    stopAndLeave,
  } = session;
  const { save } = useCaptureSubmit(session);

  const elapsed =
    active && snapshot.startedAt
      ? Math.max(
          0,
          Math.floor(((snapshot.stoppedAt ?? now) - snapshot.startedAt) / 1000),
        )
      : local.duration;
  const nearLimit = elapsed * 1000 >= CAPTURE_MAX_DURATION_MS - 5 * 60_000;
  const statusText =
    snapshot.state === "requesting_permission"
      ? t("capture.requestingPermission")
      : snapshot.state === "connecting"
        ? t("capture.connecting")
        : snapshot.state === "reconnecting"
          ? t("capture.reconnecting")
          : snapshot.state === "stopping"
            ? t("capture.stopping")
            : snapshot.state === "paused"
              ? t("capture.paused")
              : snapshot.state === "recording"
                ? t("capture.recording")
                : snapshot.state === "transcribing"
                  ? t("capture.transcribing")
                  : t("capture.description");
  const buttonState: CaptureButtonState =
    snapshot.state === "recording" || snapshot.state === "stopping"
      ? "recording"
      : snapshot.state === "paused"
        ? "paused"
        : snapshot.state === "idle" ||
            snapshot.state === "error" ||
            snapshot.state === "review"
          ? "idle"
          : "connecting";
  const bigButtonDisabled =
    buttonState === "connecting"
      ? true
      : buttonState === "idle"
        ? !loaded || !status.data?.available
        : snapshot.state === "stopping" ||
          snapshot.state === "reconnecting" ||
          snapshot.state === "transcribing";

  return (
    <WorkspaceLayout
      contentMaxWidth={672}
      header={({
        sidebarCollapsed,
        toggleSidebarCollapsed,
        mobileSheetOpen,
        setMobileSheetOpen,
        explorer,
      }) => (
        <WorkspacePageHeader
          contentMaxWidth={672}
          explorer={explorer}
          icon={
            <Mic className="size-4 shrink-0 text-brand-600 dark:text-brand-400" />
          }
          mobileSheetOpen={mobileSheetOpen}
          setMobileSheetOpen={setMobileSheetOpen}
          sidebarCollapsed={sidebarCollapsed}
          title={t(review ? "capture.review" : "capture.title")}
          toggleSidebarCollapsed={toggleSidebarCollapsed}
        />
      )}
    >
      <div className="flex flex-col gap-6 py-2">
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
        <p className="-mt-3 text-sm text-muted-foreground">
          {t("capture.foreground")}
        </p>
        {draftError && (
          <p role="alert" className="rounded-lg border p-3 text-sm">
            {t("capture.draftUnavailable")}
          </p>
        )}
        {snapshot.error && (
          <div role="alert" className="space-y-3 rounded-lg border p-3 text-sm">
            <p>{t(`capture.${snapshot.error}`)}</p>
            {snapshot.error === "transcribeFailed" && !saving && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => controller.retryTranscription()}
              >
                {t("capture.retryTranscription")}
              </Button>
            )}
          </div>
        )}
        {(snapshot.gap || local.gap) && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("capture.gap")}
          </p>
        )}
        {recovery && (
          <section className="space-y-3 rounded-xl border bg-card p-5">
            <h2 className="text-sm font-medium">{t("capture.recovery")}</h2>
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
              {snapshot.microphoneActive && !review && (
                <div className="mt-3">
                  <CaptureWaveform
                    active={snapshot.microphoneActive}
                    getWaveform={getWaveform}
                    label={t("capture.waveform")}
                  />
                </div>
              )}
              {elapsed > 0 && (
                <div
                  role="progressbar"
                  aria-label={t("capture.duration")}
                  aria-valuemin={0}
                  aria-valuemax={CAPTURE_MAX_DURATION_MS / 1000}
                  aria-valuenow={Math.min(
                    elapsed,
                    CAPTURE_MAX_DURATION_MS / 1000,
                  )}
                  className="mt-4 h-1 w-full overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className={`h-full rounded-full ${
                      nearLimit ? "bg-destructive" : "bg-primary"
                    }`}
                    style={{
                      width: `${Math.min(
                        100,
                        ((elapsed * 1000) / CAPTURE_MAX_DURATION_MS) * 100,
                      )}%`,
                    }}
                  />
                </div>
              )}
              {!review && nearLimit && (
                <p role="status" className="mt-3 text-sm text-destructive">
                  {t("capture.nearLimit")}
                </p>
              )}
            </div>
            {review && (
              <CaptureReviewForm
                local={local}
                setLocal={setLocal}
                saving={saving}
                saveError={saveError}
                cleanupError={cleanupError}
                keepAudio={keepAudio}
                onKeepAudioChange={updateKeepAudio}
                onDiscard={discard}
                onSave={save}
              />
            )}
            {(!review || logLeaving) && (
              <>
                <div
                  role="log"
                  aria-label={t("capture.transcript")}
                  aria-live="off"
                  className={cn(
                    "max-h-[45dvh] min-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border bg-card p-4 text-base leading-relaxed",
                    review &&
                      logLeaving &&
                      "motion-safe:animate-fade [animation-direction:reverse]",
                  )}
                >
                  {snapshot.sentences.length > 100 && (
                    <p className="text-sm text-muted-foreground">
                      {t("capture.recentSentences")}
                    </p>
                  )}
                  {snapshot.sentences.slice(-100).map((sentence) => (
                    <p
                      className="mb-3 motion-safe:animate-rise"
                      key={sentence.id}
                    >
                      {sentence.text}
                    </p>
                  ))}
                  <p className="text-muted-foreground/70 motion-safe:animate-partial-pulse">
                    {snapshot.partial ||
                      (!snapshot.sentences.length ? t("capture.empty") : "")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("capture.charsUsed", {
                      count: (
                        local.text.length + snapshot.partial.length
                      ).toLocaleString(),
                      max: CAPTURE_MAX_TEXT.toLocaleString(),
                    })}
                  </p>
                  <div ref={tail} />
                </div>
                {transcribing && (
                  <div className="space-y-3">
                    <CaptureTranscribing
                      label={
                        transcribeProgress && transcribeProgress.total > 1
                          ? t("capture.transcribingCount", {
                              done: transcribeProgress.done,
                              total: transcribeProgress.total,
                            })
                          : t("capture.transcribing")
                      }
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => controller.cancelTranscription()}
                    >
                      {t("capture.cancelTranscribing")}
                    </Button>
                  </div>
                )}
              </>
            )}
            {!review && (
              <>
                <p aria-live="polite" className="sr-only">
                  {snapshot.sentences.at(-1)?.text ?? ""}
                </p>
                <div className="flex items-center justify-center gap-3">
                  {snapshot.state === "recording" && (
                    <CapturePauseButton
                      onPaused={() => {
                        vibrate(5);
                        controller.pause();
                      }}
                      label={t("capture.pause")}
                    />
                  )}
                  {snapshot.state === "paused" && (
                    <Button
                      variant="destructive"
                      size="icon"
                      className="size-12 rounded-full text-destructive"
                      aria-label={t("capture.stop")}
                      onClick={() => {
                        vibrate(5);
                        void controller.stop();
                      }}
                    >
                      <Square className="fill-current" />
                    </Button>
                  )}
                  <CaptureButton
                    state={buttonState}
                    disabled={bigButtonDisabled}
                    onStart={start}
                    onStop={() => {
                      vibrate(5);
                      void controller.stop();
                    }}
                    onResume={() => controller.resume()}
                    startLabel={t("capture.start")}
                    stopLabel={t("capture.stop")}
                    resumeLabel={t("capture.resume")}
                  />
                </div>
                {status.isError && !status.data ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <p role="status">{t("list.errorDescription")}</p>
                    <Button
                      disabled={status.isFetching}
                      onClick={() => void status.refetch()}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {t("common.retry")}
                    </Button>
                  </div>
                ) : !status.isPending && !status.data?.available ? (
                  <div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
                    <p role="status">{t("capture.unavailable")}</p>
                    {canManageVoiceService ? (
                      <Link
                        className="underline underline-offset-4 hover:text-foreground"
                        search={{ section: "voice" }}
                        to="/account"
                      >
                        {t("capture.unavailableOwnerLink")}
                      </Link>
                    ) : (
                      <p>{t("capture.unavailableMember")}</p>
                    )}
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
    </WorkspaceLayout>
  );
}
