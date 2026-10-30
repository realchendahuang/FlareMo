import {
  CrownIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UserCogIcon,
  UserIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import type { AdminUser } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { getReaderStatus } from "../use-admin-users";

/**
 * The member list half of the former users-card.tsx AdminPanel: search
 * input, grouped member rows (identity / role badges / reader status /
 * row-action dropdown) and the search empty state. JSX is moved verbatim;
 * state and handlers stay in users-card.tsx and flow in through props.
 */
export function UsersTable({
  allUsers,
  filteredMembers,
  handleRevokeReader,
  handleSetReader,
  handleResetPassword,
  handleUpdateRole,
  isTeamAdmin,
  isTeamOwner,
  memberSearch,
  meQuery,
  setCreateError,
  setCreateOpen,
  setCreatedLink,
  setDeleteTarget,
  setMemberSearch,
  usersQuery,
}: {
  allUsers: AdminUser[];
  filteredMembers: AdminUser[];
  handleRevokeReader: (user: AdminUser) => Promise<void>;
  handleSetReader: (user: AdminUser, days: number) => Promise<void>;
  handleResetPassword: (user: AdminUser) => Promise<void>;
  handleUpdateRole: (user: AdminUser) => Promise<void>;
  isTeamAdmin: boolean;
  isTeamOwner: boolean;
  memberSearch: string;
  meQuery: { data?: { id?: string } };
  setCreateError: (error: string | null) => void;
  setCreateOpen: (open: boolean) => void;
  setCreatedLink: (link: string | null) => void;
  setDeleteTarget: (user: AdminUser | null) => void;
  setMemberSearch: (search: string) => void;
  usersQuery: {
    data?: { users: AdminUser[] };
    isError: boolean;
    isLoading: boolean;
  };
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-5">
      {/* Header: Title with member count & Add button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {t("admin.usersTitle")}
          </h3>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {allUsers.length}
          </span>
        </div>
        {isTeamAdmin && (
          <Button
            size="sm"
            type="button"
            onClick={() => {
              setCreateError(null);
              setCreatedLink(null);
              setCreateOpen(true);
            }}
            className="cursor-pointer"
          >
            <PlusIcon data-icon="inline-start" />
            {t("admin.createUser")}
          </Button>
        )}
      </div>
      {/* Lightweight search input: visible if there are more than 3 members or already searching */}
      {(allUsers.length > 3 || memberSearch) && (
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("admin.memberSearchPlaceholder")}
            className="h-9 pl-9 pr-8 text-xs bg-muted/20 border-border/50 hover:border-border/80 focus:bg-background transition-colors"
            placeholder={t("admin.memberSearchPlaceholder")}
            value={memberSearch}
            onChange={(event) => setMemberSearch(event.target.value)}
          />
          {memberSearch && (
            <Button
              type="button"
              aria-label={t("search.clear")}
              onClick={() => setMemberSearch("")}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
              size="icon-xs"
              variant="ghost"
            >
              <XIcon className="size-3.5" />
            </Button>
          )}
        </div>
      )}
      {/* Grouped Member List */}
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card divide-y divide-border/40 shadow-2xs">
        {usersQuery.isLoading && (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        )}

        {usersQuery.isError && (
          <p className="p-4 text-xs text-destructive">
            {t("admin.usersLoadFailed")}
          </p>
        )}

        {usersQuery.data &&
          filteredMembers.map((user) => {
            const readerStatus = getReaderStatus(user);
            const isSelf = meQuery.data?.id === user.id;

            return (
              <div
                key={user.id}
                className="flex items-center justify-between gap-3 px-3.5 py-3 transition-colors hover:bg-accent/30"
              >
                {/* Left: Avatar & Identity */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {(user.name || user.username || "?")
                      .slice(0, 1)
                      .toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium text-foreground">
                        {user.name || user.username}
                      </span>
                      {isSelf && (
                        <span className="rounded bg-primary/10 px-1 py-0.5 text-xs font-normal text-primary">
                          {t("admin.selfBadge")}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground truncate mt-0.5">
                      <span>@{user.username}</span>
                      <span>·</span>
                      <span className="truncate">{user.email}</span>
                    </div>
                  </div>
                </div>

                {/* Right: Role & Status & Actions */}
                <div className="flex shrink-0 items-center gap-2">
                  {user.role === "owner" ? (
                    <Badge variant="warning" className="gap-1">
                      <CrownIcon className="size-3" />
                      <span>{t("admin.role.owner")}</span>
                    </Badge>
                  ) : user.role === "admin" ? (
                    <Badge variant="brand" className="gap-1">
                      <ShieldCheckIcon className="size-3" />
                      <span>{t("admin.role.admin")}</span>
                    </Badge>
                  ) : user.role === "reader" ? (
                    <div className="flex items-center gap-1.5">
                      <Badge variant="info" className="gap-1">
                        <EyeIcon className="size-3" />
                        <span>{t("admin.role.reader")}</span>
                      </Badge>
                      {readerStatus &&
                        (readerStatus.expired ? (
                          <Badge
                            variant="destructive"
                            className="h-5 px-1.5 text-xs"
                          >
                            {t("admin.expired")}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground hidden sm:inline">
                            {t("admin.daysLeft", {
                              days: String(readerStatus.days),
                            })}
                          </span>
                        ))}
                    </div>
                  ) : (
                    <Badge
                      variant="outline"
                      className="gap-1 text-muted-foreground font-normal text-xs"
                    >
                      <UserIcon className="size-3" />
                      <span>{t("admin.role.member")}</span>
                    </Badge>
                  )}

                  {/* Actions Dropdown */}
                  {user.role !== "owner" && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            aria-label={t("admin.memberActions")}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                            className="size-7 text-muted-foreground hover:text-foreground cursor-pointer"
                          >
                            <MoreHorizontalIcon className="size-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        {isTeamOwner && (
                          <DropdownMenuItem
                            onClick={() => void handleUpdateRole(user)}
                          >
                            <UserCogIcon />
                            {user.role === "admin"
                              ? t("admin.makeMember")
                              : t("admin.makeAdmin")}
                          </DropdownMenuItem>
                        )}
                        {(user.role === "member" ||
                          user.role === "reader" ||
                          user.role === null) && (
                          <>
                            <DropdownMenuItem
                              onClick={() => void handleSetReader(user, 30)}
                            >
                              <EyeIcon />
                              {user.role === "reader"
                                ? t("admin.renewReader30")
                                : t("admin.makeReader30")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => void handleSetReader(user, 365)}
                            >
                              <EyeIcon />
                              {user.role === "reader"
                                ? t("admin.renewReader365")
                                : t("admin.makeReader365")}
                            </DropdownMenuItem>
                          </>
                        )}
                        {user.role === "reader" && (
                          <DropdownMenuItem
                            onClick={() => void handleRevokeReader(user)}
                          >
                            <EyeOffIcon />
                            {t("admin.revokeReader")}
                          </DropdownMenuItem>
                        )}
                        {(isTeamOwner || user.role === "member") && (
                          <DropdownMenuItem
                            onClick={() => void handleResetPassword(user)}
                          >
                            <KeyRoundIcon />
                            {t("admin.resetPassword")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeleteTarget(user)}
                        >
                          <Trash2Icon />
                          {t("admin.deleteUser")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            );
          })}

        {/* Empty state when searching */}
        {usersQuery.data && filteredMembers.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <UsersIcon className="size-7 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">
              {t("admin.memberSearchEmpty")}
            </p>
            {memberSearch && (
              <Button
                size="xs"
                variant="outline"
                onClick={() => setMemberSearch("")}
                className="cursor-pointer"
              >
                {t("admin.clearFilters")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
