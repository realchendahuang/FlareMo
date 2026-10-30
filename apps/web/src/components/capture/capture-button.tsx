import { Mic, Pause, Play, Square } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type CaptureButtonState = "idle" | "connecting" | "recording" | "paused";

/**
 * The single large capture control (72px > 44px touch target):
 * idle starts, recording stops, paused resumes; connecting is inert.
 * The breathing ring and state colors are real state indicators, so they
 * stay in the design-principle motion whitelist.
 */
export function CaptureButton({
  state,
  disabled = false,
  onStart,
  onStop,
  onResume,
  startLabel,
  stopLabel,
  resumeLabel,
}: {
  state: CaptureButtonState;
  disabled?: boolean;
  onStart: () => void;
  onStop: () => void;
  onResume: () => void;
  startLabel: string;
  stopLabel: string;
  resumeLabel: string;
}) {
  const busy = state === "connecting";
  const label =
    state === "idle"
      ? startLabel
      : state === "paused"
        ? resumeLabel
        : stopLabel;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled || busy}
      onClick={() =>
        state === "idle"
          ? onStart()
          : state === "paused"
            ? onResume()
            : onStop()
      }
      className={cn(
        "relative flex size-[72px] items-center justify-center rounded-full",
        "transition-[background-color,border-color,color,transform] duration-[140ms]",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        "active:scale-95 disabled:pointer-events-none disabled:opacity-50",
        state === "recording"
          ? "bg-destructive text-white hover:bg-destructive/90 dark:text-background"
          : "bg-brand-gradient text-[color:var(--brand-gradient-foreground)] shadow-md hover:brightness-[1.06] active:brightness-95",
      )}
    >
      {state === "recording" && (
        <span
          aria-hidden
          className="absolute size-[72px] rounded-full border-2 border-destructive motion-safe:animate-signal-ring"
        />
      )}
      {busy ? (
        <Spinner className="size-7" />
      ) : state === "idle" ? (
        <Mic aria-hidden className="size-7" strokeWidth={2.5} />
      ) : state === "paused" ? (
        <Play aria-hidden className="size-7 fill-current" />
      ) : (
        <Square aria-hidden className="size-6 fill-current" />
      )}
    </button>
  );
}

/** Secondary round control beside the big button (pause while recording). */
export function CapturePauseButton({
  onPaused,
  label,
}: {
  onPaused: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onPaused}
      className={cn(
        "flex size-12 items-center justify-center rounded-full border border-border",
        "bg-background text-foreground hover:bg-muted",
        "outline-none transition-colors duration-[140ms] focus-visible:ring-2 focus-visible:ring-ring/50",
        "active:scale-95",
      )}
    >
      <Pause aria-hidden className="size-5" strokeWidth={2.5} />
    </button>
  );
}
