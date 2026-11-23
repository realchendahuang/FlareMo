import { Link } from "@tanstack/react-router";
import { CheckCircle2Icon, CircleIcon, ListTodoIcon } from "lucide-react";
import type { Task } from "@/api";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * Task hits that join the keyword search results: matched client-side against
 * the shared ["tasks"] cache and linked into the calendar or project page.
 */
export function TaskSearchResults({ tasks }: { tasks: Task[] }) {
  const { t } = useI18n();

  return (
    <div className="rounded-xl border border-border/50 bg-card/60 px-3.5 py-3 text-card-foreground">
      <h2 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <ListTodoIcon className="size-3.5" />
        {t("search.taskResults")}
      </h2>
      <ul className="mt-1.5 flex flex-col divide-y divide-border/40">
        {tasks.map((task) => (
          <li key={task.id}>
            <Link
              className="flex items-center gap-2 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              to="/projects"
            >
              {task.status === "done" ? (
                <CheckCircle2Icon className="size-3.5 shrink-0" />
              ) : (
                <CircleIcon className="size-3.5 shrink-0" />
              )}
              <span
                className={cn(
                  "min-w-0 truncate",
                  task.status === "done" && "line-through",
                )}
              >
                {task.title}
              </span>
              {task.due_at && (
                <span className="ms-auto shrink-0 text-xs tabular-nums">
                  {task.due_at}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
