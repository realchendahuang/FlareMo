import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CalendarDaysIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  CircleIcon,
  FlagIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  NotebookTextIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { type CSSProperties, useState } from "react";
import { toast } from "sonner";
import { deleteTask, type Task, type TaskStatus, updateTask } from "@/api";
import { formatScheduleDay } from "@/components/composer/composer-schedule-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { todayKey } from "@/lib/calendar-date";
import { errorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { cn, stripResourceName } from "@/lib/utils";
import {
  ADVANCE_KEY,
  ADVANCE_TARGET,
  COARSE_VISIBLE,
  MORE_BUTTON_CLASS,
  PRIORITY_BADGE,
  STATUS_COLUMNS,
} from "./constants";
import { patchTasksCache } from "./task-cache";
import { TaskFormDialog } from "./task-form-dialog";

export function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === "done") {
    return <CheckCircle2Icon className="size-4 text-muted-foreground" />;
  }
  if (status === "in_progress") {
    return <CircleDotIcon className="size-4 text-brand-500" />;
  }
  return <CircleIcon className="size-4 text-muted-foreground" />;
}

export function TaskCard({
  interactive = false,
  projectName,
  task,
  onMutated,
}: {
  interactive?: boolean;
  projectName: string | null;
  task: Task;
  onMutated: () => void;
}) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Optimistic status flips so slow connections still feel instant; the
  // board re-syncs from the server on settle.
  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateTask>[1]) =>
      updateTask(stripResourceName(task.id, "tasks"), input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks.all });
      const snapshots = queryClient.getQueriesData({
        queryKey: queryKeys.tasks.all,
      });
      queryClient.setQueriesData(
        { queryKey: queryKeys.tasks.all },
        (data: unknown) => patchTasksCache(data, task.id, input),
      );
      return snapshots;
    },
    onSuccess: (_data, input) => {
      onMutated();
      // Completing a task ticks its line in the source memo on the server.
      if (task.source_memo_id && input.status !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.memos.all });
        void queryClient.invalidateQueries({ queryKey: ["memo-context"] });
      }
    },
    onError: (error, _input, snapshots) => {
      for (const [key, value] of snapshots ?? []) {
        queryClient.setQueryData(key, value);
      }
      toast.error(errorMessage(error, t("toast.taskUpdateFailed")));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTask(stripResourceName(task.id, "tasks")),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks.all });
      const snapshots = queryClient.getQueriesData({
        queryKey: queryKeys.tasks.all,
      });
      queryClient.setQueriesData(
        { queryKey: queryKeys.tasks.all },
        (data: unknown) => patchTasksCache(data, task.id, null),
      );
      return snapshots;
    },
    onSuccess: () => {
      toast.success(t("toast.taskDeleted"));
      onMutated();
    },
    onError: (error, _input, snapshots) => {
      for (const [key, value] of snapshots ?? []) {
        queryClient.setQueryData(key, value);
      }
      toast.error(errorMessage(error, t("toast.taskDeleteFailed")));
    },
  });

  const advance = () => {
    const next = ADVANCE_TARGET[task.status];
    updateMutation.mutate(
      { status: next },
      {
        onSuccess: () =>
          toast.success(t(ADVANCE_KEY[task.status]), {
            action: {
              label: t("common.undo"),
              onClick: () => updateMutation.mutate({ status: task.status }),
            },
          }),
      },
    );
  };

  const sourceMemoId = task.source_memo_id
    ? stripResourceName(task.source_memo_id, "memos")
    : null;
  const showUnassigned = !projectName && !task.project_id;
  const hasMeta = Boolean(projectName || showUnassigned || sourceMemoId);

  return (
    <>
      <Card
        className={cn(
          "group",
          interactive && "cursor-grab active:cursor-grabbing",
        )}
        size="sm"
      >
        <CardContent className="flex flex-col gap-2">
          {/* Only when there is something to say: an empty meta row left a
              blank band above the title on every project board card. */}
          {hasMeta && (
            <div className="flex items-center gap-1.5">
              {projectName && (
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {projectName}
                </span>
              )}
              {showUnassigned && (
                <Badge variant="outline">{t("projects.unassigned")}</Badge>
              )}
              {sourceMemoId && (
                <Badge
                  render={
                    <Link
                      params={{ memoId: sourceMemoId }}
                      title={t("projects.fromMemo")}
                      to="/memo/$memoId"
                    />
                  }
                  variant="outline"
                >
                  <NotebookTextIcon />
                  {t("projects.fromMemo")}
                </Badge>
              )}
            </div>
          )}
          <div className="flex items-start gap-2">
            <button
              aria-label={t(ADVANCE_KEY[task.status])}
              className="mt-0.5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
              title={t(ADVANCE_KEY[task.status])}
              type="button"
              onClick={advance}
            >
              <StatusIcon status={task.status} />
            </button>
            <span
              className={
                "min-w-0 flex-1 text-sm " +
                (task.status === "done"
                  ? "text-muted-foreground line-through"
                  : "")
              }
            >
              {task.title}
            </span>
            {interactive && (
              <GripVerticalIcon
                aria-hidden="true"
                className={cn(
                  "mt-1 size-3.5 shrink-0 text-muted-foreground/40 opacity-0 group-hover:opacity-100",
                  COARSE_VISIBLE,
                )}
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    className={cn(MORE_BUTTON_CLASS, "-my-1 -me-1")}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <MoreHorizontalIcon />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{t("projects.setStatus")}</DropdownMenuLabel>
                {STATUS_COLUMNS.map((status) => (
                  <DropdownMenuItem
                    key={status}
                    onClick={() =>
                      updateMutation.mutate(
                        { status },
                        {
                          onSuccess: () =>
                            toast.success(t("toast.taskUpdated")),
                        },
                      )
                    }
                  >
                    <StatusIcon status={status} />
                    {t(`projects.status.${status}`)}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setEditing(true)}>
                  <PencilIcon data-icon="inline-start" />
                  {t("common.edit")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2Icon data-icon="inline-start" />
                  {t("common.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {(task.priority !== "none" || task.due_at) && (
            <div className="flex flex-wrap items-center gap-2">
              {task.priority !== "none" && (
                <Badge variant={PRIORITY_BADGE[task.priority]}>
                  <FlagIcon data-icon="inline-start" />
                  {t(`projects.priority.${task.priority}`)}
                </Badge>
              )}
              {task.due_at && (
                <span
                  className={cn(
                    "flex items-center gap-1 text-xs text-muted-foreground",
                    task.status !== "done" &&
                      task.due_at.slice(0, 10) < todayKey() &&
                      "text-destructive",
                  )}
                >
                  <CalendarDaysIcon aria-hidden="true" className="size-3.5" />
                  {task.due_at.slice(0, 10) === todayKey()
                    ? t("composer.schedule.today")
                    : formatScheduleDay(task.due_at.slice(0, 10), locale)}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <TaskFormDialog
        key={task.id}
        open={editing}
        task={task}
        onOpenChange={setEditing}
        onSaved={onMutated}
      />
      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("projects.deleteTaskTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("projects.deleteTaskDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              variant="destructive"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function SortableTaskCard(props: {
  projectName: string | null;
  task: Task;
  onMutated: () => void;
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: props.task.id });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn("rounded-xl", isDragging && "relative z-10 opacity-70")}
    >
      <TaskCard {...props} interactive />
    </div>
  );
}
