import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  CalendarRangeIcon,
  ListChecksIcon,
  ListTodoIcon,
  SunIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { listAllTasks, listProjects } from "@/api";
import {
  SEGMENT_ACTIVE_CLASS,
  SEGMENT_CLASS,
  SEGMENT_TRACK_CLASS,
} from "@/components/nav-item-styles";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { WorkspacePageHeader } from "@/components/workspace/workspace-page-header";
import { type TranslationKey, useI18n } from "@/i18n";
import { todayKey } from "@/lib/calendar-date";
import { queryKeys } from "@/lib/query-keys";
import {
  openCountInView,
  type TaskView,
  taskInView,
  useAllTasks,
} from "@/lib/task-views";
import { cn, stripResourceName } from "@/lib/utils";
import { Board } from "./projects/board";
import { ProjectFormDialog } from "./projects/project-form-dialog";
import { ProjectMenu } from "./projects/project-menu";
import { ProjectPicker } from "./projects/project-picker";
import { QuickAddTask } from "./projects/quick-add-task";
import { TaskFormDialog } from "./projects/task-form-dialog";
import { TaskList } from "./projects/task-list";
import { TrashSection } from "./projects/trash-section";

const VIEW_META: Record<
  TaskView,
  {
    label: TranslationKey;
    /** Narrow screens: the label without its qualifier. */
    shortLabel: TranslationKey;
    hint: TranslationKey;
    emptyTitle: TranslationKey;
    emptyDescription: TranslationKey;
    icon: typeof SunIcon;
  }
> = {
  today: {
    label: "projects.view.today",
    shortLabel: "projects.view.today",
    hint: "projects.view.todayHint",
    emptyTitle: "projects.view.todayEmptyTitle",
    emptyDescription: "projects.view.todayEmptyDescription",
    icon: SunIcon,
  },
  upcoming: {
    label: "projects.view.upcoming",
    shortLabel: "projects.view.upcomingShort",
    hint: "projects.view.upcomingHint",
    emptyTitle: "projects.view.upcomingEmptyTitle",
    emptyDescription: "projects.view.upcomingEmptyDescription",
    icon: CalendarRangeIcon,
  },
  all: {
    label: "projects.allTasks",
    shortLabel: "projects.allTasksShort",
    hint: "projects.view.allHint",
    emptyTitle: "projects.allTasksEmptyTitle",
    emptyDescription: "projects.allTasksEmptyDescription",
    icon: ListTodoIcon,
  },
};

const VIEW_ORDER: TaskView[] = ["today", "upcoming", "all"];

/**
 * The date views as a segmented switch in the page header: when a task is
 * due is how the list is cut, so it reads as a filter, not as a second
 * sidebar beside the workspace one.
 */
