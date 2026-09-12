import { CheckIcon, ClipboardIcon, KeyRoundIcon } from "lucide-react";
import { InfoTip } from "@/components/info-tip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TranslationKey } from "@/i18n";

/**
 * One-time secret reveal: an activation link, a password reset link, or a
 * personal access token. The value is shown once and never stored in
 * plaintext, so this modal is the operator's only chance to hand it over —
 * it stays open until they dismiss it explicitly.
 */
export function SecretRevealDialog({
  closeLabelKey,
  copied,
  copyLabelKey,
  description,
  onCopy,
  onOpenChange,
  open,
  t,
  titleKey,
  value,
}: {
  closeLabelKey: TranslationKey;
  copied: boolean;
  copyLabelKey: TranslationKey;
  description: string;
  onCopy: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  t: (key: TranslationKey) => string;
  titleKey: TranslationKey;
  value: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5 pr-7">
            {t(titleKey)}
            <InfoTip text={description} />
          </DialogTitle>
        </DialogHeader>
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3">
          <KeyRoundIcon className="mt-2 shrink-0 text-amber-700 dark:text-amber-300" />
          <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-background/80 px-3 py-2 text-xs break-all text-foreground">
            {value}
          </code>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCopy}>
            {copied ? (
              <CheckIcon data-icon="inline-start" />
            ) : (
              <ClipboardIcon data-icon="inline-start" />
            )}
            {copied ? t("auth.copied") : t(copyLabelKey)}
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            {t(closeLabelKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
