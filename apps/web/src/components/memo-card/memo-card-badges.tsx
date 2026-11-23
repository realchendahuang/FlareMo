import { Globe2Icon, LockIcon, MicIcon, UsersIcon } from "lucide-react";
import type { Memo, MemoState, MemoVisibility } from "@/api";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/i18n";
import { formatClock } from "@/lib/transcript";
import { cn } from "@/lib/utils";

/**
 * The timeline's voice-capture face (rollout §4.3, D5): a mic badge with the
 * recording length. Playback stays on the detail page — the card only
 * identifies the note as spoken.
 */
export function VoiceBadge({ memo }: { memo: Memo }) {
  const { t } = useI18n();
  const duration = memo.payload.durationSeconds;
  return (
    <Badge className="rounded-md" variant="outline" title={t("capture.title")}>
      <MicIcon />
      {typeof duration === "number" &&
        Number.isFinite(duration) &&
        duration > 0 && (
          <span className="tabular-nums">{formatClock(duration)}</span>
        )}
    </Badge>
  );
}

/**
 * A shared space shows one quiet, clickable badge instead of a text label:
 * clicking it directly opens the visibility and sharing management dialog.
 * Private notes (the common case) render nothing at all.
 */
export function VisibilityBadge({
  visibility,
  onClick,
}: {
  visibility: MemoVisibility;
  onClick?: () => void;
}) {
  const { t } = useI18n();
  const icon =
    visibility === "public" ? (
      <Globe2Icon className="size-3.5" />
    ) : visibility === "protected" ? (
      <UsersIcon className="size-3.5" />
    ) : (
      <LockIcon className="size-3.5" />
    );
  const label =
    visibility === "public"
      ? t("visibility.public")
      : visibility === "protected"
        ? t("visibility.protected")
        : t("visibility.private");

  if (visibility === "private") return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none transition-all duration-150 cursor-pointer focus-visible:ring-3 focus-visible:ring-ring/25 motion-safe:hover:-translate-y-px motion-safe:active:scale-95",
        visibility === "public"
          ? "hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-500/15 dark:hover:text-brand-400"
          : "hover:bg-muted hover:text-foreground",
      )}
    >
      {icon}
    </button>
  );
}

export function stateLabel(
  state: MemoState,
  t: ReturnType<typeof useI18n>["t"],
) {
  switch (state) {
    case "archived":
      return t("memo.stateArchived");
    case "trashed":
      return t("memo.stateTrashed");
    case "deleted":
      return t("memo.stateDeleted");
    default:
      return state;
  }
}
