import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  createMemoryFromMemo,
  createShare,
  createTask,
  getMemoContext,
  getRelatedMemos,
  listMemos,
  replaceMemoRelations,
  restoreMemoRevision,
  revokeShare,
  updateMemo,
} from "@/api";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { toggleMemoTaskLine } from "@/lib/memo-tasks";
import { queryKeys } from "@/lib/query-keys";
import type { MemoDetailTaskInteraction } from "./content-tab";

/**
 * The detail page's whole data layer: the three queries the page needs to
 * paint, the seven mutations its actions fire, and the read view's to-do
 * wiring. Keeping it here leaves MemoDetailPage as the shell (loading/error/
 * loaded branches) and MemoDetail as the tab container.
 */
export function useMemoDetail(memoId: string) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [relatedMemo, setRelatedMemo] = useState("");
  const queryKey = ["memo-context", memoId] as const;
  const contextQuery = useQuery({
    queryKey,
    queryFn: () => getMemoContext(memoId),
    retry: false,
  });
  const relationCandidatesQuery = useQuery({
    queryKey: ["relation-candidates", relatedMemo.trim()],
    queryFn: () => listMemos({ q: relatedMemo.trim(), page_size: 8 }),
    enabled: relatedMemo.trim().length >= 2,
  });
  const relatedQuery = useQuery({
    queryKey: ["memo-related", memoId],
    queryFn: () => getRelatedMemos(memoId),
    retry: false,
  });
  const invalidateMemo = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      queryClient.invalidateQueries({ queryKey: ["memo-related", memoId] }),
      queryClient.invalidateQueries({ queryKey: ["memos"] }),
      queryClient.invalidateQueries({ queryKey: ["memo-stats"] }),
    ]);
  };
  const shareMutation = useMutation({
    mutationFn: () => createShare(contextQuery.data?.memo.name ?? memoId),
    onSuccess: async () => {
      toast.success(t("toast.shareCreated"));
      await invalidateMemo();
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.requestFailed"))),
  });
  const revokeMutation = useMutation({
    mutationFn: revokeShare,
    onSuccess: async () => {
      toast.success(t("toast.shareRevoked"));
      await invalidateMemo();
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.requestFailed"))),
  });
  const restoreMutation = useMutation({
    mutationFn: (revision: string) =>
      restoreMemoRevision(contextQuery.data?.memo.name ?? memoId, revision),
    onSuccess: async (memo) => {
      queryClient.setQueryData<Awaited<ReturnType<typeof getMemoContext>>>(
        queryKey,
        (context) => (context ? { ...context, memo } : context),
      );
      toast.success(t("toast.revisionRestored"));
      await invalidateMemo();
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.requestFailed"))),
  });
  const relationMutation = useMutation({
    mutationFn: ({
      relations,
    }: {
      action: "add" | "remove";
      relations: Array<{
        related_memo: string;
        type: "reference" | "comment";
      }>;
    }) =>
      replaceMemoRelations(contextQuery.data?.memo.name ?? memoId, relations),
    onSuccess: async (_data, variables) => {
      setRelatedMemo("");
      toast.success(
        t(
          variables.action === "add"
            ? "toast.relationAdded"
            : "toast.relationRemoved",
        ),
      );
      await invalidateMemo();
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.requestFailed"))),
  });

  const rememberMutation = useMutation({
    mutationFn: () =>
      createMemoryFromMemo(contextQuery.data?.memo.name ?? memoId, {
        type: "semantic",
        kind: "fact",
        scope_type: "global",
        tier: "normal",
        importance: 50,
      }),
    onSuccess: async (result) => {
      toast.success(
        result.duplicate ? t("toast.memoryConfirmed") : t("toast.saved"),
      );
      await queryClient.invalidateQueries({ queryKey });
      // The memory page caches under ["memories"]; without this the new
      // memory stays invisible there until an unrelated action.
      await queryClient.invalidateQueries({ queryKey: ["memories"] });
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.requestFailed"))),
  });

  // D2: the read view's to-dos are live. A checkbox click rewrites its one
  // Markdown line (optimistic on the detail cache); a to-do line can be
  // upgraded into a task linked back to this memo.
  const toggleTaskMutation = useMutation({
    mutationFn: (lineIndex: number) => {
      const memo = contextQuery.data?.memo;
      if (!memo) throw new Error("Memo unavailable");
      const content = toggleMemoTaskLine(memo.content, lineIndex);
      if (!content) throw new Error("Not a task line");
      return updateMemo(memo.name, { content, visibility: memo.visibility });
    },
    onMutate: (lineIndex) => {
      const memo = contextQuery.data?.memo;
      if (!memo) return;
      const content = toggleMemoTaskLine(memo.content, lineIndex);
      if (content) {
        queryClient.setQueryData<Awaited<ReturnType<typeof getMemoContext>>>(
          queryKey,
          (context) =>
            context ? { ...context, memo: { ...memo, content } } : context,
        );
        return { previousContent: memo.content };
      }
    },
    onSuccess: async () => {
      await invalidateMemo();
    },
    onError: (error, _lineIndex, context) => {
      // The checkbox already moved; put the line back before telling the
      // user the write failed, or the detail view stays out of sync.
      if (context?.previousContent) {
        queryClient.setQueryData<Awaited<ReturnType<typeof getMemoContext>>>(
          queryKey,
          (current) =>
            current
              ? {
                  ...current,
                  memo: { ...current.memo, content: context.previousContent },
                }
              : current,
        );
      }
      void invalidateMemo();
      toast.error(errorMessage(error, t("toast.requestFailed")));
    },
  });
  const convertTaskMutation = useMutation({
    mutationFn: (title: string) =>
      createTask({
        title,
        source_memo_id: contextQuery.data?.memo.name ?? `memos/${memoId}`,
      }),
    onSuccess: () => {
      toast.success(t("toast.taskCreated"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.taskCreateFailed"))),
  });
  const taskInteraction: MemoDetailTaskInteraction | undefined = contextQuery
    .data?.can_manage
    ? {
        onToggleTask: (lineIndex: number) =>
          toggleTaskMutation.mutate(lineIndex),
        onConvertTask: (_lineIndex: number, text: string) =>
          convertTaskMutation.mutate(text),
      }
    : undefined;

  return {
    contextQuery,
    relationCandidatesQuery,
    relatedQuery,
    relatedMemo,
    setRelatedMemo,
    shareMutation,
    revokeMutation,
    restoreMutation,
    relationMutation,
    rememberMutation,
    taskInteraction,
  };
}
