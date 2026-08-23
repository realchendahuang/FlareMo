import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  CircleIcon,
  FlagIcon,
  ListTodoIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { cloneElement, isValidElement, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  archiveProject,
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  listProjects,
  listTasks,
  type Project,
  type Task,
  type TaskPriority,
  type TaskStatus,
  updateProject,
  updateTask,
} from "@/api";
import { FlareMoLogo } from "@/components/flaremo-logo";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";

const ALL_TASKS = "all";

const STATUS_COLUMNS: TaskStatus[] = ["todo", "in_progress", "done"];

const PRIORITY_BADGE: Record<
  TaskPriority,
  "destructive" | "flame" | "secondary"
> = {
  high: "destructive",
  medium: "flame",
  low: "secondary",
  none: "secondary",
};

export function ProjectsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string>(ALL_TASKS);
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => listProjects(),
  });

  const tasksQuery = useQuery({
    queryKey: ["tasks", selected],
    queryFn: () =>
      listTasks(selected === ALL_TASKS ? {} : { project_id: selected }),
  });

  const projects = useMemo(
    () => projectsQuery.data?.projects ?? [],
    [projectsQuery.data],
  );
  const tasks = useMemo(() => tasksQuery.data?.tasks ?? [], [tasksQuery.data]);
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  const selectedProject =
    selected === ALL_TASKS ? null : (projectById.get(selected) ?? null);
  const openCount = projects.reduce(
    (sum, project) => sum + project.task_count_open,
    0,
  );

  return (
    <div className="min-h-svh bg-background px-4 py-5 sm:py-8">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <header className="flex items-center justify-between gap-3">
          <Button asChild size="sm" variant="ghost">
            <Link
              search={{
                q: undefined,
                tag: undefined,
                view: undefined,
                untagged: undefined,
              }}
              to="/"
            >
              <ArrowLeftIcon data-icon="inline-start" />
              {t("common.back")}
            </Link>
          </Button>
          <FlareMoLogo markClassName="size-5" />
        </header>

        <div className="flex items-end justify-between gap-3 px-1">
          <div>
            <h1 className="font-heading text-xl font-semibold">
              {t("projects.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("projects.subtitle")}
            </p>
          </div>
          <Button size="sm" onClick={() => setCreatingProject(true)}>
            <PlusIcon data-icon="inline-start" />
            {t("projects.newProject")}
          </Button>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row">
          <aside className="flex w-full shrink-0 flex-col gap-1 lg:w-64">
            <button
              className={
                "flex h-10 items-center gap-3 rounded-lg px-3 text-sm " +
                (selected === ALL_TASKS
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground")
              }
              type="button"
              onClick={() => setSelected(ALL_TASKS)}
            >
              <ListTodoIcon className="size-4" />
              <span className="min-w-0 flex-1 truncate text-left">
                {t("projects.allTasks")}
              </span>
              <Badge variant="secondary">{openCount}</Badge>
            </button>

            {projectsQuery.isLoading && (
              <div className="flex flex-col gap-2 px-3 py-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            )}

            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                selected={selected === project.id}
                onMutated={invalidate}
                onSelect={setSelected}
              />
            ))}
          </aside>

          <section className="min-w-0 flex-1">
            <div className="mb-3 flex items-center justify-between gap-2 px-1">
              <h2 className="truncate text-sm font-medium text-muted-foreground">
                {selectedProject
                  ? selectedProject.name
                  : t("projects.allTasks")}
              </h2>
              <Button size="sm" onClick={() => setCreatingTask(true)}>
                <PlusIcon data-icon="inline-start" />
                {t("projects.newTask")}
              </Button>
            </div>

            <Board
              projects={projects}
              projectById={projectById}
              loading={tasksQuery.isLoading}
              selectedProject={selectedProject}
              tasks={tasks}
              onMutated={invalidate}
            />
          </section>
        </div>

        <ProjectCreateDialog
          open={creatingProject}
          onCreated={invalidate}
          onOpenChange={setCreatingProject}
        />
        <TaskCreateDialog
          defaultProjectId={selectedProject?.id}
          open={creatingTask}
          projects={projects}
          onCreated={invalidate}
          onOpenChange={setCreatingTask}
        />
      </main>
    </div>
  );
}

function Board({
  projects,
  projectById,
  loading,
  selectedProject,
  tasks,
  onMutated,
}: {
  projects: Project[];
  projectById: Map<string, Project>;
  loading: boolean;
  selectedProject: Project | null;
  tasks: Task[];
  onMutated: () => void;
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

  if (tasks.length === 0 && projects.length === 0) {
    return (
      <Empty className="min-h-56 border">
        <EmptyHeader>
          <EmptyTitle>{t("projects.emptyTitle")}</EmptyTitle>
          <EmptyDescription>{t("projects.emptyDescription")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (tasks.length === 0) {
    return (
      <Empty className="min-h-56 border">
        <EmptyHeader>
          <EmptyTitle>{t("projects.tasksEmptyTitle")}</EmptyTitle>
          <EmptyDescription>
            {t("projects.tasksEmptyDescription")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {STATUS_COLUMNS.map((status) => {
        const columnTasks = tasks.filter((task) => task.status === status);
        return (
          <div key={status} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 px-1">
              <StatusIcon status={status} />
              <span className="text-sm font-medium">
                {t(`projects.status.${status}`)}
              </span>
              <span className="text-xs text-muted-foreground">
                {columnTasks.length}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {columnTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  projectName={
                    selectedProject
                      ? null
                      : (projectById.get(task.project_id)?.name ?? null)
                  }
                  task={task}
                  onMutated={onMutated}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === "done") {
    return <CheckCircle2Icon className="size-4 text-muted-foreground" />;
  }
  if (status === "in_progress") {
    return <CircleDotIcon className="size-4 text-flame-500" />;
  }
  return <CircleIcon className="size-4 text-muted-foreground" />;
}

function ProjectRow({
  project,
  selected,
  onMutated,
  onSelect,
}: {
  project: Project;
  selected: boolean;
  onMutated: () => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const archiveMutation = useMutation({
    mutationFn: () =>
      archiveProject(bareProjectId(project.id), project.status !== "archived"),
    onSuccess: () => {
      toast.success(
        t(
          project.status === "archived"
            ? "toast.projectUnarchived"
            : "toast.projectArchived",
        ),
      );
      onMutated();
    },
    onError: (error) =>
      toast.error(toError(error, t("toast.projectArchiveFailed"))),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(bareProjectId(project.id)),
    onSuccess: () => {
      toast.success(t("toast.projectDeleted"));
      onMutated();
    },
    onError: (error) =>
      toast.error(toError(error, t("toast.projectDeleteFailed"))),
  });

  return (
    <>
      <div
        className={
          "group flex h-10 items-center gap-3 rounded-lg px-3 text-sm " +
          (selected
            ? "bg-muted font-medium text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground")
        }
      >
        <button
          className="min-w-0 flex-1 truncate text-left"
          type="button"
          onClick={() => onSelect(project.id)}
        >
          <span
            className={
              project.status === "archived" ? "text-muted-foreground/70" : ""
            }
          >
            {project.name}
          </span>
        </button>
        {project.task_count_open > 0 && (
          <Badge variant="secondary">{project.task_count_open}</Badge>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="opacity-0 group-hover:opacity-100 focus:opacity-100"
              size="icon-sm"
              variant="ghost"
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditing(true)}>
              <PencilIcon data-icon="inline-start" />
              {t("common.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => archiveMutation.mutate()}>
              {project.status === "archived" ? (
                <ArchiveRestoreIcon data-icon="inline-start" />
              ) : (
                <ArchiveIcon data-icon="inline-start" />
              )}
              {t(
                project.status === "archived"
                  ? "projects.unarchive"
                  : "projects.archive",
              )}
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

      <ProjectEditDialog
        open={editing}
        project={project}
        onMutated={onMutated}
        onOpenChange={setEditing}
      />
      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("projects.deleteProjectTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("projects.deleteProjectDescription")}
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

function ProjectEditDialog({
  open,
  project,
  onMutated,
  onOpenChange,
}: {
  open: boolean;
  project: Project;
  onMutated: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");

  const updateMutation = useMutation({
    mutationFn: () =>
      updateProject(bareProjectId(project.id), {
        name,
        description: description || null,
      }),
    onSuccess: () => {
      toast.success(t("toast.projectUpdated"));
      onOpenChange(false);
      onMutated();
    },
    onError: (error) =>
      toast.error(toError(error, t("toast.projectUpdateFailed"))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("projects.editProject")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label={t("projects.field.name")}>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label={t("projects.field.description")}>
            <Textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button
            disabled={!name.trim() || updateMutation.isPending}
            onClick={() => updateMutation.mutate()}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskCard({
  projectName,
  task,
  onMutated,
}: {
  projectName: string | null;
  task: Task;
  onMutated: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateTask>[1]) =>
      updateTask(bareId(task.id), input),
    onSuccess: () => {
      toast.success(t("toast.taskUpdated"));
      onMutated();
    },
    onError: (error) =>
      toast.error(toError(error, t("toast.taskUpdateFailed"))),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTask(bareId(task.id)),
    onSuccess: () => {
      toast.success(t("toast.taskDeleted"));
      onMutated();
    },
    onError: (error) =>
      toast.error(toError(error, t("toast.taskDeleteFailed"))),
  });

  const advance = () => {
    const next: TaskStatus =
      task.status === "todo"
        ? "in_progress"
        : task.status === "in_progress"
          ? "done"
          : "todo";
    updateMutation.mutate({ status: next });
  };

  return (
    <>
      <Card className="group">
        <CardContent className="flex flex-col gap-2 p-3">
          {projectName && (
            <span className="truncate text-xs text-muted-foreground">
              {projectName}
            </span>
          )}
          <div className="flex items-start gap-2">
            <button
              className="mt-0.5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
              title={t("projects.advanceStatus")}
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                  size="icon-sm"
                  variant="ghost"
                >
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{t("projects.setStatus")}</DropdownMenuLabel>
                {STATUS_COLUMNS.map((status) => (
                  <DropdownMenuItem
                    key={status}
                    onClick={() => updateMutation.mutate({ status })}
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
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <CalendarDaysIcon data-icon="inline-start" />
                  {task.due_at}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <TaskEditDialog
        open={editing}
        task={task}
        onMutated={onMutated}
        onOpenChange={setEditing}
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

function ProjectCreateDialog({
  open,
  onCreated,
  onOpenChange,
}: {
  open: boolean;
  onCreated: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      createProject({ name, description: description || undefined }),
    onSuccess: () => {
      toast.success(t("toast.projectCreated"));
      setName("");
      setDescription("");
      onOpenChange(false);
      onCreated();
    },
    onError: (error) =>
      toast.error(toError(error, t("toast.projectCreateFailed"))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("projects.newProject")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label={t("projects.field.name")}>
            <Input
              value={name}
              placeholder={t("projects.namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label={t("projects.field.description")}>
            <Textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button
            disabled={!name.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskCreateDialog({
  defaultProjectId,
  open,
  projects,
  onCreated,
  onOpenChange,
}: {
  defaultProjectId?: string;
  open: boolean;
  projects: Project[];
  onCreated: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? "");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [dueAt, setDueAt] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      createTask({
        project_id: projectId,
        title,
        status: "todo",
        notes: notes || undefined,
        priority,
        due_at: dueAt || undefined,
      }),
    onSuccess: () => {
      toast.success(t("toast.taskCreated"));
      setTitle("");
      setNotes("");
      setPriority("none");
      setDueAt("");
      onOpenChange(false);
      onCreated();
    },
    onError: (error) =>
      toast.error(toError(error, t("toast.taskCreateFailed"))),
  });

  const needsProject = !defaultProjectId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("projects.newTask")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {needsProject && (
            <Field label={t("projects.field.project")}>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">{t("projects.selectProject")}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={t("projects.field.title")}>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("projects.field.priority")}>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
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
              </select>
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
            disabled={!title.trim() || !projectId || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskEditDialog({
  open,
  task,
  onMutated,
  onOpenChange,
}: {
  open: boolean;
  task: Task;
  onMutated: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [dueAt, setDueAt] = useState(task.due_at ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);

  const updateMutation = useMutation({
    mutationFn: () =>
      updateTask(bareId(task.id), {
        title,
        notes,
        priority,
        due_at: dueAt || null,
        status,
      }),
    onSuccess: () => {
      toast.success(t("toast.taskUpdated"));
      onOpenChange(false);
      onMutated();
    },
    onError: (error) =>
      toast.error(toError(error, t("toast.taskUpdateFailed"))),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("projects.editTask")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label={t("projects.field.title")}>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("projects.field.status")}>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
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
              </select>
            </Field>
            <Field label={t("projects.field.priority")}>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
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
              </select>
            </Field>
          </div>
          <Field label={t("projects.field.dueDate")}>
            <Input
              type="date"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </Field>
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
            disabled={!title.trim() || updateMutation.isPending}
            onClick={() => updateMutation.mutate()}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      {isValidElement(children)
        ? cloneElement(children as React.ReactElement<{ id?: string }>, { id })
        : children}
    </div>
  );
}

function bareId(id: string) {
  return id.replace(/^tasks\//, "");
}

function bareProjectId(id: string) {
  return id.replace(/^projects\//, "");
}

function toError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
