import type { ListMemosResponse } from "@flaremo/contracts";
import type {
  InfiniteData,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { Share } from "@/api";
import {
  ApiError,
  createShare,
  deleteTag,
  hardDeleteMemo,
  type Memo,
  type MemoState,
  renameTag,
  trashMemo,
  updateMemo,
} from "@/api";
import type { ExplorerView as ViewMode } from "@/components/flaremo-explorer";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import type { MemoCaptureInput } from "@/lib/local-memo-capture";
import { createMemoWithAttachments } from "@/lib/memo-submission";

/**
 * All memo mutations (create, trash/restore/update/hard-delete, share, tag
 * rename/delete) plus the optimistic ["memos"] cache patching they share and
 * the workspace invalidation helper reused by import flows.
 */
export function useMemoMutations() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [sharesByMemo, setSharesByMemo] = useState<Map<string, Share>>(
    new Map(),
  );

  // Memo detail pages subscribe to ["memo-context", id] and
  // ["memo-related", id]; prefix invalidation keeps edits and visibility
  // changes from serving stale detail data.
  const invalidateWorkspace = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["memos"] }),
      queryClient.invalidateQueries({ queryKey: ["memo-stats"] }),
      queryClient.invalidateQueries({ queryKey: ["tag-hierarchy"] }),
      queryClient.invalidateQueries({ queryKey: ["memo-context"] }),
      queryClient.invalidateQueries({ queryKey: ["memo-related"] }),
    ]);

  const handleMutationError = (error: unknown) => {
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      toast.error(t("toast.accessRequired"));
      return;
    }
    toast.error(errorMessage(error, t("toast.requestFailed")));
  };

  const { mutateAsync: createMemoAsync, isPending: isCreatingMemo } =
    useMutation({
      mutationFn: createMemoWithAttachments,
      onMutate: (input) => prependOptimisticMemo(queryClient, input),
      onError: (_error, _input, optimisticId) => {
        // Roll the optimistic card back, then still refresh: a memo can be
        // created before one of its attachment uploads loses the network
        // response, so the durable memo must not stay hidden.
        if (typeof optimisticId === "string") {
          removeOptimisticMemo(queryClient, optimisticId);
        }
        void invalidateWorkspace();
      },
      onSuccess: () => {
        void invalidateWorkspace();
      },
    });

  const trashMutation = useMutation({
    mutationFn: trashMemo,
    onMutate: (id) =>
      optimisticallyPatchMemo(queryClient, id, { state: "trashed" }),
    onSuccess: () => {
      toast.success(t("toast.movedToTrash"));
    },
    onError: (error, _id, snapshot) => {
      restoreMemoSnapshot(queryClient, snapshot);
      handleMutationError(error);
    },
    onSettled: () => void invalidateWorkspace(),
  });

  const renameTagMutation = useMutation({
    mutationFn: renameTag,
    onError: (error) => {
      handleMutationError(error);
      toast.error(t("explorer.tagRenameFailed"));
    },
    onSettled: () => void invalidateWorkspace(),
  });

  const deleteTagMutation = useMutation({
    mutationFn: deleteTag,
    onError: (error) => {
      handleMutationError(error);
      toast.error(t("explorer.tagDeleteFailed"));
    },
    onSuccess: () => toast.success(t("explorer.tagDeleted")),
    onSettled: () => void invalidateWorkspace(),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => updateMemo(id, { status: "normal" }),
    onMutate: (id) =>
      optimisticallyPatchMemo(queryClient, id, { state: "normal" }),
    onSuccess: () => {
      toast.success(t("toast.restored"));
    },
    onError: (error, _id, snapshot) => {
      restoreMemoSnapshot(queryClient, snapshot);
      handleMutationError(error);
    },
    onSettled: () => void invalidateWorkspace(),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Parameters<typeof updateMemo>[1];
    }) => updateMemo(id, input),
    onMutate: ({ id, input }) =>
      optimisticallyPatchMemo(queryClient, id, memoPatchFromUpdate(input)),
    onSuccess: () => {
      toast.success(t("toast.updated"));
    },
    onError: (error, _variables, snapshot) => {
      restoreMemoSnapshot(queryClient, snapshot);
      handleMutationError(error);
    },
    onSettled: () => void invalidateWorkspace(),
  });

  const hardDeleteMutation = useMutation({
    mutationFn: hardDeleteMemo,
    onMutate: (id) => optimisticallyPatchMemo(queryClient, id, null),
    onSuccess: () => {
      toast.success(t("toast.deleted"));
    },
    onError: (error, _id, snapshot) => {
      restoreMemoSnapshot(queryClient, snapshot);
      handleMutationError(error);
    },
    onSettled: () => void invalidateWorkspace(),
  });

  const shareMutation = useMutation({
    mutationFn: createShare,
    onSuccess: (share) => {
      setSharesByMemo((current) => new Map(current).set(share.memo, share));
      toast.success(t("toast.shareCreated"));
    },
    onError: handleMutationError,
  });

  return {
    createMemoAsync,
    isCreatingMemo,
    deleteTagMutation,
    handleMutationError,
    hardDeleteMutation,
    invalidateWorkspace,
    renameTagMutation,
    restoreMutation,
    sharesByMemo,
    shareMutation,
    trashMutation,
    updateMutation,
  };
}

type MemoSnapshot = Array<
  [QueryKey, InfiniteData<ListMemosResponse> | undefined]
>;

const OPTIMISTIC_PREFIX = "optimistic-";

const optimisticMemoId = () =>
  `${OPTIMISTIC_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Prepend the composer submission into every unfiltered timeline cache so the
// new card appears before the server answers. Returns the optimistic id so
// onError can roll it back; the settle invalidation replaces it with the
// persisted record.
function prependOptimisticMemo(
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
  >({ queryKey: ["memos"] })) {
    // Only plain timelines (no view/search/tag filter, and not the "untagged"
    // toggle) can safely show a brand-new private memo.
    const [
      view = "all",
      query = undefined,
      tag = undefined,
      untagged = undefined,
    ] = queryKey.slice(1) as [
      ViewMode | undefined,
      string | undefined,
      string | undefined,
      boolean | undefined,
    ];
    if (view !== "all" || query || tag || untagged || !data) continue;
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

function removeOptimisticMemo(queryClient: QueryClient, id: string) {
  for (const [queryKey, data] of queryClient.getQueriesData<
    InfiniteData<ListMemosResponse>
  >({ queryKey: ["memos"] })) {
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

async function optimisticallyPatchMemo(
  queryClient: QueryClient,
  id: string,
  patch: Partial<Memo> | null,
): Promise<MemoSnapshot> {
  await queryClient.cancelQueries({ queryKey: ["memos"] });
  const snapshots = queryClient.getQueriesData<InfiniteData<ListMemosResponse>>(
    {
      queryKey: ["memos"],
    },
  );

  for (const [queryKey, data] of snapshots) {
    if (!data) continue;
    const view = queryKey[1] as ViewMode | undefined;
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
          return view && next.state !== viewToMemoState(view) ? [] : [next];
        }),
      })),
    });
  }

  return snapshots;
}

function restoreMemoSnapshot(
  queryClient: QueryClient,
  snapshot: MemoSnapshot | undefined,
) {
  for (const [queryKey, data] of snapshot ?? []) {
    queryClient.setQueryData(queryKey, data);
  }
}

function memoPatchFromUpdate(
  input: Parameters<typeof updateMemo>[1],
): Partial<Memo> {
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
