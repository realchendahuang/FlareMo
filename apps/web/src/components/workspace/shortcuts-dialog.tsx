import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type TranslationKey, useI18n } from "@/i18n";

/** The "?" cheat sheet listing every keyboard shortcut the app listens for. */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
          <DialogDescription>{t("shortcuts.subtitle")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col divide-y divide-border/60">
          {(
            [
              ["shortcuts.search", "⌘K / /"],
              ["shortcuts.composer", "C"],
              ["shortcuts.linebreak", "Enter / ⇧Enter"],
              ["shortcuts.send", "⌘Enter"],
              ["shortcuts.saveEdit", "⌘Enter"],
              ["shortcuts.sidebar", "⌘\\"],
              ["shortcuts.theme", "D"],
              ["shortcuts.cancel", "Esc"],
              ["shortcuts.help", "?"],
            ] as const
          ).map(([key, combo]) => (
            <div
              className="flex items-center justify-between gap-3 py-2 text-sm"
              key={key}
            >
              <span className="text-muted-foreground">
                {t(key as TranslationKey)}
              </span>
              <kbd className="rounded-md border bg-muted px-2 py-0.5 font-mono text-xs">
                {combo}
              </kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
