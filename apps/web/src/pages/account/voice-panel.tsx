import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MicIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  deleteVoiceSettings,
  getVoiceSettings,
  saveVoiceSettings,
  testVoiceSettings,
  type VoiceSettings,
} from "@/api";
import { QueryErrorState } from "@/components/query-error-state";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/i18n";
import type { TranslationKey } from "@/i18n/key";
import { queryKeys } from "@/lib/query-keys";
import { SettingsRow, SettingsSectionGroup } from "./apple-settings-ui";

type CredentialField =
  | "appId"
  | "secretId"
  | "secretKey"
  | "apiKey"
  | "volcAppId"
  | "volcAccessToken"
  | "volcBoostingTable"
  | "volcCorrectTable"
  | "baseUrl";

const TENCENT_FIELDS: CredentialField[] = ["appId", "secretId", "secretKey"];
const VOLCENGINE_FIELDS: CredentialField[] = [
  "volcAppId",
  "volcAccessToken",
  "volcBoostingTable",
  "volcCorrectTable",
];
const MINIMAX_FIELDS: CredentialField[] = ["apiKey", "baseUrl"];
const PROVIDERS = ["tencent", "dashscope", "volcengine", "minimax"] as const;
type Provider = (typeof PROVIDERS)[number];

export function VoicePanel() {
  const cache = useQueryClient();
  const { t } = useI18n();
  const mounted = useRef(false);
  const [config, setConfig] = useState<VoiceSettings | null>(null);
  const [provider, setProvider] = useState<Provider>("tencent");
  const [model, setModel] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [fields, setFields] = useState({
    appId: "",
    secretId: "",
    secretKey: "",
    apiKey: "",
    volcAppId: "",
    volcAccessToken: "",
    volcBoostingTable: "",
    volcCorrectTable: "",
    baseUrl: "",
  });
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "save" | "test" | "delete" | "toggle" | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["voice-settings"],
    queryFn: getVoiceSettings,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const value = settingsQuery.data;
    if (!value) return;
    setConfig(value);
    setProvider(value.provider ?? "tencent");
    setModel(value.model);
    setEnabled(value.enabled);
  }, [settingsQuery.data]);

  const envManaged = config?.source === "environment";
  const editingDisabled =
    busy || envManaged || !config || (config.unreadable ?? false);

  async function run(
    action: "save" | "test" | "delete" | "toggle",
    task: () => Promise<unknown>,
    success: string,
  ) {
    setBusy(true);
    setPendingAction(action);
    try {
      await task();
      if (!mounted.current) return;
      setFields({
        appId: "",
        secretId: "",
        secretKey: "",
        apiKey: "",
        volcAppId: "",
        volcAccessToken: "",
        volcBoostingTable: "",
        volcCorrectTable: "",
        baseUrl: "",
      });
      const value = await cache.fetchQuery({
        queryKey: ["voice-settings"],
        queryFn: getVoiceSettings,
        staleTime: 0,
      });
      if (!mounted.current) return;
      setConfig(value);
      setEnabled(value.enabled);
      setProvider(value.provider ?? "tencent");
      setModel(value.model);
      await cache.invalidateQueries({ queryKey: queryKeys.captureStatus.all });
      toast.success(success);
      if (action === "save") {
        setConfigDialogOpen(false);
      }
    } catch {
      if (!mounted.current) return;
      toast.error(t("voiceSettings.error"));
    } finally {
      if (mounted.current) {
        setBusy(false);
        setPendingAction(null);
      }
    }
  }

  const handleToggleEnabled = (nextEnabled: boolean) => {
    setEnabled(nextEnabled);
    if (!config) return;
    void run(
      "toggle",
      () =>
        saveVoiceSettings({
          revision: config.revision,
          enabled: nextEnabled,
          credentials: {
            provider,
            model,
          },
        }),
      nextEnabled ? t("voiceSettings.saved") : t("voiceSettings.saved"),
    );
  };

  const previewFor = (field: CredentialField) => {
    if (provider !== (config?.provider ?? provider)) return "";
    const wireField = field === "baseUrl" ? ("minimaxBaseUrl" as const) : field;
    return config?.previews?.[wireField] ?? "";
  };

  const fieldLabel = (field: CredentialField) => {
    if (provider === "minimax")
      return field === "apiKey"
        ? t("voiceSettings.minimaxApiKey")
        : t("voiceSettings.minimaxBaseUrl");
    return t(`voiceSettings.${field}` as TranslationKey);
  };

  const providerNames: Record<Provider, string> = {
    tencent: t("voiceSettings.tencent"),
    dashscope: "DashScope",
    volcengine: t("voiceSettings.volcengine"),
    minimax: t("voiceSettings.minimax"),
  };

  if (!config && settingsQuery.isPending) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    );
  }
  // Without the stored settings the form would show defaults, so a failed
  // load gets a retry instead of an editable-looking but wrong panel.
  if (!config && settingsQuery.isError) {
    return (
      <QueryErrorState
        isRetrying={settingsQuery.isFetching}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <SettingsSectionGroup
        title={t("voiceSettings.title")}
        footer={
          envManaged
            ? t("voiceSettings.envManaged")
            : !config?.canEncrypt
              ? t("voiceSettings.plainStore")
              : undefined
        }
      >
        <SettingsRow
          icon={MicIcon}
          label={t("voiceSettings.enabled")}
          action={
            <Switch
              checked={enabled}
              disabled={editingDisabled}
              onCheckedChange={handleToggleEnabled}
            />
          }
        />
        <SettingsRow
          label={t("voiceSettings.provider")}
          value={providerNames[provider] ?? provider}
          chevron={!editingDisabled}
          onClick={
            editingDisabled ? undefined : () => setConfigDialogOpen(true)
          }
        />
        <SettingsRow
          label={t("voiceSettings.model")}
          value={model || "—"}
          chevron={!editingDisabled}
          onClick={
            editingDisabled ? undefined : () => setConfigDialogOpen(true)
          }
        />
        <SettingsRow
          label={t("voiceSettings.credentials")}
          value={
            envManaged
              ? t("settings.status.envManaged")
              : config?.configured
                ? t("settings.status.configured")
                : t("settings.status.notConfigured")
          }
          chevron={!editingDisabled}
          onClick={
            editingDisabled ? undefined : () => setConfigDialogOpen(true)
          }
        />
      </SettingsSectionGroup>

      <SettingsSectionGroup title={t("common.actions")}>
        <SettingsRow
          label={t("voiceSettings.test")}
          description={t("voiceSettings.testWarning")}
          action={
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !config?.enabled || !config?.configured}
              onClick={() =>
                void run(
                  "test",
                  testVoiceSettings,
                  t("voiceSettings.testSuccess"),
                )
              }
            >
              {pendingAction === "test" && <Spinner data-icon="inline-start" />}
              {t("voiceSettings.testAction")}
            </Button>
          }
        />
        {config?.revision && !envManaged && (
          <SettingsRow
            destructive
            label={t("voiceSettings.clearConfig")}
            onClick={() => setConfirmDelete(true)}
          />
        )}
      </SettingsSectionGroup>

      {/* Progressive Disclosure: Configure Voice Dialog */}
      <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("voiceSettings.configure")}</DialogTitle>
            <DialogDescription>
              {t("voiceSettings.description")}
            </DialogDescription>
          </DialogHeader>

          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!config) return;
              void run(
                "save",
                () => {
                  const { baseUrl, ...rest } = fields;
                  return saveVoiceSettings({
                    revision: config.revision,
                    enabled,
                    credentials: {
                      provider,
                      model,
                      ...rest,
                      minimaxBaseUrl: baseUrl,
                    },
                  });
                },
                t("voiceSettings.saved"),
              );
            }}
          >
            <div className="flex flex-col gap-1.5 text-sm font-medium">
              <span>{t("voiceSettings.provider")}</span>
              <ToggleGroup
                variant="outline"
                value={provider ? [provider] : []}
                disabled={editingDisabled}
                onValueChange={(values) => {
                  if (values.length === 0) return;
                  setProvider(values[values.length - 1] as Provider);
                  setModel("");
                  setFields({
                    appId: "",
                    secretId: "",
                    secretKey: "",
                    apiKey: "",
                    volcAppId: "",
                    volcAccessToken: "",
                    volcBoostingTable: "",
                    volcCorrectTable: "",
                    baseUrl: "",
                  });
                }}
              >
                <ToggleGroupItem value="tencent">
                  {t("voiceSettings.tencent")}
                </ToggleGroupItem>
                <ToggleGroupItem value="dashscope">DashScope</ToggleGroupItem>
                <ToggleGroupItem value="volcengine">
                  {t("voiceSettings.volcengine")}
                </ToggleGroupItem>
                <ToggleGroupItem value="minimax">
                  {t("voiceSettings.minimax")}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="voice-model"
            >
              {t("voiceSettings.model")}
              <Input
                autoComplete="off"
                disabled={editingDisabled}
                id="voice-model"
                value={model}
                placeholder="16k_zh / paraformer-realtime-v2"
                onChange={(event) => setModel(event.target.value)}
              />
            </label>

            {(provider === "tencent"
              ? TENCENT_FIELDS
              : provider === "volcengine"
                ? VOLCENGINE_FIELDS
                : provider === "minimax"
                  ? MINIMAX_FIELDS
                  : (["apiKey"] as const)
            ).map((field) => (
              <label
                className="flex flex-col gap-1.5 text-sm font-medium"
                key={field}
                htmlFor={`voice-${field}`}
              >
                {fieldLabel(field)}
                <Input
                  autoComplete={field === "baseUrl" ? "off" : "new-password"}
                  disabled={editingDisabled}
                  id={`voice-${field}`}
                  placeholder={previewFor(field)}
                  type={field === "baseUrl" ? "text" : "password"}
                  value={fields[field]}
                  onChange={(event) =>
                    setFields({ ...fields, [field]: event.target.value })
                  }
                />
              </label>
            ))}

            <DialogFooter className="mt-2">
              <Button
                variant="outline"
                type="button"
                onClick={() => setConfigDialogOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button disabled={editingDisabled} type="submit">
                {pendingAction === "save" && (
                  <Spinner data-icon="inline-start" />
                )}
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog onOpenChange={setConfirmDelete} open={confirmDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("voiceSettings.clearConfig")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("voiceSettings.clearConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (config)
                  void run(
                    "delete",
                    () => deleteVoiceSettings(config.revision),
                    t("voiceSettings.deleted"),
                  );
              }}
            >
              {t("voiceSettings.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
