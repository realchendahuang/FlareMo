import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction, useMemo } from "react";
import { toast } from "sonner";
import type { Memo, MemoVisibility, Share } from "@/api";
import { createTask, getMemoContext, getRelatedMemos, listShares } from "@/api";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { getMemoResourceId } from "@/lib/memo";
import { toggleMemoTaskLine } from "@/lib/memo-tasks";
import { invalidateTaskSurfaces } from "@/lib/query-invalidation";
import { queryKeys } from "@/lib/query-keys";

/** Read-view task checkboxes: toggle one source line, or raise a task from it. */
export type MemoTaskInteraction = {
  onToggleTask: (lineIndex: number) => void;
  onConvertTask: (lineIndex: number, text: string) => void;
};

type UseMemoCardActionsOptions = {
  canManage: boolean;
  /** The in-progress edit body, owned by the card so cancel/save can read it. */
  draftContent: string;
  isTrashed: boolean;
  memo: Memo;
  onRevokeShare?: (share: Share) => void;
  onShare: (id: string) => Promise<Share>;
  onUpdate: (
    id: string,
    input: { content: string; visibility: MemoVisibility },
  ) => Promise<void>;
  /** The memo's live public link, when the list already knows it. */
  share?: Share;
  setIsEditing: Dispatch<SetStateAction<boolean>>;
  setIsSaving: Dispatch<SetStateAction<boolean>>;
};

/**
 * Behaviour layer of the timeline card: what it warms on hover, how it
 * rewrites a task line, how visibility moves up and down, and how an edit
 * saves. UI state stays in the card, so everything here is driven by props.
 */
export function useMemoCardActions({
  canManage,
  draftContent,
  isTrashed,
  memo,
  onRevokeShare,
  onShare,
  onUpdate,
  share,
  setIsEditing,
  setIsSaving,
}: UseMemoCardActionsOptions) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const id = getMemoResourceId(memo);

  // Hovering the title telegraphs "opening the detail page": warm its two
  // queries so the route paints with data instead of a full-page skeleton.
  const prefetchDetail = () => {
    void queryClient.prefetchQuery({
      queryKey: queryKeys.memoContext.forMemo(memo.id),
      queryFn: () => getMemoContext(memo.id),
    });
    void queryClient.prefetchQuery({
      queryKey: queryKeys.memoRelated.forMemo(memo.id),
      queryFn: () => getRelatedMemos(memo.id),
    });
  };

  // Task-list checkboxes are clickable for editors: LazyMemoContent maps the
  // rendered checkbox back to its source line and D2 rewrites just that
  // marker through the memo update mutation (optimistic, so it settles fast).
  const convertTaskMutation = useMutation({
    mutationFn: (title: string) =>
      createTask({ title, source_memo_id: memo.name }),
    onSuccess: () => {
      toast.success(t("toast.taskCreated"));
      invalidateTaskSurfaces(queryClient, { memoId: memo.name });
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.taskCreateFailed"))),
  });
  // `mutate` is stable across renders; the hook result object is not, so the
  // memoized interaction closes over the function, not the mutation state.
  const convertTask = convertTaskMutation.mutate;
  // Memoized because LazyMemoContent compares these callbacks by identity:
  // rebuilding them every render makes every expanded card re-run the whole
  // markdown pipeline on any parent state change.
  const taskInteraction: MemoTaskInteraction | undefined = useMemo(
    () =>
      !canManage || isTrashed
        ? undefined
        : {
            onToggleTask: (lineIndex: number) => {
              const next = toggleMemoTaskLine(memo.content, lineIndex);
              if (next) {
                void onUpdate(id, {
                  content: next,
                  visibility: memo.visibility,
                });
              }
            },
            onConvertTask: (_lineIndex: number, text: string) => {
              convertTask(text);
            },
          },
    [
      canManage,
      isTrashed,
      memo.content,
      memo.visibility,
      id,
      onUpdate,
      convertTask,
    ],
  );

  // Visibility is a property of the record, changed in place from the ⋯ menu.
  // Going public provisions the read-only link; stepping back down revokes it,
  // so a demoted memo never keeps a live public URL.
  const changeVisibility = async (visibility: MemoVisibility) => {
    if (visibility === memo.visibility) return;
    try {
      await onUpdate(id, {
        content: memo.content,
        visibility,
      });
      if (visibility === "public" && !share) await onShare(id);
      if (visibility !== "public") {
        if (share) {
          onRevokeShare?.(share);
        } else {
          // The card may not know the share (e.g. the memo was made public in
          // an earlier session): ask the server for the still-live links and
          // revoke every one, so demotion always kills the public URL.
          const { shares } = await listShares(memo.name);
          for (const liveShare of shares) onRevokeShare?.(liveShare);
        }
      }
    } catch {
      // The mutation displays the error; the card keeps its current state.
    }
  };

  const saveEditing = async () => {
    setIsSaving(true);
    try {
      await onUpdate(id, {
        content: draftContent,
        visibility: memo.visibility,
      });
      setIsEditing(false);
    } catch {
      // The mutation displays the error and the editor stays open.
    } finally {
      setIsSaving(false);
    }
  };

  return {
    changeVisibility,
    id,
    prefetchDetail,
    saveEditing,
    taskInteraction,
  };
}
