/**
 * Optimistic ["memos"] cache patching shared by every memo mutation. Kept out
 * of the hook so the patching rules — which query key shapes may show a
 * brand-new memo, how a search scope narrows a patch, how a rollback snapshot
 * is restored — are testable without React.
 *
 * Both functions enumerate whatever ["memos", ...] entries the cache holds.
 * The producer is useWorkspaceQueries, whose key is
 * ["memos", space, view, query, tag, untagged]: space defaults to "all", view
 * to "all", query to "" and untagged to false. Prepend reads all five tail
 * slots positionally and inserts only into plain timelines (view "all", no
 * query/tag/untagged filter) whose space partition will contain the new memo
 * — the server files a memo by visibility (private → personal corpus, shared
 * → team corpus) and the mixed "all" timeline shows both, so a private
 * capture prepends to "all"/"personal" keys but never to "team". The patch
 * path reads view at slot 2 and the search string at slot 3, then keeps the
 * patched row only where it still matches the state that view or search
 * scope lists.
 */
import type { ListMemosResponse } from "@flaremo/contracts";
import { parseMemoSearchQuery } from "@flaremo/contracts/search-query";
import type {
  InfiniteData,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
import type { Memo, MemoState, UpdateMemoRequest } from "@/api";
import type { ExplorerView as ViewMode } from "@/components/flaremo-explorer";
import type { MemoCaptureInput } from "@/lib/local-memo-capture";
import { queryKeys } from "@/lib/query-keys";

export type MemoSnapshot = Array<
  [QueryKey, InfiniteData<ListMemosResponse> | undefined]
>;

const OPTIMISTIC_PREFIX = "optimistic-";

const optimisticMemoId = () =>
  `${OPTIMISTIC_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Whether a memo with this visibility belongs in the timeline a key's space
 * segment scopes to. Mirrors the server's create-time filing — private memos
 * carry no team, shared visibilities join the author's organization — so an
 * optimistic card never flashes into a space timeline that will not list it.
 * Anything but a known space segment opts out.
 */
function memoLandsInSpace(space: unknown, visibility: Memo["visibility"]) {
  if (space === undefined || space === "all") return true;
  if (space === "personal") return visibility === "private";
  if (space === "team") return visibility !== "private";
  return false;
}

// Prepend the composer submission into every unfiltered timeline cache so the
// new card appears before the server answers. Returns the optimistic id so
// onError can roll it back; the settle invalidation replaces it with the
// persisted record.
export function prependOptimisticMemo(
  queryClient: QueryClient,
  input: MemoCaptureInput,
): string {
  const id = optimisticMemoId();
  const now = new Date().toISOString();
  const optimisticMemo: Memo = {
    name: id,
    id,
    content: input.content,
    visibility: input.visibility ?? "private",
    state: "normal",
    pinned: false,
    payload: {
      ...(input.tags?.length ? { tags: input.tags } : {}),
      ...(input.clientId ? { client_id: input.clientId } : {}),
    },
    create_time: now,
    update_time: now,
    display_time: now,
    creator: "",
    attachments: [],
    can_manage: true,
  };

  for (const [queryKey, data] of queryClient.getQueriesData<
    InfiniteData<ListMemosResponse>
  >({ queryKey: queryKeys.memos.all })) {
    // Only plain timelines (view "all", no query/tag filter, and not the
    // "untagged" toggle) can safely show a brand-new memo, and only when the
    // key's space partition is one the server will file it into.
    const space = queryKey[1];
    const [view = "all", query, tag, untagged] = queryKey.slice(2) as [
      ViewMode | undefined,
      string | undefined,
      string | undefined,
      boolean | undefined,
    ];
    if (view !== "all" || query || tag || untagged || !data) continue;
    if (!memoLandsInSpace(space, optimisticMemo.visibility)) continue;
    queryClient.setQueryData<InfiniteData<ListMemosResponse>>(queryKey, {
      ...data,
      pages: data.pages.map((page, index) =>
        index === 0
          ? { ...page, memos: [optimisticMemo, ...page.memos] }
          : page,
      ),
    });
  }

  return id;
}

export function removeOptimisticMemo(queryClient: QueryClient, id: string) {
  for (const [queryKey, data] of queryClient.getQueriesData<
    InfiniteData<ListMemosResponse>
  >({ queryKey: queryKeys.memos.all })) {
    if (!data) continue;
    queryClient.setQueryData<InfiniteData<ListMemosResponse>>(queryKey, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        memos: page.memos.filter((memo) => memo.id !== id),
      })),
    });
  }
}

export async function optimisticallyPatchMemo(
  queryClient: QueryClient,
  id: string,
  patch: Partial<Memo> | null,
): Promise<MemoSnapshot> {
  await queryClient.cancelQueries({ queryKey: queryKeys.memos.all });
  const snapshots = queryClient.getQueriesData<InfiniteData<ListMemosResponse>>(
    {
      queryKey: queryKeys.memos.all,
    },
  );

  for (const [queryKey, data] of snapshots) {
    if (!data) continue;
    const view = queryKey[2] as ViewMode | undefined;
    const search = typeof queryKey[3] === "string" ? queryKey[3].trim() : "";
    const scope = parseMemoSearchQuery(search).scope;
    queryClient.setQueryData<InfiniteData<ListMemosResponse>>(queryKey, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        memos: page.memos.flatMap((memo) => {
          if (memo.id !== id && memo.name !== id) return [memo];
          if (!patch) return [];
          const next = {
            ...memo,
            ...patch,
            update_time: new Date().toISOString(),
          };
          // Search includes archived notes unless an explicit scope narrows
          // it. Editing a result must not apply the plain timeline filter.
          const matchesState = search
            ? scope === "trash"
              ? next.state === "trashed"
              : scope === "archive"
                ? next.state === "archived"
                : scope === "timeline"
                  ? next.state === "normal"
                  : next.state === "normal" || next.state === "archived"
            : !view || next.state === viewToMemoState(view);
          return matchesState ? [next] : [];
        }),
      })),
    });
  }

  return snapshots;
}

export function restoreMemoSnapshot(
  queryClient: QueryClient,
  snapshot: MemoSnapshot | undefined,
) {
  for (const [queryKey, data] of snapshot ?? []) {
    queryClient.setQueryData(queryKey, data);
  }
}

export function memoPatchFromUpdate(input: UpdateMemoRequest): Partial<Memo> {
  return {
    ...(input.content !== undefined ? { content: input.content } : {}),
    ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
    ...(input.status !== undefined ? { state: input.status } : {}),
    ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
  };
}

export function viewToMemoState(view: ViewMode): MemoState {
  if (view === "archived") return "archived";
  if (view === "trashed") return "trashed";
  return "normal";
}
