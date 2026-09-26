import {
  BellIcon,
  CheckIcon,
  ChevronDownIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  RefreshCwIcon,
  SettingsIcon,
  SunIcon,
} from "lucide-react";
import { useState } from "react";
import type { CurrentFlareMoUser } from "@/api";
import {
  NotificationList,
  useNotifications,
} from "@/components/notification-bell";
import { useTheme } from "@/components/theme-provider";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  UpdateStatusDialog,
  useUpdateStatus,
} from "@/components/update-status";
import { useSignOut } from "@/hooks/use-sign-out";
import { useI18n } from "@/i18n";

// The sidebar's single identity affordance, flomo-style: the topbar shows
// only the member's name; email, settings, notifications, update check and
// sign-out all live inside this menu. No logo, no avatars, no icon row.
export function UserMenu({
  user,
  onOpenSettings,
}: {
  user?: CurrentFlareMoUser | null;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const [updateOpen, setUpdateOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { appInfo, updateAvailable } = useUpdateStatus();
  const { unreadCount } = useNotifications();

  const label = user
    ? user.name || user.username || user.email
    : t("auth.accountTitle");

  const handleSignOut = useSignOut();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={label}
              className="relative h-7 max-w-full gap-1.5 px-1.5 sm:max-w-[14rem]"
              size="sm"
              variant="ghost"
            >
              {user ? (
                <>
                  <Avatar
                    className="size-4.5 shrink-0"
                    name={user.name || user.username}
                    size="xs"
                    src={user.avatar_url}
                  />
                  <span className="min-w-0 truncate font-medium">
                    {user.name || user.username || user.email}
                  </span>
                </>
              ) : (
                <>
                  <span
                    aria-hidden="true"
                    className="size-4.5 shrink-0 rounded-full bg-muted"
                  />
                  <span
                    aria-hidden="true"
                    className="h-4 w-20 rounded bg-muted"
                  />
                </>
              )}
              <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
              {unreadCount > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary"
                />
              )}
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="w-64">
          {user && (
            <>
              <DropdownMenuLabel className="font-normal">
                <div className="flex items-center gap-2.5 py-0.5">
                  <Avatar
                    className="size-8 shrink-0"
                    name={user.name || user.username}
                    size="md"
                    src={user.avatar_url}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm text-foreground">
                      {user.name || user.username}
                    </p>
                    {user.email && (
                      <p className="truncate text-xs text-muted-foreground">
                        {user.email}
                      </p>
                    )}
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onClick={onOpenSettings}>
            <SettingsIcon />
            {t("auth.accountTitle")}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {theme === "light" ? (
                <SunIcon />
              ) : theme === "dark" ? (
                <MoonIcon />
              ) : (
                <MonitorIcon />
              )}
              <span className="min-w-0 flex-1 truncate">
                {t("theme.title")}
              </span>
              <span className="text-xs text-muted-foreground">
                {theme === "light"
                  ? t("theme.light")
                  : theme === "dark"
                    ? t("theme.dark")
                    : t("theme.system")}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => setTheme("system")}>
                <MonitorIcon />
                <span className="flex-1">{t("theme.system")}</span>
                {theme === "system" && <CheckIcon className="ml-auto" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("light")}>
                <SunIcon />
                <span className="flex-1">{t("theme.light")}</span>
                {theme === "light" && <CheckIcon className="ml-auto" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}>
                <MoonIcon />
                <span className="flex-1">{t("theme.dark")}</span>
                {theme === "dark" && <CheckIcon className="ml-auto" />}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onClick={() => setNotificationsOpen(true)}>
            <BellIcon />
            <span className="min-w-0 flex-1 truncate">
              {t("notifications.title")}
            </span>
            {unreadCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground tabular-nums">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setUpdateOpen(true)}>
            <RefreshCwIcon />
            <span className="min-w-0 flex-1 truncate">
              {t("update.checkUpdates")}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs tabular-nums">
              {appInfo ? `v${appInfo.version}` : null}
              {updateAvailable && (
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-primary"
                />
              )}
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void handleSignOut()}>
            <LogOutIcon />
            {t("auth.signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog onOpenChange={setNotificationsOpen} open={notificationsOpen}>
        <DialogContent className="gap-3">
          <DialogHeader>
            <DialogTitle>{t("notifications.title")}</DialogTitle>
          </DialogHeader>
          <div className="-mx-1 max-h-[60vh] overflow-y-auto px-1">
            <NotificationList onNavigate={() => setNotificationsOpen(false)} />
          </div>
        </DialogContent>
      </Dialog>

      <UpdateStatusDialog onOpenChange={setUpdateOpen} open={updateOpen} />
    </>
  );
}
