import { useQuery } from "@tanstack/react-query";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { compareVersions } from "@/lib/version";

// Two states, two shapes. Up to date: one line + one link — most visits land
// here, so nothing more earns its place. Update available: a current → latest
// arrow with the release date, one primary action.
export function UpdateStatus() {
  const { locale, t } = useI18n();
  const appInfoQuery = useQuery({
    queryKey: ["app-info"],
    queryFn: getAppInfo,
    retry: false,
    staleTime: 30 * 60 * 1_000,
  });
  // Prefer the repository advertised by the deployment (`update_repository`);
  // the null key keeps the upstream default so self-hosted installs without a
  // configured repository behave exactly as before.
  const releaseQuery = useQuery({
    queryKey: ["latest-release", appInfoQuery.data?.update_repository ?? null],
    queryFn: () => getLatestRelease(appInfoQuery.data?.update_repository),
    retry: false,
    staleTime: 30 * 60 * 1_000,
  });

  const appInfo = appInfoQuery.data;
  const release = releaseQuery.data;
  const updateAvailable = Boolean(
    appInfo && release && compareVersions(release.version, appInfo.version) > 0,
  );
  const updateUrl = appInfo?.update_workflow_url ?? appInfo?.update_guide_url;
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
    <Dialog>
      <DialogTrigger asChild>
        <Button
          aria-label={t("update.title")}
          className="relative px-2"
          size="sm"
          title={t("update.title")}
          variant="ghost"
        >
          <RefreshCwIcon />
          {appInfo && (
            <span className="text-xs font-medium">v{appInfo.version}</span>
          )}
          {updateAvailable && (
            <span
              aria-hidden="true"
              className="absolute top-1 right-1 size-1.5 rounded-full bg-primary"
            />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2 pr-7">
            <DialogTitle>
              {updateAvailable && release
                ? t("update.availableTitle", { version: release.version })
                : t("update.title")}
            </DialogTitle>
            {updateAvailable && <Badge>{t("update.badge")}</Badge>}
          </div>
          <DialogDescription>
            {rangeLine ??
              versionLine ??
              (releaseQuery.isPending
                ? t("update.loading")
                : t("update.checkFailed"))}
          </DialogDescription>
        </DialogHeader>

        {updateAvailable && !appInfo?.update_workflow_url && (
          <p className="text-xs text-muted-foreground">
            {t("update.repositoryNotConfigured")}
          </p>
        )}

        <DialogFooter>
          {release && updateAvailable ? (
            <Button asChild variant="outline">
              <a href={release.url} rel="noreferrer" target="_blank">
                {t("update.releaseNotes")}
                <ExternalLinkIcon />
              </a>
            </Button>
          ) : null}
          {updateAvailable ? (
            <Button asChild disabled={!updateUrl}>
              <a
                href={updateUrl ?? appInfo?.update_guide_url}
                rel="noreferrer"
                target="_blank"
              >
                {t("update.guide")}
                <ExternalLinkIcon />
              </a>
            </Button>
          ) : release ? (
            <Button asChild variant="outline">
              <a href={release.url} rel="noreferrer" target="_blank">
                {t("update.releaseNotes")}
                <ExternalLinkIcon />
              </a>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
