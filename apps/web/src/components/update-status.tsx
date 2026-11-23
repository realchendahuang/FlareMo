import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpCircleIcon,
  CircleCheckIcon,
  ExternalLinkIcon,
} from "lucide-react";
import { getAppInfo, getLatestRelease } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { compareVersions } from "@/lib/version";

// Deployed version vs latest release. Shared by the user-menu entry (version
// text + update dot) and the update dialog.
export function useUpdateStatus() {
  const appInfoQuery = useQuery({
    queryKey: queryKeys.appInfo,
    queryFn: getAppInfo,
    retry: false,
    staleTime: 30 * 60 * 1_000,
  });
  // Prefer the repository advertised by the deployment (`update_repository`);
  // the null key keeps the upstream default so self-hosted installs without a
  // configured repository behave exactly as before. Gated on app-info so the
  // key doesn't flip mid-flight and hit GitHub twice on every cold boot.
  const releaseQuery = useQuery({
    queryKey: queryKeys.latestRelease(
      appInfoQuery.data?.update_repository ?? null,
    ),
    queryFn: () => getLatestRelease(appInfoQuery.data?.update_repository),
    enabled: appInfoQuery.isSuccess,
    retry: false,
    staleTime: 30 * 60 * 1_000,
  });

  const appInfo = appInfoQuery.data;
  const release = releaseQuery.data;
  const updateAvailable = Boolean(
    appInfo && release && compareVersions(release.version, appInfo.version) > 0,
  );
  const updateUrl = appInfo?.update_workflow_url ?? appInfo?.update_guide_url;

  return {
    appInfo,
    release,
    updateAvailable,
    updateUrl,
    pending: releaseQuery.isPending,
  };
}

// Two states, two shapes. Up to date: check icon + one line + one link — most
// visits land here, so nothing more earns its place. Update available: a
// current → latest arrow with the release date, one primary action.
export function UpdateStatusDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { locale, t } = useI18n();
  const { appInfo, release, updateAvailable, updateUrl, pending } =
    useUpdateStatus();
  const published = release?.published_at
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
        new Date(release.published_at),
      )
    : null;

  const versionLine = appInfo
    ? published
      ? t("update.versionLine", { current: appInfo.version, published })
      : t("update.versionLineNoDate", { current: appInfo.version })
    : null;
  const rangeLine =
    appInfo && release
      ? published
        ? t("update.rangeLine", {
            current: appInfo.version,
            latest: release.version,
            published,
          })
        : t("update.rangeLineNoDate", {
            current: appInfo.version,
            latest: release.version,
          })
      : null;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3 pr-7">
            {appInfo && release && (
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                  updateAvailable
                    ? "bg-primary/10 text-primary"
                    : "bg-success/10 text-success",
                )}
              >
                {updateAvailable ? (
                  <ArrowUpCircleIcon className="size-4" />
                ) : (
                  <CircleCheckIcon className="size-4" />
                )}
              </span>
            )}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <DialogTitle>
                  {updateAvailable && release
                    ? t("update.availableTitle", { version: release.version })
                    : t("update.title")}
                </DialogTitle>
                {updateAvailable && <Badge>{t("update.badge")}</Badge>}
              </div>
              <DialogDescription>
                {(updateAvailable ? rangeLine : versionLine) ??
                  (pending ? t("update.loading") : t("update.checkFailed"))}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {updateAvailable && !appInfo?.update_workflow_url && (
          <p className="text-xs text-muted-foreground">
            {t("update.repositoryNotConfigured")}
          </p>
        )}

        <DialogFooter>
          {release && updateAvailable ? (
            <Button
              render={<a href={release.url} rel="noreferrer" target="_blank" />}
              variant="outline"
            >
              {t("update.releaseNotes")}
              <ExternalLinkIcon />
            </Button>
          ) : null}
          {updateAvailable ? (
            <Button
              render={
                <a
                  href={updateUrl ?? appInfo?.update_guide_url}
                  rel="noreferrer"
                  target="_blank"
                />
              }
              disabled={!updateUrl}
            >
              {t("update.guide")}
              <ExternalLinkIcon />
            </Button>
          ) : release ? (
            <Button
              render={<a href={release.url} rel="noreferrer" target="_blank" />}
              variant="outline"
            >
              {t("update.releaseNotes")}
              <ExternalLinkIcon />
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
