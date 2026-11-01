import type { DataTaskDto } from "@flaremo/contracts";
import {
  type UseQueryResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { DownloadIcon, RefreshCcwIcon, UploadIcon } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { createImportTask, downloadExportJson, retryImportTask } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { type TranslationKey, useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { SettingsRow, SettingsSectionGroup } from "./apple-settings-ui";

type TransferPanelProps = {
  createExportIsPending: boolean;
  dataTasksQuery: UseQueryResult<{ tasks: DataTaskDto[] }, Error>;
  retryExportIsPending: boolean;
  t: (key: TranslationKey) => string;
  onCreateExport: () => void;
  onRetryExport: () => void;
};

export function TransferPanel({
  createExportIsPending,
  dataTasksQuery,
  retryExportIsPending,
  t,
  onCreateExport,
  onRetryExport,
}: TransferPanelProps) {
  const importMutation = useImportBundle();
  const importInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  // The prop form of `t` is unbound; interpolation needs the hook's variant.
  const { t: translate } = useI18n();
  const retryImportMutation = useMutation({
    mutationFn: retryImportTask,
    onSuccess: ({ task, result }) => {
      if (task.status === "succeeded") {
        toast.success(
          translate("toast.importDone", { count: result.imported_memos }),
        );
      } else {
        toast.error(
          translate("toast.importFailed", {
            message: task.error_message ?? task.status,
          }),
        );
      }
      void queryClient.invalidateQueries();
    },
    onError: (error) => {
      toast.error(
        errorMessage(error, translate("toast.importFailed", { message: "" })),
      );
    },
  });

  return (
    <div className="flex flex-col gap-5">
      {/* The section is "import & export": both directions start here, the
          import used to live only in the sidebar's user menu. */}
      <SettingsSectionGroup>
        <SettingsRow
          icon={DownloadIcon}
          label={t("transfer.newExport")}
          action={createExportIsPending ? <Spinner /> : undefined}
          disabled={createExportIsPending}
          onClick={onCreateExport}
        />
        <SettingsRow
          icon={UploadIcon}
          label={t("common.import")}
          action={importMutation.isPending ? <Spinner /> : undefined}
          disabled={importMutation.isPending}
          onClick={() => importInputRef.current?.click()}
        />
      </SettingsSectionGroup>
      <input
        accept="application/json"
        aria-hidden="true"
        className="hidden"
        ref={importInputRef}
        tabIndex={-1}
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) importMutation.mutate(file);
        }}
      />

      <SettingsSectionGroup>
        {dataTasksQuery.isLoading ? (
          <div className="p-4">
            <Skeleton className="h-16 w-full" />
          </div>
        ) : dataTasksQuery.isError ? (
          <div className="p-4 text-sm text-destructive">
            {t("transfer.loadFailed")}
          </div>
        ) : dataTasksQuery.data?.tasks.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            {t("transfer.empty")}
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border/40">
            {dataTasksQuery.data?.tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between gap-3 px-3.5 py-3 transition-colors hover:bg-accent/20"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">
                      {task.kind === "export"
                        ? t("transfer.export")
                        : t("transfer.import")}
                    </p>
                    <Badge
                      variant={
                        task.status === "succeeded"
                          ? "secondary"
                          : task.status === "failed"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {t(`transfer.status.${task.status}`)}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground mt-0.5">
                    {task.phase}
                  </p>
                  {task.status === "failed" && task.error_message && (
                    <p className="mt-1 line-clamp-2 text-xs text-destructive">
                      {task.error_message}
                    </p>
                  )}
                  {task.progress_total > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-[width]"
                          style={{
                            width: `${Math.min(100, Math.round((task.progress_done / task.progress_total) * 100))}%`,
                          }}
                        />
                      </div>
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {task.progress_done}/{task.progress_total}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {task.status === "succeeded" && task.kind === "export" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() =>
                        void downloadExportJson(task.id).then((blob) => {
                          const url = URL.createObjectURL(blob);
                          const anchor = document.createElement("a");
                          anchor.href = url;
                          anchor.download = `flaremo-export-${task.id}.json`;
                          anchor.click();
                          setTimeout(() => URL.revokeObjectURL(url), 1000);
                        })
                      }
                    >
                      <DownloadIcon
                        data-icon="inline-start"
                        className="size-3.5"
                      />
                      {t("transfer.download")}
                    </Button>
                  )}
                  {task.status === "failed" && task.kind === "export" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      disabled={retryExportIsPending}
                      onClick={onRetryExport}
                    >
                      <RefreshCcwIcon
                        data-icon="inline-start"
                        className="size-3.5"
                      />
                      {t("transfer.retry")}
                    </Button>
                  )}
                  {task.status === "failed" && task.kind === "import" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      disabled={retryImportMutation.isPending}
                      onClick={() => retryImportMutation.mutate(task.id)}
                    >
                      {retryImportMutation.isPending &&
                      retryImportMutation.variables === task.id ? (
                        <Spinner
                          data-icon="inline-start"
                          className="size-3.5"
                        />
                      ) : (
                        <RefreshCcwIcon
                          data-icon="inline-start"
                          className="size-3.5"
                        />
                      )}
                      {t("transfer.retry")}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSectionGroup>
    </div>
  );
}

/** Reads a Memos/FlareMo JSON bundle and imports it, the same request the
 *  user menu's import sends; on success every cached view is refetched since
 *  an import can touch memos, tags, stats and the task list at once. */
function useImportBundle() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      let bundle: unknown;
      try {
        bundle = JSON.parse(await file.text()) as unknown;
      } catch {
        throw new Error(t("toast.invalidImport"));
      }
      return createImportTask({ bundle });
    },
    onSuccess: ({ task, result }) => {
      if (task.status !== "succeeded") {
        toast.error(
          t("toast.importFailed", {
            message: task.error_message ?? task.status,
          }),
        );
      } else {
        toast.success(t("toast.importDone", { count: result.imported_memos }));
      }
      void queryClient.invalidateQueries();
    },
    onError: (error) => {
      const message = errorMessage(error, "");
      toast.error(
        message === t("toast.invalidImport")
          ? message
          : t("toast.importFailed", { message }),
      );
      // The request failed but its task row may still exist with a rollback
      // checkpoint, ready to retry from the list below.
      void queryClient.invalidateQueries();
    },
  });
}
