import { Fragment } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { type TranslationKey, useI18n } from "@/i18n";

const SHORTCUT_ROWS: ReadonlyArray<{
  key: TranslationKey;
  combos: readonly string[];
}> = [
  { key: "shortcuts.search", combos: ["⌘K", "/"] },
  { key: "shortcuts.composer", combos: ["C"] },
  { key: "shortcuts.linebreak", combos: ["↵", "⇧↵"] },
  { key: "shortcuts.send", combos: ["⌘↵"] },
  { key: "shortcuts.saveEdit", combos: ["⌘↵"] },
  { key: "shortcuts.sidebar", combos: ["⌘\\"] },
  { key: "shortcuts.theme", combos: ["D"] },
  { key: "shortcuts.cancel", combos: ["Esc"] },
  { key: "shortcuts.help", combos: ["?"] },
];

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
          {SHORTCUT_ROWS.map(({ key, combos }) => (
            <div
              className="flex items-center justify-between gap-3 py-2 text-sm"
              key={key}
            >
              <span className="text-muted-foreground">{t(key)}</span>
              <span className="inline-flex shrink-0 items-center gap-1">
                {combos.map((combo, index) => (
                  <Fragment key={combo}>
                    {index > 0 && (
                      <span
                        aria-hidden="true"
                        className="px-0.5 text-xs text-muted-foreground/60"
                      >
                        /
                      </span>
                    )}
                    <Kbd className="px-1.5">{combo}</Kbd>
                  </Fragment>
                ))}
              </span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
