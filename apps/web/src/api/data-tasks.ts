import type {
  DataTaskDto,
  ImportBundle,
  ImportResult,
} from "@flaremo/contracts";
import { ApiError, apiRequest } from "./client";

/**
 * Fetch the complete small export bundle. The worker returns 413 when the
 * bundle would exceed its inline response budget; callers can then fall back
 * to the chunked export-task flow without guessing the payload size locally.
 */
export async function exportDataInline(includeBinary = true) {
  const query = new URLSearchParams({
    include_binary: String(includeBinary),
  });
  return apiRequest<ImportBundle>(`/api/v1/export?${query.toString()}`);
}

export async function createExportTask() {
  return apiRequest<{ task: DataTaskDto }>("/api/v1/export/tasks", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function getDataTask(id: string) {
  return apiRequest<{ task: DataTaskDto }>(
    `/api/v1/export/tasks/${encodeURIComponent(id)}`,
  );
}

export async function listDataTasks() {
  return apiRequest<{ tasks: DataTaskDto[] }>("/api/v1/export/tasks");
}

export async function createImportTask(input: {
  bundle: unknown;
  conflict?: "skip" | "duplicate";
}) {
  return apiRequest<{ task: DataTaskDto; result: ImportResult }>(
    "/api/v1/import/tasks",
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function retryImportTask(id: string) {
  return apiRequest<{ task: DataTaskDto; result: ImportResult }>(
    `/api/v1/import/tasks/${encodeURIComponent(id)}/retry`,
    { method: "POST" },
  );
}

export async function downloadExportJson(id: string) {
  const response = await fetch(
    `/api/v1/export/tasks/${encodeURIComponent(id)}/manifest`,
    { credentials: "same-origin" },
  );
  if (!response.ok) {
    throw new ApiError(response.statusText, response.status);
  }
  return response.blob();
}
