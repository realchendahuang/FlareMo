import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n";
import type { CaptureSnapshot } from "@/lib/audio-capture/controller";

function formatVoiceClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The live session overlay in the composer: recording length plus the partial
 * transcript, or the current pipeline stage (permission, connecting, batch
 * transcription). Cancel discards the session; Stop finishes it and hands the
 * final sentences to the draft.
 */
export function VoiceCaptureBar({
  capture,
  now,
  onCancel,
  onStop,
}: {
  capture: CaptureSnapshot;
  /** Wall clock for the recording length, refreshed by the composer. */
  now: number;
  onCancel: () => void;
  onStop: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="absolute inset-x-4 bottom-12 z-30 flex items-center gap-3 rounded-lg border border-border/60 bg-popover px-3 py-2.5 shadow-lg motion-safe:animate-rise">
      {capture.state === "recording" || capture.state === "reconnecting" ? (
        <>
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full bg-destructive motion-safe:animate-partial-pulse"
          />
          <span className="shrink-0 font-mono text-sm tabular-nums">
            {formatVoiceClock(
              capture.startedAt
                ? Math.max(
                    0,
                    Math.floor(
                      ((capture.stoppedAt ?? now) - capture.startedAt) / 1000,
                    ),
                  )
                : 0,
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {capture.partial || t("capture.recording")}
          </span>
        </>
      ) : (
        <>
          <Spinner className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {capture.state === "requesting_permission"
              ? t("capture.requestingPermission")
              : capture.state === "connecting"
                ? t("capture.connecting")
                : capture.state === "paused"
                  ? t("capture.paused")
                  : capture.state === "transcribing"
                    ? capture.transcribing
                      ? t("capture.transcribingCount", {
                          done: capture.transcribing.done,
                          total: capture.transcribing.total,
                        })
                      : t("capture.transcribing")
                    : t("capture.stopping")}
          </span>
        </>
      )}
      {capture.state !== "stopping" && capture.state !== "transcribing" && (
        <Button
          className="h-8 shrink-0 px-2.5 text-xs"
          size="sm"
          type="button"
          variant="ghost"
          onClick={onCancel}
        >
          {t("composer.voiceCancel")}
        </Button>
      )}
      {capture.state !== "stopping" && capture.state !== "transcribing" && (
        <Button
          className="h-8 shrink-0 px-2.5 text-xs"
          size="sm"
          type="button"
          variant="brand"
          onClick={onStop}
        >
          {t("composer.voiceStop")}
        </Button>
      )}
    </div>
  );
}
