import {
  listBundledPluginsSorted,
  resolveOptionValues,
  type ShareCardOptionSpec,
  type ShareCardOptionValue,
} from "@flaremo/plugins";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  getAdminPluginSettings,
  getPluginStore,
  installPlugin,
  type PluginSettings,
  uninstallPlugin,
  updateAdminPluginSettings,
  uploadPluginPackage,
} from "@/api";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { allCardViews, type ShareCardView } from "@/lib/plugin-cards";
import { queryKeys } from "@/lib/query-keys";
import { localized, type PluginRow } from "./plugin-row";

/**
 * One render-ready row of the card manager: the card plus the per-instance
 * state the JSX reads (reachability, visibility, order, resolved options).
 */
export type PluginCardRow = {
  id: string;
  name: Record<string, string>;
  kind: ShareCardView["kind"];
  pluginName: string;
  reachable: boolean;
  hidden: boolean;
  isDefault: boolean;
  options: Record<string, ShareCardOptionValue>;
  optionSpecs: ShareCardOptionSpec[];
  visibleIndex: number;
  visibleCount: number;
};

/**
 * Every query, mutation and derived value behind the owner's plugin cards.
 * The three card components are pure views over this state; the only place
 * that touches the plugin registry and the share-card helpers.
 */
export function usePluginSettings() {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const [uploadError, setUploadError] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: queryKeys.adminPlugins,
    queryFn: getAdminPluginSettings,
    retry: false,
  });
  const storeQuery = useQuery({
    queryKey: queryKeys.adminPluginStore,
    queryFn: getPluginStore,
    retry: false,
    staleTime: 60_000,
  });

  const settings = settingsQuery.data ?? null;

  const plugins: PluginRow[] = useMemo(() => {
    const bundled: PluginRow[] = listBundledPluginsSorted().map((plugin) => ({
      id: plugin.manifest.id,
      name: localized(plugin.manifest.name, locale, plugin.manifest.id),
      version: plugin.manifest.version,
      tier: plugin.tier,
      source: "bundled",
      cardCount: plugin.cards.length,
    }));
    const installed: PluginRow[] = (settings?.installed ?? []).map((record) => {
      const cards = allCardViews(settings).filter(
        (card) => card.pluginId === record.id && card.source === "installed",
      );
      const name = (record.manifest.name ?? {}) as Record<string, string>;
      return {
        id: record.id,
        name: localized(name, locale, record.id),
        version: record.version,
        tier: "community" as const,
        source: "installed" as const,
        cardCount: cards.length,
      };
    });
    // An installed package could reuse a bundled plugin's id; the installed
    // row wins so the version shown matches what the assets serve.
    const seen = new Set<string>();
    return [...installed, ...bundled].filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  }, [locale, settings]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminPlugins });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.adminPluginStore,
    });
    void queryClient.invalidateQueries({ queryKey: queryKeys.pluginSettings });
  };

  const saveMutation = useMutation({
    mutationFn: (
      next: Pick<
        PluginSettings,
        "enabledPlugins" | "disabledPlugins" | "cards"
      >,
    ) =>
      updateAdminPluginSettings({
        enabledPlugins: next.enabledPlugins,
        disabledPlugins: next.disabledPlugins,
        cards: {
          order: next.cards.order,
          hidden: next.cards.hidden,
          default: next.cards.default,
          options: next.cards.options,
        },
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["admin-plugins"], saved);
      invalidate();
      toast.success(t("admin.plugins.saved"));
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("admin.plugins.failed"))),
  });

  const installMutation = useMutation({
    mutationFn: ({ id, sourceId }: { id: string; sourceId: string }) =>
      installPlugin(id, sourceId),
    onSuccess: () => {
      invalidate();
      toast.success(t("admin.plugins.installed"));
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("admin.plugins.installFailed"))),
  });

  const uninstallMutation = useMutation({
    mutationFn: (id: string) => uninstallPlugin(id),
    onSuccess: () => {
      invalidate();
      toast.success(t("admin.plugins.uninstalled"));
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("admin.plugins.uninstallFailed"))),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadPluginPackage(file),
    onSuccess: (result) => {
      setUploadError(null);
      invalidate();
      toast.success(t("admin.plugins.uploaded", { name: result.installed.id }));
    },
    onError: (error) => {
      const message = errorMessage(error, t("admin.plugins.uploadFailed"));
      setUploadError(message);
      toast.error(message);
    },
  });

  // The cards that consume the settings-derived state below only render once
  // the record has loaded (the page shows a loading card until then), so the
  // optional reads here are never taken on a live path.
  const enabledSet = new Set(settings?.enabledPlugins ?? []);
  const disabledSet = new Set(settings?.disabledPlugins ?? []);
  const hiddenSet = new Set(settings?.cards.hidden ?? []);
  const busy =
    saveMutation.isPending ||
    installMutation.isPending ||
    uninstallMutation.isPending ||
    uploadMutation.isPending;

  const pluginEnabled = (row: PluginRow) =>
    enabledSet.has(row.id)
      ? true
      : disabledSet.has(row.id)
        ? false
        : row.source === "bundled" && row.tier === "official";

  const togglePlugin = (row: PluginRow, on: boolean) => {
    if (!settings) return;
    const next = {
      enabledPlugins: settings.enabledPlugins.filter((id) => id !== row.id),
      disabledPlugins: settings.disabledPlugins.filter((id) => id !== row.id),
      cards: settings.cards,
    };
    if (on) next.enabledPlugins.push(row.id);
    else next.disabledPlugins.push(row.id);
    saveMutation.mutate(next);
  };

  const cards = allCardViews(settings);
  const orderedCards = (() => {
    const orderIndex = new Map(
      (settings?.cards.order ?? []).map((id, index) => [id, index] as const),
    );
    const registryIndex = new Map(
      cards.map((card, index) => [card.id, index] as const),
    );
    return [...cards].sort((a, b) => {
      const aOrder = orderIndex.get(a.id);
      const bOrder = orderIndex.get(b.id);
      if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
      if (aOrder !== undefined) return -1;
      if (bOrder !== undefined) return 1;
      return (registryIndex.get(a.id) ?? 0) - (registryIndex.get(b.id) ?? 0);
    });
  })();

  const moveCard = (cardId: string, direction: -1 | 1) => {
    if (!settings) return;
    const visibleIds = orderedCards
      .filter((entry) => !hiddenSet.has(entry.id))
      .map((entry) => entry.id);
    const order = settings.cards.order.filter((id) => visibleIds.includes(id));
    const base = [...order, ...visibleIds.filter((id) => !order.includes(id))];
    const index = base.indexOf(cardId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= base.length) return;
    const nextBase = [...base];
    const [moved] = nextBase.splice(index, 1);
    nextBase.splice(target, 0, moved as string);
    saveMutation.mutate({
      ...settings,
      cards: { ...settings.cards, order: nextBase },
    });
  };

  const toggleHidden = (cardId: string) => {
    if (!settings) return;
    const hidden = hiddenSet.has(cardId)
      ? settings.cards.hidden.filter((id) => id !== cardId)
      : [...settings.cards.hidden, cardId];
    const clearingDefault =
      settings.cards.default === cardId && hidden.includes(cardId);
    saveMutation.mutate({
      ...settings,
      cards: {
        ...settings.cards,
        hidden,
        default: clearingDefault ? null : settings.cards.default,
      },
    });
  };

  const setDefault = (cardId: string) => {
    if (!settings) return;
    saveMutation.mutate({
      ...settings,
      cards: {
        ...settings.cards,
        default: settings.cards.default === cardId ? null : cardId,
      },
    });
  };

  const setOption = (
    cardId: string,
    key: string,
    value: ShareCardOptionValue,
  ) => {
    if (!settings) return;
    const cardOptions = { ...(settings.cards.options[cardId] ?? {}) };
    cardOptions[key] = value;
    saveMutation.mutate({
      ...settings,
      cards: {
        ...settings.cards,
        options: { ...settings.cards.options, [cardId]: cardOptions },
      },
    });
  };

  const storeEntries = storeQuery.data?.entries ?? [];
  const storeSourceName = (sourceId: string) =>
    storeQuery.data?.sources.find((source) => source.id === sourceId)?.name ??
    sourceId;

  const cardRows: PluginCardRow[] = orderedCards.map((card) => {
    const pluginRow = plugins.find((row) => row.id === card.pluginId);
    const visibleEntries = orderedCards.filter(
      (candidate) => !hiddenSet.has(candidate.id),
    );
    return {
      id: card.id,
      name: card.name,
      kind: card.kind,
      pluginName: pluginRow?.name ?? card.pluginId,
      reachable: pluginRow ? pluginEnabled(pluginRow) : false,
      hidden: hiddenSet.has(card.id),
      isDefault: settings?.cards.default === card.id,
      options: resolveOptionValues(
        card.options,
        settings?.cards.options[card.id],
      ),
      optionSpecs: card.options ?? [],
      visibleIndex: visibleEntries.findIndex(
        (candidate) => candidate.id === card.id,
      ),
      visibleCount: visibleEntries.length,
    };
  });

  return {
    locale,
    settings,
    plugins,
    busy,
    pluginEnabled,
    togglePlugin,
    installMutation,
    uninstallMutation,
    uploadMutation,
    uploadError,
    storeQuery,
    storeEntries,
    storeSourceName,
    cardRows,
    moveCard,
    toggleHidden,
    setDefault,
    setOption,
  };
}

export type PluginSettingsState = ReturnType<typeof usePluginSettings>;
