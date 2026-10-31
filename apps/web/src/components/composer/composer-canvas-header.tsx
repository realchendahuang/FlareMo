import { CheckIcon, Minimize2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogClose, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { useI18n } from "@/i18n";

/**
 * Top bar of the focus canvas: the sr-only dialog title, the local-save
 * status with live word count / reading time, and the ESC + minimize
 * affordances that exit back to the inline composer.
 */
export function ComposerCanvasHeader({
  charCount,
  readingTimeMinutes,
}: {
  charCount: number;
  readingTimeMinutes: number;
}) {
  const { t } = useI18n();
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/50 px-4 sm:px-6">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <DialogTitle className="sr-only">{t("composer.type.memo")}</DialogTitle>
        <div className="flex items-center gap-1.5">
          <CheckIcon className="size-3 text-success-emphasis" />
          <span>{t("composer.fullscreen.savedLocally")}</span>
        </div>
        {charCount > 0 && (
          <>
            <span aria-hidden="true" className="text-muted-foreground/40">
              ·
            </span>
            <span className="tabular-nums">
              {t("composer.fullscreen.wordCount", { count: charCount })}
            </span>
            {charCount >= 200 && (
              <>
                <span aria-hidden="true" className="text-muted-foreground/40">
                  ·
                </span>
                <span>
                  {t("composer.fullscreen.readingTime", {
                    minutes: readingTimeMinutes,
                  })}
                </span>
              </>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Kbd className="hidden sm:inline-flex">esc</Kbd>
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              title={t("composer.fullscreen.close")}
              aria-label={t("composer.fullscreen.close")}
            />
          }
        >
          <Minimize2Icon className="size-4" />
        </DialogClose>
      </div>
    </div>
  );
}
