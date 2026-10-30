import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  CalendarRangeIcon,
  ListChecksIcon,
  ListTodoIcon,
  PlusIcon,
  SunIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { listAllTasks, listProjects } from "@/api";
import {
  NAV_ACTIVE_CLASS,
  NAV_COUNT_CLASS,
  NAV_ITEM_CLASS,
} from "@/components/nav-item-styles";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { ProjectRow } from "./projects/project-row";
import { QuickAddTask } from "./projects/quick-add-task";
import { TaskFormDialog } from "./projects/task-form-dialog";
import { TaskList } from "./projects/task-list";
import { TrashSection } from "./projects/trash-section";

const VIEW_META: Record<
  TaskView,
  {
    label: TranslationKey;
    hint: TranslationKey;
    emptyTitle: TranslationKey;
    emptyDescription: TranslationKey;
    icon: typeof SunIcon;
  }
> = {
  today: {
    label: "projects.view.today",
    hint: "projects.view.todayHint",
    emptyTitle: "projects.view.todayEmptyTitle",
    emptyDescription: "projects.view.todayEmptyDescription",
    icon: SunIcon,
  },
  upcoming: {
    label: "projects.view.upcoming",
    hint: "projects.view.upcomingHint",
    emptyTitle: "projects.view.upcomingEmptyTitle",
    emptyDescription: "projects.view.upcomingEmptyDescription",
    icon: CalendarRangeIcon,
  },
  all: {
    label: "projects.allTasks",
    hint: "projects.view.allHint",
    emptyTitle: "projects.allTasksEmptyTitle",
    emptyDescription: "projects.allTasksEmptyDescription",
    icon: ListTodoIcon,
  },
};

const VIEW_ORDER: TaskView[] = ["today", "upcoming", "all"];

function SideRow({
  active,
  count,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={cn(
        NAV_ITEM_CLASS,
        "shrink-0 whitespace-nowrap",
        active && NAV_ACTIVE_CLASS,
      )}
      type="button"
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {count > 0 && <span className={NAV_COUNT_CLASS}>{count}</span>}
    </button>
  );
}

function SideHeading({ children }: { children: ReactNode }) {
  return (
    <p className="hidden px-2.5 pt-3 pb-1 text-xs font-medium text-muted-foreground lg:block">
      {children}
    </p>
  );
}

/**
 * To-dos and projects in one place. Down the side, "when" (today, the next
 * seven days, everything) above "where" (projects); the main column is the
 * chosen list with a one-line quick add over the board. Notes feed it: a
 * scheduled note files its to-dos here, each card links back to its note,
 * and ticking either side ticks the other.
 */
