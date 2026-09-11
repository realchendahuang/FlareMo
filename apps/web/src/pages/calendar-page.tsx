import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  CheckCircle2Icon,
  CircleIcon,
  GripVerticalIcon,
  ListTodoIcon,
  PlusIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  createProject,
  createTask,
  getCalendarView,
  listProjects,
  type Task,
  updateTask,
} from "@/api";
import type { CalendarDateCell } from "@/components/flaremo-calendar";
import { FlareMoCalendar } from "@/components/flaremo-calendar";
import { SubpageHeader } from "@/components/subpage-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import {
  addMonths,
  buildMonthGrid,
  dayFilterQuery,
  monthOf,
  todayKey,
  type WeekStart,
} from "@/lib/calendar-date";
import { errorMessage } from "@/lib/error";
import { cn, stripResourceName } from "@/lib/utils";

export function CalendarPage() {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const today = useMemo(() => todayKey(), []);
  const [cursor, setCursor] = useState(() => today);
  const [selected, setSelected] = useState(() => today);
  const [dragTask, setDragTask] = useState<Task | null>(null);

  const weekStart: WeekStart = locale.startsWith("en") ? "sunday" : "monday";
  const monthKey = monthOf(cursor);
  const grid = useMemo(
    () => buildMonthGrid(monthKey, weekStart),
    [monthKey, weekStart],
  );
  const gridStart = grid[0].key;
  const gridEnd = grid[grid.length - 1].key;

  const calendarQuery = useQuery({
    queryKey: ["calendar", gridStart, gridEnd],
    queryFn: () => getCalendarView({ from: gridStart, to: gridEnd }),
  });

  const data = useMemo(() => {
    const map = new Map<string, CalendarDateCell>();
    const ensure = (key: string) => {
      let cell = map.get(key);
      if (!cell) {
        cell = { notes: 0, note_tasks: 0, tasks: [] };
        map.set(key, cell);
      }
      return cell;
    };
    for (const note of calendarQuery.data?.notes ?? []) {
      ensure(note.date).notes = note.count;
    }
    for (const noteTask of calendarQuery.data?.note_tasks ?? []) {
      ensure(noteTask.date).note_tasks = noteTask.count;
    }
    for (const task of calendarQuery.data?.tasks ?? []) {
      if (!task.due_at) continue;
      ensure(task.due_at).tasks.push(task);
    }
    return map;
  }, [calendarQuery.data]);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => listProjects(),
  });
  const defaultProjectId = useMemo(() => {
    const projects = projectsQuery.data?.projects ?? [];
    const active = projects.find((project) => project.status === "active");
    return active ? stripResourceName(active.id, "projects") : null;
  }, [projectsQuery.data]);

  const selectedCell = data.get(selected);
  const selectedTasks = selectedCell?.tasks ?? [];
  const monthNotes = useMemo(() => {
    const monthPrefix = `${monthKey}-`;
    return [...data.entries()]
      .filter(([key, cell]) => key.startsWith(monthPrefix) && cell.notes > 0)
      .reduce((sum, [, cell]) => sum + cell.notes, 0);
  }, [data, monthKey]);

  return (
    <div className="min-h-svh bg-background px-4 py-5 sm:py-8">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <SubpageHeader />

        <div className="flex items-end justify-between gap-3 px-1">
          <h1 className="font-heading text-xl font-semibold">
            {t("calendar.title")}
          </h1>
          <Button
            size="sm"
            type="button"
            onClick={() => {
              setCursor(today);
              setSelected(today);
            }}
          >
            {t("calendar.today")}
          </Button>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <Card className="lg:max-w-sm">
            <CardContent className="p-4">
              {calendarQuery.isLoading ? (
                <Skeleton className="h-72 w-full" />
              ) : (
                <FlareMoCalendar
                  data={data}
                  monthKey={monthKey}
                  selected={selected}
                  today={today}
                  onDayClick={(dayKey) => {
                    setSelected(dayKey);
                    setCursor(dayKey);
                  }}
                  onTaskDrop={(dayKey) => {
                    const task = dragTask;
                    setDragTask(null);
                    if (!task || task.due_at === dayKey) return;
                    void updateTask(stripResourceName(task.id, "tasks"), {
                      due_at: dayKey,
                    })
                      .then(() => {
                        invalidateCalendar();
                        toast.success(t("calendar.toastRescheduled"));
                      })
                      .catch((error) =>
                        toast.error(
                          errorMessage(error, t("calendar.actionFailed")),
                        ),
                      );
                  }}
                  onMonthChange={(direction) => {
                    const next = addMonths(direction, `${monthKey}-01`);
                    setCursor(next);
                  }}
                />
              )}
            </CardContent>
          </Card>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <DayPanel
              day={selected}
              noteTasks={selectedCell?.note_tasks ?? 0}
              notes={selectedCell?.notes ?? 0}
              tasks={selectedTasks}
              today={today}
              defaultProjectId={defaultProjectId}
              projectsReady={Boolean(projectsQuery.data)}
              onTaskDragStart={setDragTask}
              onTaskSaved={invalidateCalendar}
            />
            <NotesPanel day={selected} monthNotes={monthNotes} />
          </div>
        </div>
      </main>
    </div>
  );

  function invalidateCalendar() {
    void queryClient.invalidateQueries({ queryKey: ["calendar"] });
  }
}

