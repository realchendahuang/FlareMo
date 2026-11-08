import type {
  ConnectedAppDto,
  ConnectedAppsResponseDto,
} from "@flaremo/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { listConnectedApps, revokeConnectedApp } from "@/api";
import { QueryErrorState } from "@/components/query-error-state";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { type TranslationKey, type TranslationParams, useI18n } from "@/i18n";
import { clientTypeLabel, scopeLabel } from "@/lib/connect";
import { formatDateTime } from "@/lib/date-format";
import { errorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

/**
 * The "connected apps" settings section: every app client (and manual token)
 * that currently holds an access token for this account, with a revoke action
 * behind a confirmation dialog. See docs/agent-access-design.md §7.
 */
export function ConnectedAppsPanel() {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<ConnectedAppDto | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const appsQuery = useQuery({
    queryKey: queryKeys.connectedApps,
    queryFn: listConnectedApps,
    retry: false,
  });

  const handleRevoke = async (app: ConnectedAppDto) => {
    setRevokingId(app.id);
    try {
      await revokeConnectedApp(app.id);
      // The inventory lists disabled keys as "expired" (a revoked app and a
      // dormant one look alike on the wire), so a refetch would put the app
      // right back on screen. Drop the row locally instead; the next open
      // refetches the real list.
      queryClient.setQueryData<ConnectedAppsResponseDto>(
        queryKeys.connectedApps,
        (current) =>
          current
            ? {
                apps: current.apps.filter((item) => item.id !== app.id),
              }
            : current,
      );
      // The access token is the same `auth_apikeys` row the account's token
      // list shows, so keep that list from claiming a revoked token is live.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.personalAccessTokens,
      });
      toast.success(t("connect.revokedToast", { name: app.name }));
    } catch (error) {
      toast.error(errorMessage(error, t("connect.revokeFailed")));
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <>
      <SettingsSectionGroup
        footer={t("connect.appsFooter")}
        title={t("connect.appsTitle")}
      >
        {appsQuery.isLoading && <AppsSkeleton />}
        {appsQuery.isError && (
          <QueryErrorState
            className="min-h-44 text-muted-foreground"
            isRetrying={appsQuery.isFetching}
            onRetry={() => void appsQuery.refetch()}
          />
        )}
        {appsQuery.isSuccess && appsQuery.data.apps.length === 0 && (
          <div className="flex flex-col items-center gap-1 px-5 py-7 text-center">
            <p className="text-sm font-medium">{t("connect.appsEmptyTitle")}</p>
            <p className="max-w-sm text-xs leading-relaxed text-pretty text-muted-foreground">
              {t("connect.appsEmptyDescription")}
            </p>
          </div>
        )}
        {appsQuery.data?.apps.map((app) => (
          <ConnectedAppRow
            app={app}
            key={app.id}
            locale={locale}
            pending={revokingId === app.id}
            t={t}
            onRevoke={() => setConfirming(app)}
          />
        ))}
      </SettingsSectionGroup>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("connect.revokeTitle", { name: confirming?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("connect.revokeDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                const app = confirming;
                setConfirming(null);
                if (app) void handleRevoke(app);
              }}
            >
              {t("connect.revoke")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ConnectedAppRow({
  app,
  locale,
  pending,
  t,
  onRevoke,
}: {
  app: ConnectedAppDto;
  locale: string;
  pending: boolean;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  onRevoke: () => void;
}) {
  const active = app.status === "active";
  const lastUsed = app.lastUsedAt
    ? t("connect.lastUsed", {
        date: formatDateTime(app.lastUsedAt, locale),
      })
    : t("connect.neverUsed");
  const scopes = app.scopes.map((scope) => scopeLabel(scope, t)).join(" + ");

  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-3 transition-colors hover:bg-accent/20">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{app.name}</p>
          <Badge
            className="h-5 px-1.5 text-xs"
            variant={active ? "secondary" : "outline"}
          >
            {active ? t("auth.active") : t("connect.status.expired")}
          </Badge>
        </div>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span>{clientTypeLabel(app.clientType, t)}</span>
          <span aria-hidden="true">·</span>
          <span>{scopes}</span>
          <span aria-hidden="true">·</span>
          <span>{lastUsed}</span>
        </p>
      </div>
      <Button
        className="h-8 shrink-0 px-2 text-xs text-muted-foreground hover:text-destructive"
        disabled={pending}
        onClick={onRevoke}
        size="sm"
        variant="ghost"
      >
        {pending && <Spinner data-icon="inline-start" />}
        {t("connect.revoke")}
      </Button>
    </div>
  );
}

function AppsSkeleton() {
  return (
    <div className="flex flex-col divide-y divide-border/40">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}
