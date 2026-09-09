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
      onSuccess: () => {
        void invalidateWorkspace();
      },
      // A memo can be created before one of its attachment uploads loses the
      // network response. Refresh the list even on failure so the durable
      // memo is not hidden while its queued attachment retry is pending.
      onError: () => {
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
