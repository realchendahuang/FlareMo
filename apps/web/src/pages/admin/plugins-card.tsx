import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n";
import { PluginCardsManager } from "./plugins/plugin-cards-manager";
import { PluginListCard } from "./plugins/plugin-list-card";
import { PluginStoreCard } from "./plugins/plugin-store-card";
import { usePluginSettings } from "./plugins/use-plugin-settings";

/**
 * Owner-side plugin management: the plugin list (bundled + installed), the
 * store (browse directories, install/update/uninstall, upload a local
 * package), and per-card controls (order, default, visibility, options).
 *
 * The bundled registry compiles into the app; store packages live in this
 * instance's R2 and their manifests ride along in the settings record, which
 * is why card management can list them without extra fetches. Official
 * plugins default on, community/store plugins default off — enabling one here
 * is the only path that makes it visible to users.
 */
export function PluginsCard() {
  const { t } = useI18n();
  const state = usePluginSettings();
  const { settings } = state;

  if (!settings) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        {t("admin.plugins.loading")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PluginListCard
        busy={state.busy}
        plugins={state.plugins}
        pluginEnabled={state.pluginEnabled}
        togglePlugin={state.togglePlugin}
        uninstallMutation={state.uninstallMutation}
      >
        <PluginCardsManager
          busy={state.busy}
          cardRows={state.cardRows}
          locale={state.locale}
          moveCard={state.moveCard}
          setDefault={state.setDefault}
          setOption={state.setOption}
          toggleHidden={state.toggleHidden}
        />
      </PluginListCard>

      <PluginStoreCard
        busy={state.busy}
        installMutation={state.installMutation}
        locale={state.locale}
        storeEntries={state.storeEntries}
        storeQuery={state.storeQuery}
        storeSourceName={state.storeSourceName}
        uploadError={state.uploadError}
        uploadMutation={state.uploadMutation}
      />
    </div>
  );
}
