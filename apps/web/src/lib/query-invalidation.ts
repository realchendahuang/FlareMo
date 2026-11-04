import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./query-keys";

/**
 * Task writes ripple through more than one cache family: the board/list
 * queries, the project picker counts, and (when the task came from a memo) the
 * timeline badge that renders the source note. Keep the three in one place so
 * a new task surface cannot be forgotten by one of the call sites.
 */
export function invalidateTaskSurfaces(
  queryClient: QueryClient,
  options: { memoId?: string | null } = {},
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
  if (options.memoId) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.memos.all });
  }
}
