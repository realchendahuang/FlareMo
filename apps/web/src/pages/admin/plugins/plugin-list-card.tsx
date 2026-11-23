import { Trash2Icon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { SettingsSectionGroup } from "@/components/settings-section";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n";
import type { PluginRow } from "./plugin-row";
import type { PluginSettingsState } from "./use-plugin-settings";

/**
 * The plugin list group: every bundled and installed plugin with its source
 * badge and on/off switch. The card-manager group renders right after it,
 * so it arrives as `children`.
 */
export function PluginListCard({
  plugins,
  busy,
  pluginEnabled,
  togglePlugin,
  uninstallMutation,
  children,
}: {
  plugins: PluginRow[];
  busy: boolean;
  pluginEnabled: (row: PluginRow) => boolean;
  togglePlugin: (row: PluginRow, on: boolean) => void;
  uninstallMutation: PluginSettingsState["uninstallMutation"];
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [confirmingUninstall, setConfirmingUninstall] =
    useState<PluginRow | null>(null);

  return (
    <>
      <SettingsSectionGroup
        title={t("admin.plugins.plugins")}
        footer={t("admin.plugins.description")}
      >
        {plugins.map((row) => (
          <div
            className="flex items-center justify-between gap-3 px-3.5 py-2.5 transition-colors hover:bg-accent/20"
            key={row.id}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium">{row.name}</p>
                <Badge variant="secondary">
                  {t(
                    row.source === "installed"
                      ? "admin.plugins.tierStore"
                      : row.tier === "official"
                        ? "admin.plugins.tierOfficial"
                        : "admin.plugins.tierCommunity",
                  )}
                </Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {t("admin.plugins.cardCount", { count: row.cardCount })} · v
                {row.version}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {row.source === "installed" && (
                <Button
                  aria-label={t("admin.plugins.uninstall")}
                  className="text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirmingUninstall(row)}
                >
                  <Trash2Icon />
                </Button>
              )}
              <Switch
                aria-label={row.name}
                checked={pluginEnabled(row)}
                disabled={busy}
                onCheckedChange={(checked) => togglePlugin(row, checked)}
              />
            </div>
          </div>
        ))}
      </SettingsSectionGroup>

      <AlertDialog
        open={confirmingUninstall !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmingUninstall(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.plugins.uninstall")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.plugins.uninstallConfirm", {
                name: confirmingUninstall?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                const target = confirmingUninstall;
                setConfirmingUninstall(null);
                if (target) uninstallMutation.mutate(target.id);
              }}
            >
              {t("admin.plugins.uninstall")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {children}
    </>
  );
}
