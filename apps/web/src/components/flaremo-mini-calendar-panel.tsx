import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { getTaskReminderCounts } from "@/api";
import { useI18n } from "@/i18n";
import { todayKey } from "@/lib/calendar-date";
import { queryKeys } from "@/lib/query-keys";

// Reminders shown above the time horizon in the explorer: open tasks due today
// or overdue. Deep-links straight to /projects where the user can manage and
// resolve them.

function useOpenTasks(today: string) {
  const query = useQuery({
    queryKey: queryKeys.tasks.reminders(today),
    queryFn: () => getTaskReminderCounts(today),
    staleTime: 60_000,
  });
  return {
    dueToday: query.data?.due_today ?? 0,
    overdue: query.data?.overdue ?? 0,
  };
}

export function MiniCalendarReminders() {
  const { t } = useI18n();
  const today = useMemo(() => todayKey(), []);
  const { dueToday, overdue } = useOpenTasks(today);

  if (dueToday <= 0 && overdue <= 0) return null;
  // One quiet line per reminder, styled like a sidebar row: a coloured dot
  // carries the urgency so the text can stay ink instead of shouting red.
  return (
    <div className="-mx-1 mb-2 flex flex-col">
      {dueToday > 0 && (
        <ReminderLink
          dotClassName="bg-brand-500"
          testId="mini-calendar-today-notice"
        >
          {t("calendar.overdueToday", { count: dueToday })}
        </ReminderLink>
      )}
      {overdue > 0 && (
        <ReminderLink dotClassName="bg-destructive">
          {t("calendar.overdueCount", { count: overdue })}
        </ReminderLink>
      )}
    </div>
  );
}

function ReminderLink({
  children,
  dotClassName,
  testId,
}: {
  children: ReactNode;
  dotClassName: string;
  testId?: string;
}) {
  return (
    <Link
      className="flex h-7 items-center gap-2 rounded-md px-2.5 text-xs text-foreground/75 outline-none motion-safe:transition-colors motion-safe:duration-150 hover:bg-muted/70 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/25"
      data-testid={testId}
      search={{ view: "today" }}
      to="/projects"
    >
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${dotClassName}`}
      />
      <span className="min-w-0 truncate">{children}</span>
    </Link>
  );
}
