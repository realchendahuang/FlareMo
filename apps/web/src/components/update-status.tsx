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

export function UpdateStatus() {
  const { locale, t } = useI18n();
  const appInfoQuery = useQuery({
    queryKey: ["app-info"],
    queryFn: getAppInfo,
    retry: false,
    staleTime: 30 * 60 * 1_000,
  });
  const releaseQuery = useQuery({
    queryKey: ["latest-release"],
    queryFn: getLatestRelease,
    retry: false,
    staleTime: 30 * 60 * 1_000,
  });

  const appInfo = appInfoQuery.data;
  const release = releaseQuery.data;
  const updateAvailable = Boolean(
    appInfo && release && compareVersions(release.version, appInfo.version) > 0,
  );
  const updateUrl = appInfo?.update_workflow_url ?? appInfo?.update_guide_url;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          aria-label={t("update.open")}
          className="relative px-2"
          size="sm"
          title={t("update.open")}
          variant="ghost"
        >
          <RefreshCwIcon />
          <span className="text-xs font-medium">
            {appInfo ? `v${appInfo.version}` : t("update.version")}
          </span>
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
            <DialogTitle>{t("update.title")}</DialogTitle>
            {updateAvailable && <Badge>{t("update.available")}</Badge>}
          </div>
          <DialogDescription>
            {updateAvailable
              ? t("update.availableDescription")
              : t("update.currentDescription")}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg bg-muted/60 p-3 text-sm">
          <dt className="text-muted-foreground">{t("update.current")}</dt>
          <dd className="font-medium">
            {appInfo ? `v${appInfo.version}` : t("common.loading")}
          </dd>
          <dt className="text-muted-foreground">{t("update.latest")}</dt>
          <dd className="font-medium">
            {release ? `v${release.version}` : t("update.unavailable")}
          </dd>
          {release?.published_at && (
            <>
              <dt className="text-muted-foreground">{t("update.published")}</dt>
              <dd>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                }).format(new Date(release.published_at))}
              </dd>
            </>
          )}
        </dl>

        {!appInfo?.update_workflow_url && (
          <p className="text-xs text-muted-foreground">
            {t("update.repositoryNotConfigured")}
          </p>
        )}

        <DialogFooter>
          {release && (
            <Button asChild variant="outline">
              <a href={release.url} rel="noreferrer" target="_blank">
                {t("update.releaseNotes")}
                <ExternalLinkIcon />
              </a>
            </Button>
          )}
          {updateUrl && (
            <Button asChild>
              <a href={updateUrl} rel="noreferrer" target="_blank">
                {appInfo?.update_workflow_url
                  ? t("update.goToUpdate")
                  : t("update.guide")}
                <ExternalLinkIcon />
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
