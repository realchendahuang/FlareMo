import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MailIcon, ShieldCheckIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  deleteEmailSettings,
  deleteOauthSettings,
  type EmailSettings,
  getEmailSettings,
  getOauthSettings,
  type OauthSettings,
  saveEmailSettings,
  saveOauthSettings,
  testEmailSettings,
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
import { PasswordInput } from "@/components/ui/password-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { SettingsRow, SettingsSectionGroup } from "./apple-settings-ui";

export function EmailSettingsCard() {
  const { t } = useI18n();
  const cache = useQueryClient();
  const [config, setConfig] = useState<EmailSettings | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [fields, setFields] = useState({ apiKey: "", from: "", fromName: "" });
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "save" | "test" | "delete" | "toggle" | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["email-settings"],
    queryFn: getEmailSettings,
  });

  useEffect(() => {
    const value = settingsQuery.data;
    if (!value) return;
    setConfig(value);
    setEnabled(value.enabled);
  }, [settingsQuery.data]);

  const envManaged = config?.source === "environment";
  const emailEditingDisabled =
    busy || envManaged || !config || config.unreadable;

  async function run(
    action: "save" | "test" | "delete" | "toggle",
    task: () => Promise<unknown>,
    successKey: Parameters<ReturnType<typeof useI18n>["t"]>[0],
  ) {
    setBusy(true);
    setPendingAction(action);
    try {
      await task();
      const value = await cache.fetchQuery({
        queryKey: ["email-settings"],
        queryFn: getEmailSettings,
        staleTime: 0,
      });
      setConfig(value);
      setEnabled(value.enabled);
      setFields({ apiKey: "", from: "", fromName: "" });
      toast.success(t(successKey));
      if (action === "save") setDialogOpen(false);
    } catch (error) {
      toast.error(errorMessage(error, t("admin.integrations.emailError")));
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  }

  const handleToggle = (nextEnabled: boolean) => {
    setEnabled(nextEnabled);
    if (!config) return;
    void run(
      "toggle",
      () =>
        saveEmailSettings({
          revision: config.revision,
          enabled: nextEnabled,
          credentials: {
            apiKey: "",
            from: "",
            fromName: "",
          },
        }),
      "admin.integrations.saved",
    );
  };

  if (!config && settingsQuery.isPending) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    );
  }

  // A failed load must not fall through to a form seeded with defaults.
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
        title={t("admin.integrations.emailTitle")}
        footer={
          envManaged
            ? t("admin.integrations.emailEnvManaged")
            : config?.provider === "cloudflare"
              ? t("admin.integrations.emailCloudflareNote")
              : undefined
        }
      >
        <SettingsRow
          icon={MailIcon}
          label={t("admin.integrations.emailTitle")}
          description={
            config?.configured
              ? t("admin.integrations.emailConfigured", {
                  provider: config.provider,
                })
              : t("admin.integrations.emailUnconfigured")
          }
          action={
            <Switch
              checked={enabled}
              disabled={emailEditingDisabled}
              onCheckedChange={handleToggle}
            />
          }
        />
        {config?.provider !== "cloudflare" && (
          <SettingsRow
            label={t("admin.integrations.emailConfigure")}
            value={
              envManaged
                ? t("settings.status.envManaged")
                : config?.configured
                  ? config.previews?.from || t("settings.status.configured")
                  : t("settings.status.notConfigured")
            }
            chevron={!emailEditingDisabled}
            onClick={
              emailEditingDisabled ? undefined : () => setDialogOpen(true)
            }
          />
        )}
      </SettingsSectionGroup>

      <SettingsSectionGroup title={t("common.actions")}>
        <SettingsRow
          label={t("admin.integrations.testEmail")}
          action={
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !config?.configured}
              onClick={() =>
                void run(
                  "test",
                  testEmailSettings,
                  "admin.integrations.testSuccess",
                )
              }
            >
              {pendingAction === "test" && <Spinner data-icon="inline-start" />}
              {t("admin.integrations.testEmail")}
            </Button>
          }
        />
        {config?.revision && !envManaged && (
          <SettingsRow
            destructive
            label={t("admin.integrations.delete")}
            onClick={() => setConfirmDelete(true)}
          />
        )}
      </SettingsSectionGroup>

      {/* Progressive Disclosure: Email Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("admin.integrations.emailConfigure")}</DialogTitle>
            <DialogDescription>
              {t("admin.integrations.emailDescription")}
            </DialogDescription>
          </DialogHeader>

          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!config) return;
              void run(
                "save",
                () =>
                  saveEmailSettings({
                    revision: config.revision,
                    enabled,
                    credentials: {
                      apiKey: fields.apiKey.trim(),
                      from: fields.from.trim(),
                      fromName: fields.fromName.trim(),
                    },
                  }),
                "admin.integrations.saved",
              );
            }}
          >
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="email-from"
            >
              {t("admin.integrations.emailFrom")}
              <Input
                autoComplete="off"
                disabled={emailEditingDisabled}
                id="email-from"
                placeholder={config?.previews?.from ?? "noreply@example.com"}
                value={fields.from}
                onChange={(event) =>
                  setFields({ ...fields, from: event.target.value })
                }
              />
            </label>

            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="email-from-name"
            >
              {t("admin.integrations.emailFromName")}
              <Input
                autoComplete="off"
                disabled={emailEditingDisabled}
                id="email-from-name"
                placeholder={config?.previews?.fromName ?? "FlareMo"}
                value={fields.fromName}
                onChange={(event) =>
                  setFields({ ...fields, fromName: event.target.value })
                }
              />
            </label>

            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="email-api-key"
            >
              {t("admin.integrations.emailApiKey")}
              <PasswordInput
                autoComplete="new-password"
                disabled={emailEditingDisabled}
                id="email-api-key"
                placeholder={config?.previews?.apiKey ?? "re_..."}
                value={fields.apiKey}
                onChange={(event) =>
                  setFields({ ...fields, apiKey: event.target.value })
                }
              />
            </label>

            <DialogFooter className="mt-2">
              <Button
                variant="outline"
                type="button"
                onClick={() => setDialogOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button disabled={emailEditingDisabled} type="submit">
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
              {t("admin.integrations.delete")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.integrations.emailConfirmDelete")}
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
                    () => deleteEmailSettings(config.revision),
                    "admin.integrations.deleted",
                  );
              }}
            >
              {t("admin.integrations.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type OauthProviderKey = "google" | "github";

export function OauthSettingsCard() {
  const { t } = useI18n();
  const cache = useQueryClient();
  const [config, setConfig] = useState<OauthSettings | null>(null);
  const [fields, setFields] = useState({
    googleClientId: "",
    googleClientSecret: "",
    githubClientId: "",
    githubClientSecret: "",
  });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [activeDialog, setActiveDialog] = useState<OauthProviderKey | null>(
    null,
  );

  const settingsQuery = useQuery({
    queryKey: ["oauth-settings"],
    queryFn: getOauthSettings,
  });

  useEffect(() => {
    if (settingsQuery.data) setConfig(settingsQuery.data);
  }, [settingsQuery.data]);

  const envManaged = config?.source === "environment";
  const editingDisabled = busy || envManaged || !config || config.unreadable;

  async function run(
    task: () => Promise<unknown>,
    successKey: Parameters<ReturnType<typeof useI18n>["t"]>[0],
  ) {
    setBusy(true);
    try {
      await task();
      const value = await cache.fetchQuery({
        queryKey: ["oauth-settings"],
        queryFn: getOauthSettings,
        staleTime: 0,
      });
      setConfig(value);
      setFields({
        googleClientId: "",
        googleClientSecret: "",
        githubClientId: "",
        githubClientSecret: "",
      });
      toast.success(t(successKey));
      setActiveDialog(null);
    } catch (error) {
      toast.error(errorMessage(error, t("admin.integrations.oauthError")));
    } finally {
      setBusy(false);
    }
  }

  const handleSaveProvider = (providerKey: OauthProviderKey) => {
    if (!config) return;
    const isGoogle = providerKey === "google";
    void run(
      () =>
        saveOauthSettings({
          revision: config.revision,
          credentials: {
            google: {
              clientId: isGoogle
                ? fields.googleClientId.trim()
                : (config.previews?.google?.clientId ?? ""),
              clientSecret: isGoogle
                ? fields.googleClientSecret.trim()
                : (config.previews?.google?.clientSecret ?? ""),
            },
            github: {
              clientId: !isGoogle
                ? fields.githubClientId.trim()
                : (config.previews?.github?.clientId ?? ""),
              clientSecret: !isGoogle
                ? fields.githubClientSecret.trim()
                : (config.previews?.github?.clientSecret ?? ""),
            },
          },
        }),
      "admin.integrations.saved",
    );
  };

  const isGoogleActive = Boolean(config?.previews?.google?.active);
  const isGithubActive = Boolean(config?.previews?.github?.active);
  if (!config && settingsQuery.isPending) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    );
  }
  // A failed load must not fall through to rows reading "not configured".
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
        title={t("admin.integrations.oauthTitle")}
        footer={
          envManaged
            ? t("admin.integrations.oauthEnvManaged")
            : t("admin.integrations.oauthDescription")
        }
      >
        <SettingsRow
          icon={ShieldCheckIcon}
          label="Google"
          description={
            isGoogleActive
              ? t("admin.integrations.providerActive")
              : t("settings.status.notConfigured")
          }
          value={
            isGoogleActive
              ? t("settings.status.configured")
              : t("settings.status.notConfigured")
          }
          chevron={!editingDisabled}
          onClick={
            editingDisabled ? undefined : () => setActiveDialog("google")
          }
        />
        <SettingsRow
          icon={ShieldCheckIcon}
          label="GitHub"
          description={
            isGithubActive
              ? t("admin.integrations.providerActive")
              : t("settings.status.notConfigured")
          }
          value={
            isGithubActive
              ? t("settings.status.configured")
              : t("settings.status.notConfigured")
          }
          chevron={!editingDisabled}
          onClick={
            editingDisabled ? undefined : () => setActiveDialog("github")
          }
        />
      </SettingsSectionGroup>

      {config?.revision && !envManaged && (
        <SettingsSectionGroup title={t("common.actions")}>
          <SettingsRow
            destructive
            label={t("admin.integrations.delete")}
            onClick={() => setConfirmDelete(true)}
          />
        </SettingsSectionGroup>
      )}

      {/* Progressive Disclosure: Provider Dialog */}
      <Dialog
        open={activeDialog !== null}
        onOpenChange={(open) => {
          if (!open) setActiveDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {activeDialog === "google"
                ? t("admin.integrations.googleConfigure")
                : t("admin.integrations.githubConfigure")}
            </DialogTitle>
            <DialogDescription>
              {t("admin.integrations.oauthCallbackPrefix")}{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                {typeof window !== "undefined"
                  ? window.location.origin
                  : "https://your-instance"}
                /api/auth/callback/{activeDialog}
              </code>
            </DialogDescription>
          </DialogHeader>

          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (activeDialog) handleSaveProvider(activeDialog);
            }}
          >
            {activeDialog === "google" && (
              <>
                <label
                  className="flex flex-col gap-1.5 text-sm font-medium"
                  htmlFor="google-client-id"
                >
                  {t("admin.integrations.oauthClientId")}
                  <Input
                    autoComplete="off"
                    disabled={editingDisabled}
                    id="google-client-id"
                    placeholder={config?.previews?.google?.clientId ?? ""}
                    value={fields.googleClientId}
                    onChange={(event) =>
                      setFields({
                        ...fields,
                        googleClientId: event.target.value,
                      })
                    }
                  />
                </label>
                <label
                  className="flex flex-col gap-1.5 text-sm font-medium"
                  htmlFor="google-client-secret"
                >
                  {t("admin.integrations.oauthClientSecret")}
                  <PasswordInput
                    autoComplete="new-password"
                    disabled={editingDisabled}
                    id="google-client-secret"
                    placeholder={config?.previews?.google?.clientSecret ?? ""}
                    value={fields.googleClientSecret}
                    onChange={(event) =>
                      setFields({
                        ...fields,
                        googleClientSecret: event.target.value,
                      })
                    }
                  />
                </label>
              </>
            )}

            {activeDialog === "github" && (
              <>
                <label
                  className="flex flex-col gap-1.5 text-sm font-medium"
                  htmlFor="github-client-id"
                >
                  {t("admin.integrations.oauthClientId")}
                  <Input
                    autoComplete="off"
                    disabled={editingDisabled}
                    id="github-client-id"
                    placeholder={config?.previews?.github?.clientId ?? ""}
                    value={fields.githubClientId}
                    onChange={(event) =>
                      setFields({
                        ...fields,
                        githubClientId: event.target.value,
                      })
                    }
                  />
                </label>
                <label
                  className="flex flex-col gap-1.5 text-sm font-medium"
                  htmlFor="github-client-secret"
                >
                  {t("admin.integrations.oauthClientSecret")}
                  <PasswordInput
                    autoComplete="new-password"
                    disabled={editingDisabled}
                    id="github-client-secret"
                    placeholder={config?.previews?.github?.clientSecret ?? ""}
                    value={fields.githubClientSecret}
                    onChange={(event) =>
                      setFields({
                        ...fields,
                        githubClientSecret: event.target.value,
                      })
                    }
                  />
                </label>
              </>
            )}

            <DialogFooter className="mt-2">
              <Button
                variant="outline"
                type="button"
                onClick={() => setActiveDialog(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button disabled={editingDisabled} type="submit">
                {busy && <Spinner data-icon="inline-start" />}
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
              {t("admin.integrations.delete")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.integrations.oauthConfirmDelete")}
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
                    () => deleteOauthSettings(config.revision),
                    "admin.integrations.deleted",
                  );
              }}
            >
              {t("admin.integrations.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
