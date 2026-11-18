import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AtSignIcon,
  BellIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  ListTodoIcon,
  MessageCircleIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  type AppNotification,
  archiveNotification,
  listNotifications,
} from "@/api";
import { QueryErrorState } from "@/components/query-error-state";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { formatMemoRelativeTime } from "@/lib/memo";
import { queryKeys } from "@/lib/query-keys";
import { cn, stripResourceName } from "@/lib/utils";

const TYPE_ICONS = {
  daily_review: CalendarClockIcon,
  memo_comment: MessageCircleIcon,
  memo_mention: AtSignIcon,
  task_overdue: ListTodoIcon,
  task_due: CalendarCheckIcon,
} as const;

const TYPE_LABELS = {
  daily_review: "notifications.type.dailyReview",
  memo_comment: "notifications.type.memoComment",
  memo_mention: "notifications.type.memoMention",
  task_overdue: "notifications.type.taskOverdue",
  task_due: "notifications.type.taskDue",
} as const;

// One shared query for every surface that shows unread state: the user-menu
// badge reads the count while the dialog renders the list itself.
export function useNotifications() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const notificationsQuery = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: listNotifications,
    retry: false,
    refetchInterval: 60_000,
  });
  const archiveMutation = useMutation({
    mutationFn: archiveNotification,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
    onError: (error) =>
      toast.error(errorMessage(error, t("notifications.archiveFailed"))),
  });

  const notifications = notificationsQuery.data?.notifications ?? [];
  const unreadCount = notifications.filter(
    (notification) => notification.status === "unread",
  ).length;

  const openNotification = (notification: AppNotification) => {
    if (notification.status === "unread") {
      archiveMutation.mutate(notification.name);
    }
    if (notification.type === "daily_review") {
      void navigate({ to: "/review/daily" });
      return;
    }
    if (
      notification.type === "task_overdue" ||
      notification.type === "task_due"
    ) {
      void navigate({ to: "/projects" });
      return;
    }
    if (!notification.memo) return;
    // A comment (or a mention inside one) opens the memo it answers, on
    // its thread; `memo` is the comment itself.
    const thread = notification.related_memo;
    void navigate({
      to: "/memo/$memoId",
      params: {
        memoId: stripResourceName(thread ?? notification.memo, "memos"),
      },
      hash: thread ? "comments" : undefined,
    });
  };

  return {
    notifications,
    unreadCount,
    openNotification,
    isLoading: notificationsQuery.isLoading,
    isError: notificationsQuery.isError,
    hasData: Boolean(notificationsQuery.data),
    refetch: () => notificationsQuery.refetch(),
    isRefetching: notificationsQuery.isRefetching,
  };
}

// The shared notification body (loading / error / empty / items). Rendered
// inside the user menu's dialog; the sidebar topbar no longer carries a bell
// of its own.
export function NotificationList({ onNavigate }: { onNavigate?: () => void }) {
  const { locale, t } = useI18n();
  const {
    notifications,
    openNotification,
    isLoading,
    isError,
    hasData,
    refetch,
    isRefetching,
  } = useNotifications();

  const activate = (notification: AppNotification) => {
    openNotification(notification);
    onNavigate?.();
  };

  if (isLoading && !hasData) {
    return (
      <div aria-hidden="true" className="flex flex-col gap-2 py-2">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    );
  }
  if (isError && !hasData) {
    return (
      <QueryErrorState
        className="min-h-40 py-6 text-muted-foreground"
        isRetrying={isRefetching}
        onRetry={() => void refetch()}
      />
    );
  }
  if (notifications.length === 0) {
    return (
      <Empty className="min-h-40 py-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BellIcon />
          </EmptyMedia>
          <EmptyDescription className="text-xs">
            {t("notifications.empty")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      {notifications.map((notification) => {
        const Icon = TYPE_ICONS[notification.type];
        const unread = notification.status === "unread";
        return (
          <button
            className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-start outline-none motion-safe:transition-colors motion-safe:duration-150 hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/25"
            key={notification.name}
            type="button"
            onClick={() => activate(notification)}
          >
            <span
              className={cn(
                "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
                unread
                  ? "bg-card text-foreground shadow-xs ring-1 ring-border/70 dark:bg-muted"
                  : "bg-muted/70 text-muted-foreground",
              )}
            >
              <Icon className="size-3.5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                className={cn(
                  "flex items-center justify-between gap-2 text-xs",
                  unread
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                <span className="min-w-0 truncate">
                  {/* Comments and mentions say who; reminders come from the
                      app itself, so they carry no name. */}
                  {notification.sender_name &&
                    (notification.type === "memo_comment" ||
                      notification.type === "memo_mention") && (
                      <span className="me-1">{notification.sender_name}</span>
                    )}
                  {t(TYPE_LABELS[notification.type])}
                </span>
                <span className="shrink-0 font-normal tabular-nums text-muted-foreground">
                  {formatMemoRelativeTime(notification.create_time, locale)}
                </span>
              </span>
              <span className="line-clamp-2 text-xs break-words text-muted-foreground">
                {notification.memo_snippet}
              </span>
            </span>
            {unread && (
              <span
                aria-hidden="true"
                className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