export function ProjectsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: "/projects" });
  const search = useSearch({ from: "/workspace/projects" });
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);

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

  const counts = useMemo(
    () => ({
      today: openCountInView(allTasks, "today"),
      upcoming: openCountInView(allTasks, "upcoming"),
      all: openCountInView(allTasks, "all"),
    }),
    [allTasks],
  );
  // Landing without a choice opens "today" when something is due, so the
  // page answers "what now?" first; otherwise the full list.
  const view: TaskView = search.view ?? (counts.today > 0 ? "today" : "all");

  // A project board keeps its own (sortable) query; views slice the shared
  // all-tasks cache.
  const projectTasksQuery = useQuery({
    queryKey: queryKeys.tasks.byProject(selectedProjectId ?? ""),
    queryFn: () => listAllTasks({ project_id: selectedProjectId ?? "" }),
    enabled: Boolean(selectedProjectId),
  });
  const tasks = useMemo(() => {
    if (selectedProjectId) return projectTasksQuery.data?.tasks ?? [];
    const today = todayKey();
    return allTasks.filter((task) => taskInView(task, view, today));
  }, [selectedProjectId, projectTasksQuery.data, allTasks, view]);
  const activeQuery = selectedProjectId ? projectTasksQuery : allTasksQuery;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
  };

  const openView = (next: TaskView) =>
    void navigate({ search: { view: next, project: undefined } });
  const openProject = (id: string) =>
    void navigate({
      search: { view: undefined, project: stripResourceName(id, "projects") },
    });

  // A deleted (or otherwise vanished) project must never leave the board
  // pointed at a filter that matches nothing: fall back to the views.
  useEffect(() => {
    if (!projectsQuery.data || !selectedProjectId) return;
    if (!projectById.has(selectedProjectId)) {
      void navigate({ search: { view: undefined, project: undefined } });
    }
  }, [selectedProjectId, projectById, projectsQuery.data, navigate]);

  const meta = VIEW_META[view];
  const heading = selectedProject ? selectedProject.name : t(meta.label);
  const subheading = selectedProject
    ? selectedProject.description || t("projects.view.projectHint")
    : t(meta.hint);

  return (
    <WorkspaceLayout
      contentMaxWidth={1024}
      header={({
        sidebarCollapsed,
        toggleSidebarCollapsed,
        mobileSheetOpen,
        setMobileSheetOpen,
        explorer,
      }) => (
        <WorkspacePageHeader
          actions={
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCreatingTask(true)}
              >
                <PlusIcon data-icon="inline-start" />
                {t("projects.newTask")}
              </Button>
              <Button
                // Phones: the rail's own "New project" row is one swipe away.
                className="max-sm:hidden"
                size="sm"
                variant="outline"
                onClick={() => setCreatingProject(true)}
              >
                <PlusIcon data-icon="inline-start" />
                {t("projects.newProject")}
              </Button>
            </>
          }
          explorer={explorer}
          icon={
            <ListChecksIcon className="size-4 shrink-0 text-brand-600 dark:text-brand-400" />
          }
          mobileSheetOpen={mobileSheetOpen}
          setMobileSheetOpen={setMobileSheetOpen}
          sidebarCollapsed={sidebarCollapsed}
          title={t("projects.title")}
          toggleSidebarCollapsed={toggleSidebarCollapsed}
        />
      )}
    >
      <div className="flex flex-col gap-4 py-2">
        <div className="flex flex-col gap-4 lg:flex-row">
          <aside className="-mx-1 flex w-auto shrink-0 flex-row gap-1 overflow-x-auto px-1 [scrollbar-width:none] lg:mx-0 lg:w-60 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
            <SideHeading>{t("projects.section.views")}</SideHeading>
            {VIEW_ORDER.map((item) => {
              const Icon = VIEW_META[item].icon;
              return (
                <SideRow
                  active={!selectedProjectId && view === item}
                  count={counts[item]}
                  icon={<Icon />}
                  key={item}
                  label={t(VIEW_META[item].label)}
                  onClick={() => openView(item)}
                />
              );
            })}

            <SideHeading>{t("projects.section.projects")}</SideHeading>
            {projectsQuery.isLoading && (
              <div className="flex flex-col gap-2 px-2.5 py-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            )}

            {projectsQuery.isError && !projectsQuery.data && (
              <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1">
                  {t("list.errorDescription")}
                </span>
                <Button
                  className="h-6 px-2 text-xs"
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => void projectsQuery.refetch()}
                >
                  {t("common.retry")}
                </Button>
              </div>
            )}

            {projectsQuery.data && projects.length === 0 && (
              <button
                className={cn(NAV_ITEM_CLASS, "shrink-0 whitespace-nowrap")}
                type="button"
                onClick={() => setCreatingProject(true)}
              >
                <PlusIcon />
                {t("projects.newProject")}
              </button>
            )}

            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                selected={selectedProjectId === project.id}
                onMutated={invalidate}
                onSelect={openProject}
                onDeleted={(id) => {
                  if (selectedProjectId === id) openView("all");
                }}
              />
            ))}

            <div className="hidden lg:block">
              <TrashSection onMutated={invalidate} />
            </div>
          </aside>

          <section className="min-w-0 flex-1">
            <div className="mb-3 flex flex-col gap-0.5 px-1">
              <h2 className="truncate text-base font-semibold">{heading}</h2>
              <p className="truncate text-xs text-muted-foreground">
                {subheading}
              </p>
            </div>

            <QuickAddTask
              project={selectedProject}
              view={view}
              onCreated={invalidate}
            />

            {!selectedProjectId && view !== "all" && tasks.length > 0 ? (
              <TaskList
                projectById={projectById}
                tasks={tasks}
                onMutated={invalidate}
              />
            ) : (
              <Board
                emptyState={
                  selectedProject || view === "all"
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
          </section>
          {/* Small screens: the side rail scrolls sideways, the bin sits last. */}
          <div className="lg:hidden">
            <TrashSection onMutated={invalidate} />
          </div>
        </div>

        <ProjectFormDialog
          open={creatingProject}
          onOpenChange={setCreatingProject}
          onSaved={invalidate}
        />
        <TaskFormDialog
          defaultProjectId={selectedProject?.id}
          open={creatingTask}
          onOpenChange={setCreatingTask}
          onSaved={invalidate}
        />
      </div>
    </WorkspaceLayout>
  );
}