function ViewTabs({
  counts,
  view,
  onChange,
}: {
  counts: Record<TaskView, number>;
  view: TaskView;
  onChange: (view: TaskView) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      aria-label={t("projects.viewsLabel")}
      className={SEGMENT_TRACK_CLASS}
      role="tablist"
    >
      {VIEW_ORDER.map((item) => (
        <button
          aria-selected={view === item}
          className={cn(SEGMENT_CLASS, view === item && SEGMENT_ACTIVE_CLASS)}
          key={item}
          role="tab"
          type="button"
          onClick={() => onChange(item)}
        >
          <span className="sm:hidden">{t(VIEW_META[item].shortLabel)}</span>
          <span className="hidden sm:inline">{t(VIEW_META[item].label)}</span>
          {counts[item] > 0 && (
            <span className="text-xs font-normal text-muted-foreground tabular-nums">
              {counts[item]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * To-dos and projects in one column. "When" (today, the next seven days,
 * everything) is the header's switch; "where" (a project) is a picker over
 * the list, and the two combine. Below them, a one-line quick add over the
 * list or board. Notes feed it: a scheduled note files its to-dos here, each
 * card links back to its note, and ticking either side ticks the other.
 */
export function ProjectsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: "/projects" });
  const search = useSearch({ from: "/workspace/projects" });
  const [creatingProject, setCreatingProject] = useState(false);
  // The quick-add line's expand button hands over what was typed.
  const [creatingTask, setCreatingTask] = useState<{
    title: string;
    dueAt?: string;
  } | null>(null);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => listProjects(),
  });
  const allTasksQuery = useAllTasks();
  const allTasks = useMemo(
    () => allTasksQuery.data?.tasks ?? [],
    [allTasksQuery.data],
  );

  const projects = useMemo(
    () => projectsQuery.data?.projects ?? [],
    [projectsQuery.data],
  );
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );

  const selectedProjectId = search.project
    ? `projects/${stripResourceName(search.project, "projects")}`
    : null;
  const selectedProject = selectedProjectId
    ? (projectById.get(selectedProjectId) ?? null)
    : null;

  // Everything below is scoped to the picked project, counts included, so
  // the header's numbers always describe the list under them.
  const scopedTasks = useMemo(
    () =>
      selectedProjectId
        ? allTasks.filter((task) => task.project_id === selectedProjectId)
        : allTasks,
    [allTasks, selectedProjectId],
  );
  const counts = useMemo(
    () => ({
      today: openCountInView(scopedTasks, "today"),
      upcoming: openCountInView(scopedTasks, "upcoming"),
      all: openCountInView(scopedTasks, "all"),
    }),
    [scopedTasks],
  );
  // Landing without a choice opens "today" when something is due, so the
  // page answers "what now?" first; a project opens on its whole board.
  const view: TaskView =
    search.view ?? (!selectedProjectId && counts.today > 0 ? "today" : "all");

  // A project's board keeps its own (sortable) query; the date views slice
  // the shared all-tasks cache.
  const boardInProject = Boolean(selectedProjectId) && view === "all";
  const projectTasksQuery = useQuery({
    queryKey: queryKeys.tasks.byProject(selectedProjectId ?? ""),
    queryFn: () => listAllTasks({ project_id: selectedProjectId ?? "" }),
    enabled: boardInProject,
  });
  const tasks = useMemo(() => {
    if (boardInProject) return projectTasksQuery.data?.tasks ?? [];
    const today = todayKey();
    return scopedTasks.filter((task) => taskInView(task, view, today));
  }, [boardInProject, projectTasksQuery.data, scopedTasks, view]);
  const activeQuery = boardInProject ? projectTasksQuery : allTasksQuery;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
  };

  const openView = (next: TaskView) =>
    void navigate({ search: { view: next, project: search.project } });
  const openProject = (id: string | null) =>
    void navigate({
      search: {
        view: search.view,
        project: id ? stripResourceName(id, "projects") : undefined,
      },
    });

  // A deleted (or otherwise vanished) project must never leave the board
  // pointed at a filter that matches nothing: fall back to every project.
  useEffect(() => {
    if (!projectsQuery.data || !selectedProjectId) return;
    if (!projectById.has(selectedProjectId)) {
      void navigate({ search: { view: search.view, project: undefined } });
    }
  }, [
    selectedProjectId,
    projectById,
    projectsQuery.data,
    navigate,
    search.view,
  ]);

  const meta = VIEW_META[view];

  return (
    <WorkspaceLayout
      contentMaxWidth={768}
      header={({
        sidebarCollapsed,
        toggleSidebarCollapsed,
        mobileSheetOpen,
        setMobileSheetOpen,
        explorer,
      }) => (
        <WorkspacePageHeader
          actions={<ViewTabs counts={counts} view={view} onChange={openView} />}
          explorer={explorer}
          icon={
            <ListChecksIcon className="size-4 shrink-0 text-brand-600 dark:text-brand-400" />
          }
          mobileSheetOpen={mobileSheetOpen}
          setMobileSheetOpen={setMobileSheetOpen}
          sidebarCollapsed={sidebarCollapsed}
          title={t("nav.projects")}
          toggleSidebarCollapsed={toggleSidebarCollapsed}
        />
      )}
    >
      <div className="flex flex-col gap-3 py-2">
        <div className="flex min-w-0 items-center gap-1">
          <ProjectPicker
            projects={projects}
            selected={selectedProject}
            onCreate={() => setCreatingProject(true)}
            onSelect={openProject}
          />
          {selectedProject && (
            <ProjectMenu
              project={selectedProject}
              onDeleted={() => openProject(null)}
              onMutated={invalidate}
            />
          )}
          <p className="ms-auto hidden min-w-0 truncate ps-3 text-xs text-muted-foreground sm:block">
            {selectedProject?.description || t(meta.hint)}
          </p>
        </div>

        <QuickAddTask
          project={selectedProject}
          view={view}
          onCreated={invalidate}
          onExpand={setCreatingTask}
        />

        {view !== "all" && tasks.length > 0 ? (
          <TaskList
            projectById={projectById}
            tasks={tasks}
            onMutated={invalidate}
          />
        ) : (
          <Board
            emptyState={
              view === "all"
                ? undefined
                : {
                    title: t(meta.emptyTitle),
                    description: t(meta.emptyDescription),
                  }
            }
            hasError={activeQuery.isError && !activeQuery.data}
            isRetrying={activeQuery.isRefetching}
            loading={activeQuery.isLoading}
            projectById={projectById}
            selectedProject={selectedProject}
            tasks={tasks}
            onRetry={() => void activeQuery.refetch()}
            onMutated={invalidate}
          />
        )}

        <TrashSection onMutated={invalidate} />

        <ProjectFormDialog
          open={creatingProject}
          onOpenChange={setCreatingProject}
          onSaved={invalidate}
        />
        <TaskFormDialog
          defaultDueAt={creatingTask?.dueAt}
          defaultProjectId={selectedProject?.id}
          defaultTitle={creatingTask?.title}
          open={creatingTask !== null}
          onOpenChange={(open) => {
            if (!open) setCreatingTask(null);
          }}
          onSaved={invalidate}
        />
      </div>
    </WorkspaceLayout>
  );
}
