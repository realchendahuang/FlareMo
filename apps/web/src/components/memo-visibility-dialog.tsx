import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  Globe2Icon,
  LockIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Memo, MemoVisibility, Share } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useClipboard } from "@/hooks/use-clipboard";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

type MemoVisibilityDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memo: Memo;
  share?: Share;
  onUpdateVisibility: (visibility: MemoVisibility) => Promise<void>;
  onShare: (id: string) => Promise<Share>;
  onRevokeShare?: (share: Share) => void;
};

export function MemoVisibilityDialog({
  open,
  onOpenChange,
  memo,
  share,
  onUpdateVisibility,
  onShare,
  onRevokeShare,
}: MemoVisibilityDialogProps) {
  const { t } = useI18n();
  const [isUpdating, setIsUpdating] = useState(false);
  const [ensuredShare, setEnsuredShare] = useState<Share | undefined>(share);
  const { copied, copy } = useClipboard();

  // Sync share when prop changes
  useEffect(() => {
    setEnsuredShare(share);
  }, [share]);

  const activeShare = ensuredShare ?? share;
  const shareUrl = activeShare
    ? `${globalThis.location.origin}/share/${activeShare.token}`
    : undefined;

  const handleSelectVisibility = async (nextVisibility: MemoVisibility) => {
    if (nextVisibility === memo.visibility || isUpdating) return;
    setIsUpdating(true);
    try {
      await onUpdateVisibility(nextVisibility);
      if (nextVisibility === "public") {
        if (!activeShare) {
          const newShare = await onShare(memo.id);
          setEnsuredShare(newShare);
        }
      } else {
        if (activeShare) {
          onRevokeShare?.(activeShare);
          setEnsuredShare(undefined);
        }
      }
    } catch {
      // Handled by parent mutation toast
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCopy = async () => {
    let url = shareUrl;
    if (!url) {
      try {
        const newShare = await onShare(memo.id);
        setEnsuredShare(newShare);
        url = `${globalThis.location.origin}/share/${newShare.token}`;
      } catch {
        toast.error(t("share.copyFailed"));
        return;
      }
    }
    await copy(url);
  };

  const options: Array<{
    value: MemoVisibility;
    icon: typeof LockIcon;
    label: string;
    description: string;
  }> = [
    {
      value: "private",
      icon: LockIcon,
      label: t("visibility.private"),
      description: t("visibility.privateDescription"),
    },
    {
      value: "protected",
      icon: UsersIcon,
      label: t("visibility.protected"),
      description: t("visibility.protectedDescription"),
    },
    {
      value: "public",
      icon: Globe2Icon,
      label: t("visibility.public"),
      description: t("visibility.publicDescription"),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("memo.visibilityAndShare")}</DialogTitle>
          <DialogDescription>
            {t("memo.visibilityDialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2.5 py-1">
          {options.map((option) => {
            const Icon = option.icon;
            const isSelected = memo.visibility === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isSelected}
                disabled={isUpdating}
                onClick={() => void handleSelectVisibility(option.value)}
                className={cn(
                  "relative flex items-center gap-3 rounded-xl border p-3 text-left transition-all duration-150 motion-safe:hover:-translate-y-px motion-safe:active:scale-[0.99]",
                  isSelected
                    ? "border-brand-500/50 bg-brand-50/50 shadow-xs ring-1 ring-brand-500/20 dark:border-brand-400/40 dark:bg-brand-500/10"
                    : "border-border/60 bg-card/40 hover:border-border hover:bg-card",
                )}
              >
                <div
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                    isSelected
                      ? "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300"
                      : "bg-muted/70 text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium text-foreground">
                    {option.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </div>
                {isSelected && (
                  <div className="flex shrink-0 items-center text-brand-600 dark:text-brand-400 motion-safe:animate-scale-in">
                    <CheckIcon className="size-4" />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {memo.visibility === "public" && (
          <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-muted/30 p-3 motion-safe:animate-fade motion-safe:duration-150">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">
                {t("share.publicLink")}
              </span>
              {isUpdating && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Spinner className="size-3" />
                  {t("share.generatingLink")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={shareUrl ?? ""}
                placeholder={t("share.generatingLink")}
                className="min-w-0 flex-1 rounded-lg border border-border/60 bg-background/80 px-2.5 py-1.5 font-mono text-xs text-foreground outline-none select-all transition-colors hover:border-border focus:border-brand-500"
              />
              <Button
                type="button"
                size="sm"
                variant={copied ? "secondary" : "outline"}
                onClick={() => void handleCopy()}
                className="shrink-0 gap-1.5"
                disabled={isUpdating}
              >
                {copied ? (
                  <>
                    <CheckIcon className="size-3.5 text-success-emphasis motion-safe:animate-scale-in" />
                    <span>{t("toast.linkCopied")}</span>
                  </>
                ) : (
                  <>
                    <CopyIcon className="size-3.5" />
                    <span>{t("share.copyLink")}</span>
                  </>
                )}
              </Button>
              {shareUrl && (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  title={t("share.openLink")}
                  aria-label={t("share.openLink")}
                  onClick={() => {
                    window.open(shareUrl, "_blank", "noopener,noreferrer");
                  }}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <ExternalLinkIcon className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
