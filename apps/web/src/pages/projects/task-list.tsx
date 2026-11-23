import { useState } from "react";
import type { Project, Task } from "@/api";
import { formatScheduleDay } from "@/components/composer/composer-schedule-menu";
import { TaskRow } from "@/components/task-row";
import { useI18n } from "@/i18n";
import { addDays, todayKey } from "@/lib/calendar-date";
import { TaskFormDialog } from "./task-form-dialog";

type Group = { key: string; title: string; tasks: Task[] };

/**
 * Date views read as a checklist grouped by day, not as a status board: the
 * question they answer is "what is next", and a kanban with two empty
 * columns answers it badly. Projects keep the board, where status and order
 * are the point.
 */
export function TaskList({
  tasks,
  projectById,
  onMutated,
}: {
  tasks: Task[];
  projectById: Map<string, Project>;
  onMutated: () => void;
}) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<Task | null>(null);
  const today = todayKey();
  const tomorrow = addDays(today, 1);

  const groups: Group[] = [];
  const push = (key: string, title: string, task: Task) => {
    const group = groups.find((item) => item.key === key);
    if (group) group.tasks.push(task);
    else groups.push({ key, title, tasks: [task] });
  };
  const sorted = [...tasks].sort(
    (a, b) =>
      Number(a.status === "done") - Number(b.status === "done") ||
      (a.due_at ?? "").localeCompare(b.due_at ?? "") ||
      a.sort_order - b.sort_order,
  );
  for (const task of sorted) {
    const due = (task.due_at ?? "").slice(0, 10);
    if (task.status === "done")
      push("done", t("projects.group.doneToday"), task);
    else if (due < today) push("overdue", t("projects.group.overdue"), task);
    else if (due === today) push("today", t("composer.schedule.today"), task);
    else if (due === tomorrow) push(due, t("composer.schedule.tomorrow"), task);
    else push(due, formatScheduleDay(due, locale), task);
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section className="flex flex-col gap-1.5" key={group.key}>
          <h3
            className={
              "px-1 text-xs font-medium " +
              (group.key === "overdue"
                ? "text-destructive"
                : "text-muted-foreground")
            }
          >
            {group.title}
            <span className="ms-1.5 tabular-nums opacity-70">
              {group.tasks.length}
            </span>
          </h3>
          <ul className="paper divide-y divide-border/60 rounded-xl border border-border/80 bg-card">
            {group.tasks.map((task) => (
              <TaskRow
                key={task.id}
                projectName={
                  task.project_id
                    ? projectById.get(task.project_id)?.name
                    : undefined
                }
                task={task}
                onEdit={setEditing}
              />
            ))}
          </ul>
        </section>
      ))}
      {editing && (
        <TaskFormDialog
          key={editing.id}
          open
          task={editing}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSaved={onMutated}
        />
      )}
    </div>
  );
}
