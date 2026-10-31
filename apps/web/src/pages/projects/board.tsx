import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useQueryClient } from "@tanstack/react-query";
import { ListChecksIcon } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import type { Project, Task, TaskStatus } from "@/api";
import { reorderTasks, updateTask } from "@/api";
import { QueryErrorState } from "@/components/query-error-state";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { cn, stripResourceName } from "@/lib/utils";
import { isStatusColumn, STATUS_COLUMNS } from "./constants";
import { patchTasksCacheMulti } from "./task-cache";
import { SortableTaskCard, StatusIcon, TaskCard } from "./task-card";

export function Board({
  hasError,
  isRetrying,
  loading,
  onRetry,
  projectById,
  selectedProject,
  tasks,
  onMutated,
  emptyState,
}: {
  hasError: boolean;
  isRetrying: boolean;
  loading: boolean;
  onRetry: () => void;
  projectById: Map<string, Project>;
  selectedProject: Project | null;
  tasks: Task[];
  onMutated: () => void;
  /** A smart view's own empty copy; the quick-add line above is its CTA. */
  emptyState?: { title: string; description: string };
}) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (hasError) {
    return (
      <QueryErrorState
        className="min-h-56"
        isRetrying={isRetrying}
        onRetry={onRetry}
      />
    );
  }

  if (tasks.length === 0 && emptyState) {
    return (
      <Empty className="min-h-56 border">
        <EmptyHeader>
          <EmptyTitle>{emptyState.title}</EmptyTitle>
          <EmptyDescription>{emptyState.description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  // The quick-add row sits right above the board, so empty states only
  // explain; they do not repeat the create buttons.
  if (tasks.length === 0) {
    const inProject = Boolean(selectedProject);
    return (
      <Empty className="min-h-56 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListChecksIcon />
          </EmptyMedia>
          <EmptyTitle>
            {inProject
              ? t("projects.tasksEmptyTitle")
              : t("projects.allTasksEmptyTitle")}
          </EmptyTitle>
          <EmptyDescription>
            {inProject
              ? t("projects.tasksEmptyDescription")
              : t("projects.allTasksEmptyDescription")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <TaskBoard
      projectById={projectById}
      selectedProject={selectedProject}
      tasks={tasks}
      onMutated={onMutated}
    />
  );
}

/**
 * The kanban board. Drag-and-drop is project-scoped: sort_order lives per
 * project on the server, so the mixed "全部任务" board stays read-only.
 */
function TaskBoard({
  projectById,
  selectedProject,
  tasks,
  onMutated,
}: {
  projectById: Map<string, Project>;
  selectedProject: Project | null;
  tasks: Task[];
  onMutated: () => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const interactive = Boolean(selectedProject);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const tasksById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );

  /** Diff two board snapshots into per-task patches for every task cache. */
  const boardPatches = (nextTasks: Task[]) => {
    const patches = new Map<string, Partial<Task>>();
    for (const task of nextTasks) {
      const previous = tasksById.get(task.id);
      if (
        !previous ||
        (previous.status === task.status &&
          previous.sort_order === task.sort_order)
      ) {
        continue;
      }
      const patch: Partial<Task> = {
        status: task.status,
        sort_order: task.sort_order,
      };
      if (task.status === "done" && previous.status !== "done") {
        patch.completed_at = new Date().toISOString();
      }
      if (task.status !== "done" && previous.status === "done") {
        patch.completed_at = null;
      }
      patches.set(task.id, patch);
    }
    return patches;
  };

  const applyBoardChange = (nextTasks: Task[]) => {
    // Per-id status/order patch reaches every ["tasks…"] cache (agenda, mini
    // calendar, search…); then the project board list is fully replaced so
    // the drop lands exactly where the pointer left it.
    queryClient.setQueriesData(
      { queryKey: queryKeys.tasks.all },
      (data: unknown) => patchTasksCacheMulti(data, boardPatches(nextTasks)),
    );
    if (selectedProject) {
      queryClient.setQueryData(queryKeys.tasks.byProject(selectedProject.id), {
        tasks: nextTasks,
      });
    }
  };

  const rollbackBoard = () => {
    queryClient.setQueriesData(
      { queryKey: queryKeys.tasks.all },
      (data: unknown) =>
        patchTasksCacheMulti(
          data,
          new Map(
            tasks.map((task) => [
              task.id,
              {
                status: task.status,
                sort_order: task.sort_order,
                completed_at: task.completed_at,
              } satisfies Partial<Task>,
            ]),
          ),
        ),
    );
    if (selectedProject) {
      queryClient.setQueryData(queryKeys.tasks.byProject(selectedProject.id), {
        tasks,
      });
    }
  };

  const commit = async (
    nextTasks: Task[],
    statusUpdate: { id: string; status: TaskStatus } | null,
  ) => {
    applyBoardChange(nextTasks);
    try {
      if (statusUpdate) {
        await updateTask(stripResourceName(statusUpdate.id, "tasks"), {
          status: statusUpdate.status,
        });
      }
      if (selectedProject) {
        await reorderTasks(
          stripResourceName(selectedProject.id, "projects"),
          nextTasks.map((task) => task.id),
        );
      }
      onMutated();
    } catch (error) {
      rollbackBoard();
      onMutated();
      toast.error(errorMessage(error, t("toast.taskUpdateFailed")));
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeTask = tasksById.get(String(active.id));
    if (!activeTask || !selectedProject) return;
    const overId = String(over.id);
    const overTask = tasksById.get(overId);
    const targetStatus: TaskStatus | null = isStatusColumn(overId)
      ? (overId as TaskStatus)
      : (overTask?.status ?? null);
    if (!targetStatus) return;

    const sourceColumn = tasks.filter(
      (task) => task.status === activeTask.status,
    );
    const targetColumn = tasks.filter((task) => task.status === targetStatus);
    const rest = tasks.filter(
      (task) =>
        task.status !== activeTask.status && task.status !== targetStatus,
    );

    if (targetStatus === activeTask.status) {
      const oldIndex = sourceColumn.findIndex(
        (task) => task.id === activeTask.id,
      );
      const newIndex = sourceColumn.findIndex((task) => task.id === overId);
      if (oldIndex < 0 || newIndex < 0) return;
      const column = arrayMove(sourceColumn, oldIndex, newIndex);
      void commit([...rest, ...column], null);
      return;
    }

    // Cross column: insert above the hovered card, or at the end when the
    // drop target is the (possibly empty) column itself.
    let nextTarget: Task[];
    if (!overTask) {
      nextTarget = [{ ...activeTask, status: targetStatus }, ...targetColumn];
    } else {
      const overIndex = targetColumn.findIndex((task) => task.id === overId);
      nextTarget = [
        ...targetColumn.slice(0, overIndex),
        { ...activeTask, status: targetStatus },
        ...targetColumn.slice(overIndex),
      ];
    }
    const nextSource = sourceColumn.filter((task) => task.id !== activeTask.id);
    void commit([...rest, ...nextSource, ...nextTarget], {
      id: activeTask.id,
      status: targetStatus,
    });
  };

  return (
    <DndContext
      collisionDetection={closestCenter}
      sensors={sensors}
      onDragEnd={onDragEnd}
    >
      {/* Column count follows the space the board actually gets, not the
          viewport: the sidebar eats 312px, so a 1024px window leaves 416px
          for three columns (130px each, titles breaking every word). */}
      <div className="@container">
        <div className="grid grid-cols-1 gap-3 @min-[380px]:grid-cols-2 @min-[620px]:grid-cols-3">
          {STATUS_COLUMNS.map((status) => (
            <TaskColumn
              interactive={interactive}
              key={status}
              projectById={projectById}
              selectedProjectId={selectedProject?.id ?? null}
              status={status}
              tasks={tasks.filter((task) => task.status === status)}
              onMutated={onMutated}
            />
          ))}
        </div>
      </div>
    </DndContext>
  );
}

function TaskColumn({
  interactive,
  projectById,
  selectedProjectId,
  status,
  tasks,
  onMutated,
}: {
  interactive: boolean;
  projectById: Map<string, Project>;
  selectedProjectId: string | null;
  status: TaskStatus;
  tasks: Task[];
  onMutated: () => void;
}) {
  const { t } = useI18n();
  const { isOver, setNodeRef } = useDroppable({
    id: status,
    disabled: !interactive,
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <StatusIcon status={status} />
        <span className="text-sm font-medium">
          {t(`projects.status.${status}`)}
        </span>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <div
        className={cn(
          "flex min-h-16 flex-col gap-2 rounded-lg motion-safe:transition-colors motion-safe:duration-150",
          interactive && isOver && "bg-muted/40",
        )}
        ref={setNodeRef}
      >
        <SortableContext
          items={tasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) =>
            interactive ? (
              <SortableTaskCard
                key={task.id}
                projectName={
                  selectedProjectId
                    ? null
                    : (projectById.get(task.project_id ?? "")?.name ?? null)
                }
                task={task}
                onMutated={onMutated}
              />
            ) : (
              <TaskCard
                key={task.id}
                projectName={
                  selectedProjectId
                    ? null
                    : (projectById.get(task.project_id ?? "")?.name ?? null)
                }
                task={task}
                onMutated={onMutated}
              />
            ),
          )}
        </SortableContext>
      </div>
    </div>
  );
}