function DayPanel({
  day,
  noteTasks,
  today,
  notes,
  tasks,
  defaultProjectId,
  projectsReady,
  onTaskDragStart,
  onTaskSaved,
}: {
  day: string;
  noteTasks: number;
  today: string;
  notes: number;
  tasks: Task[];
  defaultProjectId: string | null;
  projectsReady: boolean;
  onTaskDragStart: (task: Task | null) => void;
  onTaskSaved: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  const [nextDate, setNextDate] = useState(day);

  const toggleDone = (task: Task) => {
    setRescheduling(null);
    void (async () => {
      try {
        await updateTask(stripResourceName(task.id, "tasks"), {
          status: task.status === "done" ? "todo" : "done",
        });
        onTaskSaved();
      } catch (error) {
        toast.error(errorMessage(error, t("calendar.actionFailed")));
      }
    })();
  };

  const submit = async () => {
    const value = title.trim();
    if (!value) return;
    setCreating(true);
    try {
      let projectId = defaultProjectId;
      if (!projectId) {
        const created = await createProject({
          name: t("calendar.defaultProject"),
        });
        projectId = stripResourceName(created.project.id, "projects");
      }
      await createTask({
        project_id: projectId,
        title: value,
        due_at: day,
      });
      setTitle("");
      onTaskSaved();
      toast.success(t("calendar.toastCreated"));
    } catch (error) {
      toast.error(errorMessage(error, t("calendar.actionFailed")));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-heading text-base font-semibold">
            {day === today ? t("calendar.todayTitle") : day}
          </h2>
          <span className="text-xs text-muted-foreground">
            {t("calendar.notesCount", { count: notes })}
          </span>
        </div>
        {noteTasks > 0 && (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <ListTodoIcon size={13} aria-hidden="true" />
            {t("calendar.dayNoteTasks", { count: noteTasks })} ·{" "}
            {t("calendar.viewDayNotes")}
          </p>
        )}

        <ul className="mt-3 flex flex-col gap-1">
          {tasks.length === 0 && (
            <li className="text-xs text-muted-foreground">
              {t("calendar.dueEmpty")}
            </li>
          )}
          {tasks.map((task) => {
            const done = task.status === "done";
            return (
              <li
                className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/60"
                draggable={!done}
                key={task.id}
                onDragEnd={() => onTaskDragStart(null)}
                onDragStart={() => onTaskDragStart(task)}
                title={t("calendar.dragHint")}
              >
                <GripVerticalIcon
                  aria-hidden="true"
                  className={cn(
                    "shrink-0 text-muted-foreground/50",
                    !done && "cursor-grab",
                  )}
                />
                <button
                  aria-label={
                    done ? t("projects.status.todo") : t("projects.status.done")
                  }
                  type="button"
                  onClick={() => toggleDone(task)}
                >
                  {done ? (
                    <CheckCircle2Icon className="text-primary" />
                  ) : (
                    <CircleIcon className="text-muted-foreground" />
                  )}
                </button>
                <span
                  className={
                    "min-w-0 flex-1 truncate " +
                    (done ? "text-muted-foreground line-through" : "")
                  }
                >
                  {task.title}
                </span>
                {rescheduling === task.id ? (
                  <span className="flex items-center gap-1">
                    <Input
                      aria-label={t("calendar.reschedule")}
                      className="h-7 w-32 text-xs"
                      type="date"
                      value={nextDate}
                      onChange={(event) => setNextDate(event.target.value)}
                    />
                    <Button
                      size="xs"
                      type="button"
                      onClick={() => {
                        setRescheduling(null);
                        void updateTask(stripResourceName(task.id, "tasks"), {
                          due_at: nextDate ? nextDate : null,
                        })
                          .then(() => {
                            onTaskSaved();
                            toast.success(t("calendar.toastRescheduled"));
                          })
                          .catch((error) =>
                            toast.error(
                              errorMessage(error, t("calendar.actionFailed")),
                            ),
                          );
                      }}
                    >
                      {t("common.save")}
                    </Button>
                  </span>
                ) : (
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground"
                    type="button"
                    onClick={() => {
                      setNextDate(task.due_at ?? day);
                      setRescheduling(task.id);
                    }}
                  >
                    {t("calendar.reschedule")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Input
            aria-label={t("calendar.quickAdd")}
            className="h-8 text-sm"
            disabled={creating || !projectsReady}
            placeholder={t("calendar.quickAddPlaceholder")}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Button
            disabled={creating || !title.trim() || !projectsReady}
            size="sm"
            type="submit"
          >
            <PlusIcon data-icon="inline-start" />
            {t("calendar.quickAdd")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function NotesPanel({ day, monthNotes }: { day: string; monthNotes: number }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  if (monthNotes === 0) return null;
  return (
    <Card>
      <CardContent className="p-4 text-sm">
        <p className="text-xs text-muted-foreground">
          {t("calendar.monthNotes", { count: monthNotes })}
        </p>
        <Button
          className="mt-2"
          size="sm"
          type="button"
          variant="ghost"
          onClick={() => {
            void navigate({
              href: `/?q=${encodeURIComponent(dayFilterQuery(day))}`,
            });
          }}
        >
          {t("calendar.viewDayNotes")}
        </Button>
      </CardContent>
    </Card>
  );
}
