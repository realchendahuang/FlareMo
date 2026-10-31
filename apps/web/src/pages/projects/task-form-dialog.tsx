import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  createTask,
  listProjects,
  type Task,
  type TaskPriority,
  type TaskStatus,
  updateTask,
} from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { stripResourceName } from "@/lib/utils";
import { PRIORITY_BADGE, STATUS_COLUMNS } from "./constants";
import { patchTasksCache } from "./task-cache";

export function TaskFormDialog({
  task,
  defaultProjectId,
  defaultTitle,
  defaultDueAt,
  open,
  onSaved,
  onOpenChange,
}: {
  task?: Task;
  defaultProjectId?: string;
  /** New task only: what was already typed into the quick-add line. */
  defaultTitle?: string;
  defaultDueAt?: string;
  open: boolean;
  onSaved: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => listProjects(),
  });
  const [projectId, setProjectId] = useState<string>(
    task?.project_id ?? defaultProjectId ?? "",
  );
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [priority, setPriority] = useState<TaskPriority>(
    task?.priority ?? "none",
  );
  const [dueAt, setDueAt] = useState(task?.due_at ?? "");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "todo");

  // Seed on open instead of on mount: the dialog for a task stays mounted
  // (key = task.id) across refetches, and a refetch must not wipe what the
  // user is typing — but every fresh open starts from the latest task (7.5).
  useEffect(() => {
    if (open) {
      setProjectId(task?.project_id ?? defaultProjectId ?? "");
      setTitle(task?.title ?? defaultTitle ?? "");
      setNotes(task?.notes ?? "");
      setPriority(task?.priority ?? "none");
      setDueAt(task?.due_at ?? defaultDueAt ?? "");
      setStatus(task?.status ?? "todo");
    }
  }, [open, task, defaultProjectId, defaultTitle, defaultDueAt]);

  // Active projects to pick from; when editing, a task still pointing at an
  // archived project keeps that option so the value never disappears.
  const projectOptions = useMemo(() => {
    const all = projectsQuery.data?.projects ?? [];
    const live = all.filter(
      (project) => project.status === "active" && !project.deleted_at,
    );
    if (task?.project_id && !live.some((p) => p.id === task.project_id)) {
      const current = all.find((p) => p.id === task.project_id);
      if (current) return [current, ...live];
    }
    return live;
  }, [projectsQuery.data, task]);

  const saveMutation = useMutation({
    mutationFn: () =>
      task
        ? updateTask(stripResourceName(task.id, "tasks"), {
            title,
            notes,
            priority,
            due_at: dueAt || null,
            status,
            project_id: projectId || null,
          })
        : createTask({
            project_id: projectId || undefined,
            title,
            status: "todo",
            notes: notes || undefined,
            priority,
            due_at: dueAt || undefined,
          }),
    onMutate: async () => {
      if (!task) return undefined;
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks.all });
      const snapshots = queryClient.getQueriesData({
        queryKey: queryKeys.tasks.all,
      });
      const patch: Partial<Task> = {
        title: title.trim(),
        notes: notes || null,
        priority,
        due_at: dueAt || null,
        status,
        project_id: projectId || null,
      };
      if (status === "done" && task.status !== "done") {
        patch.completed_at = new Date().toISOString();
      }
      if (status !== "done" && task.status === "done") {
        patch.completed_at = null;
      }
      queryClient.setQueriesData(
        { queryKey: queryKeys.tasks.all },
        (data: unknown) => patchTasksCache(data, task.id, patch),
      );
      return snapshots;
    },
    onSuccess: (result) => {
      if (task) {
        // The server payload is authoritative: it lands project changes and
        // completed_at in the right cache rows after the optimistic patch.
        queryClient.setQueriesData(
          { queryKey: queryKeys.tasks.all },
          (data: unknown) => patchTasksCache(data, task.id, result.task),
        );
      }
      toast.success(t(task ? "toast.taskUpdated" : "toast.taskCreated"));
      onOpenChange(false);
      onSaved();
    },
    onError: (error, _input, snapshots) => {
      for (const [key, value] of snapshots ?? []) {
        queryClient.setQueryData(key, value);
      }
      toast.error(
        errorMessage(
          error,
          t(task ? "toast.taskUpdateFailed" : "toast.taskCreateFailed"),
        ),
      );
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {task ? t("projects.editTask") : t("projects.newTask")}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label={t("projects.field.project")}>
            <Select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">{t("projects.unassigned")}</option>
              {projectOptions.map((project) => (
                <option
                  key={project.id}
                  value={stripResourceName(project.id, "projects")}
                >
                  {project.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("projects.field.title")}>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {task && (
              <Field label={t("projects.field.status")}>
                <Select
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as TaskStatus)
                  }
                >
                  {STATUS_COLUMNS.map((value) => (
                    <option key={value} value={value}>
                      {t(`projects.status.${value}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={t("projects.field.priority")}>
              <Select
                value={priority}
                onChange={(event) =>
                  setPriority(event.target.value as TaskPriority)
                }
              >
                {(Object.keys(PRIORITY_BADGE) as TaskPriority[]).map(
                  (value) => (
                    <option key={value} value={value}>
                      {t(`projects.priority.${value}`)}
                    </option>
                  ),
                )}
              </Select>
            </Field>
            <Field label={t("projects.field.dueDate")}>
              <Input
                type="date"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </Field>
          </div>
          <Field label={t("projects.field.notes")}>
            <Textarea
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button
            disabled={!title.trim() || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
