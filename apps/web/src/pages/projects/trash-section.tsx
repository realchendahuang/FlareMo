import { useQuery } from "@tanstack/react-query";
import {
  ArchiveRestoreIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ListTodoIcon,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import { listProjects, listTasks, restoreProject, restoreTask } from "@/api";
import { QueryErrorState } from "@/components/query-error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { cn, stripResourceName } from "@/lib/utils";
import { COARSE_VISIBLE } from "./constants";

/**
 * Collapsible recycle bin under the project list: soft-deleted projects and
 * tasks surface here with one-click restore until the retention sweep
 * hard-deletes them.
 */
export function TrashSection({ onMutated }: { onMutated: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.trash,
    queryFn: () => listProjects({ include_deleted: true }),
  });
  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks.trash(),
    queryFn: () => listTasks({ include_deleted: true }),
  });

  const deletedProjects = useMemo(
    () => (projectsQuery.data?.projects ?? []).filter((p) => p.deleted_at),
    [projectsQuery.data],
  );
  const deletedTasks = useMemo(
    () => (tasksQuery.data?.tasks ?? []).filter((task) => task.deleted_at),
    [tasksQuery.data],
  );
  const count = deletedProjects.length + deletedTasks.length;

  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-border/60 pt-2">
      <button
        aria-expanded={open}
        className="flex h-8 items-center gap-2 rounded-lg px-3 text-xs text-muted-foreground hover:text-foreground"
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 motion-safe:transition-transform motion-safe:duration-150",
            !open && "-rotate-90 rtl:rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-start">
          {t("view.trash")}
        </span>
        {count > 0 && (
          <Badge className="tabular-nums" variant="secondary">
            {count}
          </Badge>
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-0.5">
          {(projectsQuery.isError || tasksQuery.isError) && (
            <QueryErrorState
              className="min-h-24 py-2 text-xs"
              onRetry={() => {
                if (projectsQuery.isError) void projectsQuery.refetch();
                if (tasksQuery.isError) void tasksQuery.refetch();
              }}
            />
          )}
          {!projectsQuery.isError &&
            !tasksQuery.isError &&
            (projectsQuery.isPending || tasksQuery.isPending) && (
              <p className="px-3 py-1 text-xs text-muted-foreground">
                {t("common.loading")}
              </p>
            )}
          {!projectsQuery.isError &&
            !tasksQuery.isError &&
            !projectsQuery.isPending &&
            !tasksQuery.isPending &&
            count === 0 && (
              <p className="px-3 py-1 text-xs text-muted-foreground">
                {t("projects.trashEmpty")}
              </p>
            )}
          {deletedProjects.map((project) => (
            <TrashRow
              icon={<ListTodoIcon className="size-3.5" />}
              key={project.id}
              label={project.name}
              restore={() =>
                restoreProject(stripResourceName(project.id, "projects"))
              }
              onMutated={onMutated}
            />
          ))}
          {deletedTasks.map((task) => (
            <TrashRow
              icon={<CheckCircle2Icon className="size-3.5" />}
              key={task.id}
              label={task.title}
              restore={() => restoreTask(stripResourceName(task.id, "tasks"))}
              onMutated={onMutated}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TrashRow({
  icon,
  label,
  restore,
  onMutated,
}: {
  icon: ReactNode;
  label: string;
  restore: () => Promise<unknown>;
  onMutated: () => void;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  return (
    <div className="group flex h-8 items-center gap-2 rounded-lg px-3 text-xs text-muted-foreground">
      {icon}
      <span className="min-w-0 flex-1 truncate line-through">{label}</span>
      <Button
        className={`h-6 px-2 text-xs opacity-0 group-hover:opacity-100 focus:opacity-100 ${COARSE_VISIBLE}`}
        disabled={pending}
        size="sm"
        type="button"
        variant="ghost"
        onClick={async () => {
          setPending(true);
          try {
            await restore();
            toast.success(t("toast.restored"));
            onMutated();
          } catch (error) {
            toast.error(errorMessage(error, t("toast.requestFailed")));
          } finally {
            setPending(false);
          }
        }}
      >
        <ArchiveRestoreIcon data-icon="inline-start" />
        {t("common.restore")}
      </Button>
    </div>
  );
}
