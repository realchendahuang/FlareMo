import { toast } from "sonner";
import {
  ApiError,
  createExportTask,
  createImportTask,
  downloadExportJson,
  exportDataInline,
  getDataTask,
} from "@/api";
import { useI18n } from "@/i18n";
import { downloadBlobFile, downloadJsonFile } from "@/lib/download";

type UseDataTransferOptions = {
  handleMutationError: (error: unknown) => void;
  invalidateWorkspace: () => Promise<unknown[]>;
};

/**
 * Workspace data export/import flows (inline download with chunked-task
 * fallback) and the bounded task polling they share.
 */
export function useDataTransfer({
  handleMutationError,
  invalidateWorkspace,
}: UseDataTransferOptions) {
  const { t } = useI18n();

  const pollDataTask = async (id: string) => {
    // A task can be left queued when a request is interrupted. Bound the
    // browser wait so the UI never spins forever; the task remains inspectable
    // through the API and can be retried by a later export.
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const { task } = await getDataTask(id);
      if (
        task.status === "succeeded" ||
        task.status === "failed" ||
        task.status === "expired"
      ) {
        return task;
      }
      toast(t("toast.taskPending"), { id: "data-task-pending" });
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error(t("toast.taskTimeout"));
  };

  const handleExport = async () => {
    // Prefer the inline endpoint for small workspaces so the downloaded file
    // is a complete, immediately restorable Memos bundle. The worker returns
    // 413 when the payload would exceed its safe response budget.
    try {
      const bundle = await exportDataInline(true);
      downloadJsonFile(
        bundle,
        `flaremo-export-${new Date().toISOString()}.json`,
      );
      toast.success(t("toast.exportInlineDone"));
      return;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 413) {
        handleMutationError(error);
        return;
      }
    }

    try {
      const { task } = await createExportTask();
      toast.success(t("toast.exportStarted"));
      const finished = await pollDataTask(task.id);
      if (finished.status !== "succeeded") {
        toast.error(
          t("toast.exportFailed", {
            message: finished.error_message ?? finished.status,
          }),
        );
        return;
      }
      const blob = await downloadExportJson(finished.id);
      downloadBlobFile(blob, `flaremo-export-${new Date().toISOString()}.json`);
      toast.success(t("toast.exportManifestDone"));
    } catch (error) {
      handleMutationError(error);
    }
  };

  const handleImportFile = async (bundle: unknown) => {
    try {
      const { task, result } = await createImportTask({ bundle });
      toast.success(t("toast.importStarted"));
      if (task.status !== "succeeded") {
        toast.error(
          t("toast.importFailed", {
            message: task.error_message ?? task.status,
          }),
        );
        return;
      }
      toast.success(t("toast.importDone", { count: result.imported_memos }));
      void invalidateWorkspace();
    } catch (error) {
      handleMutationError(error);
    }
  };

  return { handleExport, handleImportFile };
}
