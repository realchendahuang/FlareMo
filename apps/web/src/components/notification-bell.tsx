import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AtSignIcon,
  BellIcon,
  CalendarClockIcon,
  MessageCircleIcon,
} from "lucide-react";
import {
  type AppNotification,
  archiveNotification,
  listNotifications,
} from "@/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { formatMemoRelativeTime } from "@/lib/memo";
import { cn } from "@/lib/utils";

const TYPE_ICONS = {
  daily_review: CalendarClockIcon,
  memo_comment: MessageCircleIcon,
  memo_mention: AtSignIcon,
} as const;

const TYPE_LABELS = {
  daily_review: "notifications.type.dailyReview",
  memo_comment: "notifications.type.memoComment",
  memo_mention: "notifications.type.memoMention",
} as const;

export function NotificationBell() {
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: listNotifications,
    retry: false,
    refetchInterval: 60_000,
  });
  const archiveMutation = useMutation({
    mutationFn: archiveNotification,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
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
    void navigate({
      to: "/memo/$memoId",
      params: { memoId: notification.memo.replace(/^memos\//, "") },
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("notifications.title")}
          className="relative"
          size="icon-sm"
          title={t("notifications.title")}
          variant="ghost"
        >
          <BellIcon />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground tabular-nums">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {notifications.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t("notifications.empty")}
          </p>
        ) : (
          notifications.map((notification) => {
            const Icon = TYPE_ICONS[notification.type];
            const unread = notification.status === "unread";
            return (
              <DropdownMenuItem
                className="flex items-start gap-2 px-2 py-2"
                key={notification.name}
                onSelect={() => openNotification(notification)}
              >
                <Icon className="mt-0.5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={cn(
                      "flex items-center justify-between gap-2 text-xs",
                      unread ? "font-medium" : "text-muted-foreground",
                    )}
                  >
                    {t(TYPE_LABELS[notification.type])}
                    <span className="shrink-0 font-normal text-muted-foreground tabular-nums">
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
                    className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                  />
                )}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
