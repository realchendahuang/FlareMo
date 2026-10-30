import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { NotebookTextIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { type Task, updateTask } from "@/api";
import { formatScheduleDay } from "@/components/composer/composer-schedule-menu";
import { useI18n } from "@/i18n";
import { todayKey } from "@/lib/calendar-date";
import { errorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { cn, stripResourceName } from "@/lib/utils";
import { patchTasksCache } from "@/pages/projects/task-cache";

/**
 * One to-do as a checklist row: tick it, read where it came from (project,
 * source note) and when it slipped. Shared by the daily review and the
 * to-do views, so a task looks and behaves the same wherever it shows up.
 */
export function TaskRow({
  task,
  projectName,
  onEdit,
}: {
  task: Task;
  projectName?: string;
  /** Opens the full editor; the title becomes a button when given. */
  onEdit?: (task: Task) => void;
}) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const today = todayKey();
  // The box answers the click at once; the cache patch lands a tick later,
  // after the in-flight refetch is cancelled.
  const [pending, setPending] = useState<Task["status"] | null>(null);
  const done = (pending ?? task.status) === "done";
  const due = task.due_at?.slice(0, 10);
  const mutation = useMutation({
    mutationFn: (status: Task["status"]) =>
      updateTask(stripResourceName(task.id, "tasks"), { status }),
    onMutate: async (status) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks.all });
      const snapshots = queryClient.getQueriesData({
        queryKey: queryKeys.tasks.all,
      });
      queryClient.setQueriesData(
        { queryKey: queryKeys.tasks.all },
        (data: unknown) =>
          patchTasksCache(data, task.id, {
            status,
            completed_at: status === "done" ? new Date().toISOString() : null,
          }),
      );
      return snapshots;
    },
    onError: (error, _status, snapshots) => {
      for (const [key, value] of snapshots ?? []) {
        queryClient.setQueryData(key, value);
      }
      toast.error(errorMessage(error, t("toast.taskUpdateFailed")));
    },
    onSettled: () => {
      setPending(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      if (task.source_memo_id) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.memos.all });
      }
    },
  });
  const memoId = task.source_memo_id
    ? stripResourceName(task.source_memo_id, "memos")
    : null;
  return (
    <li className="flex items-start gap-2.5 px-3 py-2.5">
      <input
        aria-label={task.title}
        checked={done}
        className="task-checkbox mt-[3px] shrink-0"
        type="checkbox"
        onChange={() => {
          const next = done ? "todo" : "done";
          setPending(next);
          mutation.mutate(next);
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {onEdit ? (
          <button
            className={cn(
              "text-start text-sm hover:underline hover:decoration-border hover:underline-offset-4",
              done && "text-muted-foreground line-through",
            )}
            type="button"
            onClick={() => onEdit(task)}
          >
            {task.title}
          </button>
        ) : (
          <span
            className={cn(
              "text-sm",
              done && "text-muted-foreground line-through",
            )}
          >
            {task.title}
          </span>
        )}
        <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {due && due < today && !done && (
            <span className="text-destructive">
              {t("today.overdueSince", {
                date: formatScheduleDay(due, locale),
              })}
            </span>
          )}
          {projectName && <span className="truncate">{projectName}</span>}
          {memoId && (
            <Link
              className="inline-flex items-center gap-1 hover:text-foreground"
              params={{ memoId }}
              to="/memo/$memoId"
            >
              <NotebookTextIcon className="size-3" />
              {t("projects.fromMemo")}
            </Link>
          )}
        </span>
      </div>
    </li>
  );
}
