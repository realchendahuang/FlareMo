import { useQueries } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { listTasksForSourceMemos, type Task } from "@/api";
import { queryKeys } from "@/lib/query-keys";
import { useAllTasks } from "@/lib/task-views";

/**
 * Per-page task badge cache.
 *
 * The old badge subscribed every card to the all-tasks query, which pages
 * through up to 2 000 rows to answer "does this one memo have a task?". The
 * provider fetches tasks for exactly the memos on screen, in chunks the API
 * caps at 100 ids, and the cards read a map.
 */
const MemoTaskContext = createContext<Map<string, Task[]> | null>(null);

const BADGE_CHUNK = 100;

export function MemoTaskProvider({
  memoIds,
  enabled = true,
  children,
}: {
  memoIds: readonly string[];
  enabled?: boolean;
  children: ReactNode;
}) {
  const ids = useMemo(() => [...new Set(memoIds)].sort(), [memoIds]);
  const chunks = useMemo(() => {
    const groups: string[][] = [];
    for (let offset = 0; offset < ids.length; offset += BADGE_CHUNK) {
      groups.push(ids.slice(offset, offset + BADGE_CHUNK));
    }
    return groups;
  }, [ids]);
  const queries = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: queryKeys.tasks.badges(chunk),
      queryFn: () => listTasksForSourceMemos(chunk),
      enabled: enabled && chunk.length > 0,
      staleTime: 30_000,
    })),
  });
  const byMemo = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const query of queries) {
      for (const task of query.data?.tasks ?? []) {
        if (!task.source_memo_id) continue;
        const list = map.get(task.source_memo_id) ?? [];
        list.push(task);
        map.set(task.source_memo_id, list);
      }
    }
    return map;
  }, [queries]);
  return (
    <MemoTaskContext.Provider value={byMemo}>
      {children}
    </MemoTaskContext.Provider>
  );
}

/** The tasks a memo was scheduled into. */
export function useMemoTasks(memoName: string, enabled = true): Task[] {
  const fromPage = useContext(MemoTaskContext);
  // Standalone cards (detail page without a provider, tests) still work. The
  // page path keeps this query disabled, so the timeline never loads every
  // task just to render badges.
  const all = useAllTasks({ enabled: enabled && fromPage === null });
  return useMemo(() => {
    if (fromPage) return fromPage.get(memoName) ?? [];
    return (all.data?.tasks ?? []).filter(
      (task) => task.source_memo_id === memoName,
    );
  }, [all.data, fromPage, memoName]);
}
