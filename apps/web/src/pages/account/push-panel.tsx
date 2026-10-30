import { useMutation, useQuery } from "@tanstack/react-query";
import { BellRingIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { getPushConfig, subscribeToPush, unsubscribeFromPush } from "@/api";
import { InfoTip } from "@/components/info-tip";
import { QueryErrorState } from "@/components/query-error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { SettingsRow, SettingsSectionGroup } from "./apple-settings-ui";

export function PushPanel() {
  const { t } = useI18n();
  const configQuery = useQuery({
    queryKey: ["push-config"],
    queryFn: getPushConfig,
    retry: false,
  });
  const [supported] = useState(
    () =>
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window,
  );

  const invalidate = () => {
    void configQuery.refetch();
  };

  const subscribeMutation = useMutation({
    mutationFn: async () => {
      const config = configQuery.data;
      if (!config?.public_key) {
        throw new Error(t("push.unconfigured"));
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error(t("push.permissionDenied"));
      }
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeBase64Url(
            config.public_key,
          ) as unknown as BufferSource,
        });
      }
      const json = subscription.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error(t("push.subscribeFailed"));
      }
      await subscribeToPush({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
    },
    onSuccess: () => {
      toast.success(t("push.subscribed"));
      invalidate();
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("push.subscribeFailed"))),
  });

  const unsubscribeMutation = useMutation({
    mutationFn: async () => {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await unsubscribeFromPush(subscription.endpoint);
        await subscription.unsubscribe();
      }
    },
    onSuccess: () => toast.success(t("push.unsubscribed")),
    onError: (error) =>
      toast.error(errorMessage(error, t("push.unsubscribeFailed"))),
    onSettled: invalidate,
  });

  if (!supported) return null;
  if (configQuery.isPending) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    );
  }
  if (configQuery.isError) {
    return (
      <QueryErrorState
        isRetrying={configQuery.isFetching}
        onRetry={() => void configQuery.refetch()}
      />
    );
  }
  const enabled = (configQuery.data?.subscriptions ?? 0) > 0;
  const configured = Boolean(configQuery.data?.public_key);
  const isPending =
    subscribeMutation.isPending || unsubscribeMutation.isPending;

  return (
    <div className="flex flex-col gap-5">
      <SettingsSectionGroup>
        <SettingsRow
          icon={BellRingIcon}
          label={
            <div className="flex items-center gap-1.5">
              <span>{t("push.title")}</span>
              <InfoTip text={t("push.description")} />
            </div>
          }
          description={
            !configured
              ? t("push.notConfigured")
              : enabled
                ? t("push.subscribed")
                : undefined
          }
          action={
            <Switch
              checked={enabled}
              disabled={!configured || isPending}
              onCheckedChange={(val) => {
                if (val) {
                  subscribeMutation.mutate();
                } else {
                  unsubscribeMutation.mutate();
                }
              }}
            />
          }
        />
      </SettingsSectionGroup>
    </div>
  );
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
