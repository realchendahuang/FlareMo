import { useQuery } from "@tanstack/react-query";
import { CalendarClockIcon, FolderIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { listProjects } from "@/api";
import { ToolButton } from "@/components/composer/tool-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { type MemoSchedule, scheduleQuickPicks } from "@/lib/memo-schedule";
import { queryKeys } from "@/lib/query-keys";
import { cn, stripResourceName } from "@/lib/utils";

const NO_PROJECT = "";

/** "周五 10月31日" style label for a `YYYY-MM-DD` day in the UI locale. */
export function formatScheduleDay(day: string, locale: string) {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function useActiveProjects(enabled: boolean) {
  const query = useQuery({
    queryKey: queryKeys.projects.all,
    queryFn: () => listProjects(),
    enabled,
    staleTime: 60_000,
  });
  return (query.data?.projects ?? []).filter(
    (project) => project.status === "active" && !project.deleted_at,
  );
}

/**
 * The composer's "schedule" tool. A date here is a reminder, not text: the
 * memo's open to-dos become tasks due that day (in a project, if picked),
 * and the daily sweep reminds on the day. Day-level only, on purpose: clock
 * times and repeats are what a dedicated to-do app is for.
 */
export function ComposerScheduleMenu({
  schedule,
  disabled,
  onScheduleChange,
}: {
  schedule?: MemoSchedule;
  disabled: boolean;
  onScheduleChange: (schedule: MemoSchedule | undefined) => void;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const projects = useActiveProjects(open || Boolean(schedule?.projectId));
  const picks = scheduleQuickPicks();

  const update = (patch: Partial<MemoSchedule>) => {
    const next = { ...schedule, ...patch };
    if (!next.due) delete next.due;
    if (!next.projectId) delete next.projectId;
    onScheduleChange(next.due || next.projectId ? next : undefined);
  };

  const quickPicks = [
    { value: picks.today, label: t("composer.schedule.today") },
    { value: picks.tomorrow, label: t("composer.schedule.tomorrow") },
    { value: picks.nextMonday, label: t("composer.schedule.nextMonday") },
  ];
  const customDue =
    schedule?.due && !quickPicks.some((pick) => pick.value === schedule.due)
      ? schedule.due
      : undefined;

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <ToolButton
          active={Boolean(schedule)}
          disabled={disabled}
          label={t("composer.schedule")}
          type="button"
          // Inside the composer form: a typeless button would submit it.
          render={<DropdownMenuTrigger type="button" />}
        >
          <CalendarClockIcon />
        </ToolButton>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("composer.schedule.when")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={schedule?.due ?? ""}
              onValueChange={(value) => update({ due: String(value) })}
            >
              {quickPicks.map((pick) => (
                <DropdownMenuRadioItem key={pick.value} value={pick.value}>
                  <span className="flex-1">{pick.label}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatScheduleDay(pick.value, locale)}
                  </span>
                </DropdownMenuRadioItem>
              ))}
              {customDue && (
                <DropdownMenuRadioItem value={customDue}>
                  {formatScheduleDay(customDue, locale)}
                </DropdownMenuRadioItem>
              )}
            </DropdownMenuRadioGroup>
            <DropdownMenuItem
              onClick={() => {
                const input = dateInputRef.current;
                if (!input) return;
                input.value = schedule?.due ?? picks.today;
                try {
                  input.showPicker();
                } catch {
                  input.focus();
                }
              }}
            >
              {t("composer.schedule.pickDate")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {t("composer.schedule.project")}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={schedule?.projectId ?? NO_PROJECT}
              onValueChange={(value) => update({ projectId: String(value) })}
            >
              <DropdownMenuRadioItem value={NO_PROJECT}>
                {t("composer.schedule.noProject")}
              </DropdownMenuRadioItem>
              {projects.map((project) => (
                <DropdownMenuRadioItem key={project.id} value={project.id}>
                  <span className="truncate">{project.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          {schedule && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onScheduleChange(undefined)}>
                <XIcon />
                {t("composer.schedule.clear")}
              </DropdownMenuItem>
            </>
          )}
          <p className="px-2 pt-1 pb-1.5 text-xs leading-5 text-muted-foreground">
            {t("composer.schedule.hint")}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* The native picker survives the menu closing; it is never shown. */}
      <input
        aria-hidden="true"
        className="pointer-events-none absolute size-0 opacity-0"
        ref={dateInputRef}
        tabIndex={-1}
        type="date"
        onChange={(event) => {
          if (event.target.value) update({ due: event.target.value });
        }}
      />
    </>
  );
}

/**
 * What the schedule will do, shown above the composer's bottom bar while one
 * is set: the day, the project, and how many tasks the send will file.
 */
export function ComposerScheduleChip({
  schedule,
  taskCount,
  disabled,
  onClear,
}: {
  schedule: MemoSchedule;
  taskCount: number;
  disabled: boolean;
  onClear: () => void;
}) {
  const { t, locale } = useI18n();
  const projects = useActiveProjects(Boolean(schedule.projectId));
  const project = projects.find((item) => item.id === schedule.projectId);
  return (
    <div className="flex px-3 pb-2">
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/50 py-0.5 ps-2.5 pe-1 text-xs text-foreground",
        )}
      >
        {schedule.due && (
          <span className="inline-flex shrink-0 items-center gap-1">
            <CalendarClockIcon aria-hidden="true" className="size-3.5" />
            {formatScheduleDay(schedule.due, locale)}
          </span>
        )}
        {schedule.projectId && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <FolderIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">
              {project?.name ??
                stripResourceName(schedule.projectId, "projects")}
            </span>
          </span>
        )}
        <span className="shrink-0 text-muted-foreground">
          {taskCount > 0
            ? t("composer.schedule.taskCount", { count: taskCount })
            : t("composer.schedule.noTasks")}
        </span>
        <button
          aria-label={t("composer.schedule.clear")}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background/60 hover:text-foreground disabled:pointer-events-none"
          disabled={disabled}
          type="button"
          onClick={onClear}
        >
          <XIcon className="size-3" />
        </button>
      </span>
    </div>
  );
}
