import type { DataTaskDto } from "@flaremo/contracts";
import type { UseQueryResult } from "@tanstack/react-query";
import { DownloadIcon, RefreshCcwIcon } from "lucide-react";
import { downloadExportJson } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { TranslationKey } from "@/i18n";

type TransferPanelProps = {
  dataTasksQuery: UseQueryResult<{ tasks: DataTaskDto[] }, Error>;
  retryExportIsPending: boolean;
  t: (key: TranslationKey) => string;
  onRetryExport: () => void;
};

export function TransferPanel({
  dataTasksQuery,
  retryExportIsPending,
  t,
  onRetryExport,
}: TransferPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("transfer.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {t("transfer.description")}
        </p>
        {dataTasksQuery.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : dataTasksQuery.isError ? (
          <p className="text-sm text-destructive">{t("transfer.loadFailed")}</p>
        ) : dataTasksQuery.data?.tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("transfer.empty")}</p>
        ) : (
          dataTasksQuery.data?.tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {task.kind === "export"
                    ? t("transfer.export")
                    : t("transfer.import")}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {task.phase}
                </p>
                {task.status === "failed" && task.error_message && (
                  <p className="mt-1 line-clamp-2 text-xs text-destructive">
                    {task.error_message}
                  </p>
                )}
                {task.progress_total > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width]"
                        style={{
                          width: `${Math.min(100, Math.round((task.progress_done / task.progress_total) * 100))}%`,
                        }}
                      />
                    </div>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {task.progress_done}/{task.progress_total}
                    </span>
                  </div>
                )}
              </div>
              <Badge
                variant={
                  task.status === "succeeded"
                    ? "secondary"
                    : task.status === "failed"
                      ? "destructive"
                      : "outline"
                }
              >
                {task.status}
              </Badge>
              {task.status === "succeeded" && task.kind === "export" && (
                <Button
                  size="sm"
                  variant="outline"
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
                  <DownloadIcon data-icon="inline-start" />
                  {t("transfer.download")}
                </Button>
              )}
              {task.status === "failed" && task.kind === "export" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={retryExportIsPending}
                  onClick={onRetryExport}
                >
                  <RefreshCcwIcon data-icon="inline-start" />
                  {t("transfer.retry")}
                </Button>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
