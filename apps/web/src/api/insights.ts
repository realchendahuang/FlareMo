import type {
  CreateMemoInsightInput,
  MemoInsightResponse,
} from "@flaremo/contracts";
import { apiRequest } from "./client";

/**
 * AI insight task surface. The browser creates a task and reads the result the
 * executor writes back; writing a result (PUT) requires a PAT, so it never
 * happens here. See docs/agent-access-design.md §9.
 */

/** A `MemoInsightDto.id` may arrive bare or as `insights/<uuid>`. */
function insightPath(id: string) {
  const bare = id.startsWith("insights/") ? id.slice("insights/".length) : id;
  return `/api/app/insights/${encodeURIComponent(bare)}`;
}

export async function createMemoInsight(input: CreateMemoInsightInput) {
  return apiRequest<MemoInsightResponse>("/api/app/insights", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getMemoInsight(id: string) {
  return apiRequest<MemoInsightResponse>(insightPath(id));
}

/** Delete a derived result (or a queued task); the Worker answers 204. */
export async function deleteMemoInsight(id: string) {
  await apiRequest<undefined>(insightPath(id), { method: "DELETE" });
}
