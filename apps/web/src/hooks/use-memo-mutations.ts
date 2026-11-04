import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { Share } from "@/api";
import {
  ApiError,
  createShare,
  deleteTag,
  hardDeleteMemo,
  renameTag,
  revokeShare,
  trashMemo,
  updateMemo,
} from "@/api";
import { useI18n } from "@/i18n";
import { errorMessage, isUntrustedOriginError } from "@/lib/error";
import {
  memoPatchFromUpdate,
  optimisticallyPatchMemo,
  prependOptimisticMemo,
  removeOptimisticMemo,
  restoreMemoSnapshot,
} from "@/lib/memo-cache";
import { createMemoWithAttachments } from "@/lib/memo-submission";
import { queryKeys } from "@/lib/query-keys";

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
      queryClient.invalidateQueries({ queryKey: queryKeys.memos.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.semanticSearch.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.memoStats.all }),
      // The time-horizon day/week/month/year views read their own stats
      // queries (60s staleTime); without these they would keep pre-mutation
      // heat colors after a write.
      queryClient.invalidateQueries({ queryKey: queryKeys.statsHourly.allDay }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.statsHourly.allMonth,
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.statsHourly.allWeek,
      }),
      queryClient.invalidateQueries({ queryKey: queryKeys.memoStatsYear.all }),
      // Day slots are a separate query family: without this the horizon kept
      // the pre-edit memo list for the selected day.
      queryClient.invalidateQueries({ queryKey: queryKeys.memosDaySlots.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tagHierarchy.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.memoContext.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.memoRelated.all }),
      // Ticking a to-do line moves the task scheduled from it (server-side),
      // so the board and the memo badges must re-read.
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all }),
    ]);

  const handleMutationError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      toast.error(t("toast.accessRequired"));
      return;
    }
    // A 403 is not an expired session: reads keep working while writes are
    // refused. The common case is opening FlareMo from an address outside
    // FLAREMO_PUBLIC_URL / FLAREMO_TRUSTED_ORIGINS, which fails the Worker's
    // exact-Origin check on every cookie mutation.
    if (isUntrustedOriginError(error)) {
      toast.error(
        t("toast.untrustedOrigin", { origin: window.location.origin }),
      );
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
    onSuccess: (_data, id) => {
      toast.success(t("toast.movedToTrash"), {
        action: {
          label: t("common.undo"),
          onClick: () => {
            restoreMutation.mutate(id);
          },
        },
      });
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
    onSuccess: (_data, variables) => {
      if (variables.input.status === "archived") {
        toast.success(t("toast.saved"), {
          action: {
            label: t("common.undo"),
            onClick: () => {
              updateMutation.mutate({
                id: variables.id,
                input: { status: "normal" },
              });
            },
          },
        });
      } else {
        toast.success(t("toast.updated"));
      }
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

  // Visibility demoted from public: the link must not outlive the permission.
  const revokeShareMutation = useMutation({
    mutationFn: revokeShare,
    onSuccess: (_share, shareId) => {
      setSharesByMemo((current) => {
        const next = new Map(current);
        for (const [memoName, share] of current) {
          if (share.id === shareId) next.delete(memoName);
        }
        return next;
      });
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
    revokeShareMutation,
    sharesByMemo,
    shareMutation,
    trashMutation,
    updateMutation,
  };
}
