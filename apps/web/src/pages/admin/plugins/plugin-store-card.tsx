import {
  FileUpIcon,
  PackageIcon,
  RefreshCwIcon,
  StoreIcon,
} from "lucide-react";
import { useRef } from "react";
import type { PluginStoreEntry } from "@/api";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n";
import { SettingsSectionGroup } from "../../account/apple-settings-ui";
import { localized } from "./plugin-row";
import type { PluginSettingsState } from "./use-plugin-settings";

/**
 * The store card: every configured directory, its entries and the
 * install/update button, plus the local-package upload.
 */
export function PluginStoreCard({
  busy,
  locale,
  installMutation,
  uploadMutation,
  uploadError,
  storeQuery,
  storeEntries,
  storeSourceName,
}: {
  busy: boolean;
  locale: string;
  installMutation: PluginSettingsState["installMutation"];
  uploadMutation: PluginSettingsState["uploadMutation"];
  uploadError: string | null;
  storeQuery: PluginSettingsState["storeQuery"];
  storeEntries: PluginSettingsState["storeEntries"];
  storeSourceName: PluginSettingsState["storeSourceName"];
}) {
  const { t } = useI18n();
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) uploadMutation.mutate(file);
  };

  const installButtonFor = (entry: PluginStoreEntry) => {
    const updating = entry.installedVersion !== null;
    return (
      <Button
        disabled={busy}
        size="sm"
        type="button"
        variant={updating ? "outline" : "default"}
        onClick={() =>
          installMutation.mutate({ id: entry.id, sourceId: entry.sourceId })
        }
      >
        {installMutation.isPending &&
        installMutation.variables?.id === entry.id ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <PackageIcon data-icon="inline-start" />
        )}
        {updating
          ? t("admin.plugins.updateTo", { version: entry.version })
          : t("admin.plugins.install")}
      </Button>
    );
  };

  return (
    <SettingsSectionGroup
      footer={t("admin.plugins.storeDescription")}
      title={
        <div className="flex items-center justify-between gap-3">
          <span>{t("admin.plugins.store")}</span>
          <div className="flex items-center gap-1">
            <input
              accept=".zip,application/zip"
              className="hidden"
              ref={uploadInputRef}
              type="file"
              onChange={handleUpload}
            />
            <Button
              className="h-7 text-xs"
              disabled={busy}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => uploadInputRef.current?.click()}
            >
              {uploadMutation.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <FileUpIcon data-icon="inline-start" />
              )}
              {t("admin.plugins.upload")}
            </Button>
            <Button
              aria-label={t("admin.plugins.refresh")}
              disabled={storeQuery.isFetching}
              size="icon-sm"
              type="button"
              variant="ghost"
              onClick={() => void storeQuery.refetch()}
            >
              <RefreshCwIcon
                className={storeQuery.isFetching ? "animate-spin" : undefined}
              />
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-3.5">
        {uploadError && <Alert variant="destructive">{uploadError}</Alert>}
        <div className="flex flex-wrap items-center gap-2">
          <StoreIcon className="size-4 shrink-0 text-muted-foreground" />
          {(storeQuery.data?.sources ?? []).map((source) => (
            <Badge
              key={source.id}
              title={source.url}
              variant={source.error ? "destructive" : "secondary"}
            >
              {source.name}
              {source.error ? ` · ${source.error}` : ""}
            </Badge>
          ))}
        </div>
        {storeQuery.isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            {t("admin.plugins.loading")}
          </div>
        )}
        {storeQuery.isError && (
          <p className="text-sm text-muted-foreground">
            {t("admin.plugins.storeUnavailable")}
          </p>
        )}
        {storeEntries.map((entry) => (
          <div
            className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
            key={`${entry.sourceId}:${entry.id}`}
          >
            <div className="flex min-w-0 items-center gap-3">
              {entry.preview ? (
                <img
                  alt=""
                  className="size-10 shrink-0 rounded border object-cover"
                  loading="lazy"
                  src={entry.preview}
                />
              ) : (
                <div className="flex size-10 shrink-0 items-center justify-center rounded border bg-muted/40">
                  <PackageIcon className="size-4 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">
                    {localized(entry.name, locale, entry.id)}
                  </p>
                  <Badge variant="secondary">
                    {t(
                      entry.tier === "official"
                        ? "admin.plugins.tierOfficial"
                        : "admin.plugins.tierCommunity",
                    )}
                  </Badge>
                  {entry.installedVersion && (
                    <Badge variant="outline">
                      {t("admin.plugins.installedBadge", {
                        version: entry.installedVersion,
                      })}
                    </Badge>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {localized(entry.description, locale, "") ||
                    entry.author?.name ||
                    storeSourceName(entry.sourceId)}
                </p>
                {(entry.contributes?.shareCardTemplates ?? []).some(
                  (card) => card.preview,
                ) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(entry.contributes?.shareCardTemplates ?? [])
                      .filter((card) => card.preview)
                      .slice(0, 5)
                      .map((card) => (
                        <img
                          alt={localized(card.name, locale, card.id)}
                          className="h-14 w-auto rounded border object-cover"
                          key={card.id}
                          loading="lazy"
                          src={card.preview ?? ""}
                          title={localized(card.name, locale, card.id)}
                        />
                      ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {installButtonFor(entry)}
            </div>
          </div>
        ))}
        {storeQuery.data && storeEntries.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("admin.plugins.storeEmpty")}
          </p>
        )}
      </div>
    </SettingsSectionGroup>
  );
}
