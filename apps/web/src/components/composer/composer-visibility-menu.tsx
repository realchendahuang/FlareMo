import { LockIcon, UsersIcon } from "lucide-react";
import type { MemoVisibility } from "@/api";
import { SendButton } from "@/components/composer/send-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

const SUBMIT_HINT =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
    ? "⌘↵"
    : "Ctrl ↵";

/**
 * The composer's right rail: the personal/team visibility picker (only for
 * members who can choose) and the round send button, which submits the form.
 * The current visibility decides which of the two items is inert, so picking
 * the active one is a no-op rather than a redundant draft write.
 */
export function ComposerVisibilityMenu({
  showVisibility,
  visibility,
  isPending,
  isUploadingImages,
  canSubmit,
  voiceActive,
  onVisibilityChange,
}: {
  showVisibility: boolean;
  visibility: MemoVisibility;
  isPending: boolean;
  isUploadingImages: boolean;
  canSubmit: boolean;
  voiceActive: boolean;
  /** Records the pick in the draft and persists the per-space preference. */
  onVisibilityChange: (visibility: MemoVisibility) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex shrink-0 items-center gap-1.5 self-center">
      {showVisibility && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={t("composer.visibility.aria")}
                className={cn(
                  "h-7 gap-1 rounded-full border px-2.5 text-xs font-normal transition-colors",
                  visibility === "protected"
                    ? "border-primary/30 bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
                disabled={isPending}
                size="sm"
                type="button"
                variant="ghost"
              />
            }
          >
            {visibility === "protected" ? (
              <UsersIcon data-icon="inline-start" className="size-3.5" />
            ) : (
              <LockIcon data-icon="inline-start" className="size-3.5" />
            )}
            <span
              className={cn(visibility === "private" && "hidden sm:inline")}
            >
              {visibility === "protected"
                ? t("composer.visibility.team")
                : t("composer.visibility.personal")}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => {
                if (visibility === "protected") return;
                onVisibilityChange("private");
              }}
            >
              <LockIcon />
              {t("composer.visibility.personal")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                if (visibility !== "protected") return;
                onVisibilityChange("protected");
              }}
            >
              <UsersIcon />
              {t("composer.visibility.team")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {/* Shortcut hint, outside the button so its accessible name stays
          exactly "Send". Appears only once there is something to send. */}
      {canSubmit && !isPending && (
        <span
          aria-hidden="true"
          className="pointer-events-none hidden items-center gap-0.5 font-sans text-xs text-muted-foreground/70 select-none motion-safe:animate-fade md:inline-flex"
        >
          {SUBMIT_HINT}
        </span>
      )}
      <SendButton
        canSubmit={canSubmit}
        disabled={isUploadingImages || voiceActive}
        isPending={isPending}
      />
    </div>
  );
}
