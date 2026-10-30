import { ClipboardIcon, Link2Icon, UnlinkIcon } from "lucide-react";
import type { MemoContext } from "@/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TabsContent } from "@/components/ui/tabs";
import { useClipboard } from "@/hooks/use-clipboard";
import { useI18n } from "@/i18n";

export function SharingTab({
  context,
  sharePending,
  revokePending,
  onCreateShare,
  onRevoke,
}: {
  context: MemoContext;
  sharePending: boolean;
  revokePending: boolean;
  onCreateShare: () => void;
  onRevoke: (share: string) => void;
}) {
  const { t } = useI18n();
  const { copy } = useClipboard({
    successMessage: t("toast.copied"),
    errorMessage: t("toast.copyFailed"),
  });
  return (
    <TabsContent className="flex flex-col gap-3 pt-4" value="sharing">
      <div>
        <Button
          disabled={sharePending}
          size="sm"
          variant={context.shares.length > 0 ? "outline" : "default"}
          onClick={onCreateShare}
        >
          {sharePending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <Link2Icon data-icon="inline-start" />
          )}
          {t("detail.createShare")}
        </Button>
      </div>
      {context.shares.length === 0 && (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {t("detail.noShares")}
        </p>
      )}
      {context.shares.map((share) => {
        const url = `${globalThis.location.origin}/share/${share.token}`;
        return (
          <div
            className="flex items-center gap-1 rounded-lg border py-1.5 ps-3 pe-1.5"
            key={share.name}
          >
            <a
              className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
              rel="noopener"
              target="_blank"
              href={url}
            >
              {url}
            </a>
            <Button
              aria-label={t("common.copy")}
              size="icon-sm"
              variant="ghost"
              onClick={() => void copy(url)}
            >
              <ClipboardIcon />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    aria-label={t("detail.revokeShare")}
                    disabled={revokePending}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <UnlinkIcon />
                  </Button>
                }
              />
              <AlertDialogContent size="sm">
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("detail.revokeShareTitle")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("detail.revokeShareDescription")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel variant="ghost">
                    {t("common.cancel")}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => onRevoke(share.id)}
                  >
                    {t("detail.revokeShare")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        );
      })}
    </TabsContent>
  );
}
