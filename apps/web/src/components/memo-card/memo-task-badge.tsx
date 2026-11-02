import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CalendarClockIcon,
  CircleCheckIcon,
  ListChecksIcon,
} from "lucide-react";
import { useMemo } from "react";
import { listProjects, type Task } from "@/api";
import { formatScheduleDay } from "@/components/composer/composer-schedule-menu";
import { useI18n } from "@/i18n";
import { todayKey } from "@/lib/calendar-date";
import { cn, stripResourceName } from "@/lib/utils";

/**
 * "This note is on the to-do list": progress, the earliest open due day and
 * the project, in one quiet chip. It links to the project (or to the to-do
 * view the tasks sit in), so a note and its work are one click apart in both
 * directions. Renders nothing for a memo that filed no tasks.
 */
export function MemoTaskBadge({ tasks }: { tasks: Task[] }) {
  const { t, locale } = useI18n();
  const projectIds = useMemo(
    () => [
      ...new Set(
        tasks
          .map((task) => task.project_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ],
    [tasks],
  );
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => listProjects(),
    enabled: projectIds.length > 0,
    staleTime: 60_000,
  });
  if (tasks.length === 0) return null;

  const done = tasks.filter((task) => task.status === "done").length;
  const allDone = done === tasks.length;
  const nextDue = tasks
    .filter((task) => task.status !== "done" && task.due_at)
    .map((task) => (task.due_at ?? "").slice(0, 10))
    .sort()[0];
  const today = todayKey();
  const overdue = Boolean(nextDue && nextDue < today);
  const projectId = projectIds.length === 1 ? projectIds[0] : null;
  const projectName = projectId
    ? projectsQuery.data?.projects.find((item) => item.id === projectId)?.name
    : undefined;

  const search = projectId
    ? { project: stripResourceName(projectId, "projects"), view: undefined }
    : {
        project: undefined,
        view:
          nextDue && nextDue <= today
            ? ("today" as const)
            : nextDue
              ? ("upcoming" as const)
              : ("all" as const),
      };

  return (
    <Link
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs motion-safe:transition-colors",
        "border-border/70 bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      search={search}
      title={t("memo.tasks.open")}
      to="/projects"
    >
      {allDone ? (
        <CircleCheckIcon aria-hidden="true" className="size-3.5 shrink-0" />
      ) : (
        <ListChecksIcon aria-hidden="true" className="size-3.5 shrink-0" />
      )}
      <span className="shrink-0 tabular-nums">
        {allDone
          ? t("memo.tasks.allDone")
          : t("memo.tasks.progress", { done, total: tasks.length })}
      </span>
      {!allDone && nextDue && (
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1",
            overdue && "text-destructive",
          )}
        >
          <CalendarClockIcon aria-hidden="true" className="size-3.5" />
          {nextDue === today
            ? t("composer.schedule.today")
            : formatScheduleDay(nextDue, locale)}
        </span>
      )}
      {projectName && <span className="min-w-0 truncate">· {projectName}</span>}
    </Link>
  );
}
