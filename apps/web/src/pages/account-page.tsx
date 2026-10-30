/**
 * The settings dialog shell: the modal's frame (mobile master/detail and the
 * desktop split view) and the two exported entry points. Section state and
 * query orchestration live in `account/use-account-page-state`, the nav
 * table in `account/settings-nav`, the section bodies in
 * `account/settings-section-content`, and the server writes in
 * `account/use-account-settings-mutations`.
 */

import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LogOutIcon,
  XIcon,
} from "lucide-react";
import { useRef } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { TIMELINE_SEARCH } from "@/lib/timeline-search";
import { cn } from "@/lib/utils";
import { SettingsRow, SettingsSectionGroup } from "./account/apple-settings-ui";
import {
  roleLabel,
  SettingsSectionContent,
} from "./account/settings-section-content";
import { useAccountPageState } from "./account/use-account-page-state";

export function AccountSettingsDialog({
  open,
  onClose,
  initialSection,
}: {
  open: boolean;
  onClose: () => void;
  initialSection?: string;
}) {
  const {
    accountPanel,
    activeLabel,
    cfUsageQuery,
    dataTasksQuery,
    handleSignOut,
    isInstanceOwner,
    isTeamAdmin,
    meQuery,
    mobileView,
    navGroups,
    retryExportMutation,
    section,
    session,
    setMobileView,
    setSection,
    showVoiceSettings,
    t,
    vectorUsageQuery,
  } = useAccountPageState({ open, initialSection });
  const popupRef = useRef<HTMLDivElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        // Pointer opens land on the panel itself, not the first row: focusing
        // the profile card painted a focus ring on every open. Keyboard
        // opens keep the default so tab order still starts inside.
        initialFocus={(type) => (type === "keyboard" ? true : popupRef.current)}
        ref={popupRef}
        showCloseButton={false}
        className="flex h-svh max-h-svh w-full max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[min(46rem,calc(100svh-4rem))] sm:max-h-[calc(100svh-4rem)] sm:max-w-4xl sm:flex-row sm:rounded-2xl sm:border"
      >
        {/* ========================================================================= */}
        {/* 1. NARROW SCREEN / MOBILE: MASTER VIEW (一级主菜单)                         */}
        {/* ========================================================================= */}
        <div
          className={cn(
            "flex flex-1 flex-col overflow-hidden bg-background sm:hidden",
            mobileView === "detail" && "hidden",
            mobileView === "master" && "motion-safe:animate-fade",
          )}
        >
          {/* Mobile Master Navigation Bar */}
          <div className="flex shrink-0 items-center justify-between border-b bg-background/90 px-4 py-3 backdrop-blur-md">
            <DialogTitle className="text-lg font-semibold tracking-tight">
              {t("settings.title")}
            </DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 px-2.5 font-medium text-primary hover:bg-accent/50"
            >
              {t("settings.done")}
            </Button>
          </div>

          {/* Mobile Master List */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
            {/* Apple ID Style Account Header */}
            <button
              type="button"
              onClick={() => {
                setSection("account");
                setMobileView("detail");
              }}
              className="flex w-full items-center justify-between gap-3.5 rounded-2xl border border-border/60 bg-card p-4 text-left shadow-2xs cursor-pointer hover:bg-accent/40 active:bg-accent/60 transition-colors"
            >
              <div className="flex min-w-0 items-center gap-3.5">
                <Avatar
                  src={
                    meQuery.data?.avatar_url ?? session.data?.user.image ?? null
                  }
                  name={
                    meQuery.data?.name ??
                    session.data?.user.name ??
                    session.data?.user.username ??
                    ""
                  }
                  size="xl"
                />
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-foreground">
                    {meQuery.data?.name ??
                      session.data?.user.name ??
                      session.data?.user.username}
                  </div>
                  <div className="truncate text-xs text-muted-foreground mt-0.5">
                    {session.data?.user.username
                      ? `@${session.data.user.username}`
                      : session.data?.user.email}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {meQuery.data?.role && (
                      <Badge
                        variant="secondary"
                        className="h-4 px-1.5 text-xs font-normal"
                      >
                        {roleLabel(meQuery.data?.role, t)}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <ChevronRightIcon className="size-5 text-muted-foreground/40 shrink-0" />
            </button>

            {/* Mobile Nav Groups */}
            {navGroups.map((group) => (
              <SettingsSectionGroup
                key={group.titleKey ?? "default"}
                title={group.titleKey ? t(group.titleKey) : undefined}
              >
                {group.items.map((item) => (
                  <SettingsRow
                    key={item.id}
                    icon={item.icon}
                    iconColor={item.iconBg}
                    label={item.label}
                    chevron
                    onClick={() => {
                      setSection(item.id);
                      setMobileView("detail");
                    }}
                  />
                ))}
              </SettingsSectionGroup>
            ))}

            {/* Mobile Sign Out */}
            <SettingsSectionGroup>
              <SettingsRow
                destructive
                icon={LogOutIcon}
                label={t("auth.signOut")}
                onClick={() => void handleSignOut()}
              />
            </SettingsSectionGroup>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 2. NARROW SCREEN / MOBILE: DETAIL VIEW (二级详情页)                         */}
        {/* ========================================================================= */}
        <div
          className={cn(
            "flex flex-1 flex-col overflow-hidden bg-background sm:hidden",
            mobileView === "master" && "hidden",
            mobileView === "detail" && "motion-safe:animate-fade",
          )}
        >
          {/* Mobile Detail Navigation Bar */}
          <div className="flex shrink-0 items-center justify-between border-b bg-background/90 px-2 py-2 backdrop-blur-md">
            <Button
              className="-ms-1 gap-0.5 px-1.5 font-medium text-primary hover:bg-accent/50 hover:text-primary"
              onClick={() => setMobileView("master")}
              size="sm"
              variant="ghost"
            >
              <ChevronLeftIcon className="size-5 rtl:rotate-180" />
              <span>{t("settings.title")}</span>
            </Button>
            <h2 className="truncate px-2 font-heading text-sm font-semibold tracking-tight text-foreground">
              {activeLabel}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 px-2.5 font-medium text-primary hover:bg-accent/50"
            >
              {t("settings.done")}
            </Button>
          </div>

          {/* Mobile Detail Body */}
          <div className="flex-1 overflow-y-auto p-4">
            <div
              className="flex flex-col gap-4 motion-safe:animate-fade"
              key={section}
            >
              <SettingsSectionContent
                accountPanel={accountPanel}
                cfUsageQuery={cfUsageQuery}
                dataTasksQuery={dataTasksQuery}
                isInstanceOwner={isInstanceOwner}
                isTeamAdmin={isTeamAdmin}
                onCreateExport={() => retryExportMutation.mutate()}
                onRetryExport={() => retryExportMutation.mutate()}
                retryExportIsPending={retryExportMutation.isPending}
                section={section}
                showVoiceSettings={showVoiceSettings}
                t={t}
                vectorUsageQuery={vectorUsageQuery}
                voiceUserId={session.data?.user.id}
              />
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 3. WIDE SCREEN / DESKTOP: macOS STYLE SPLIT VIEW (宽屏双栏分栏)            */}
        {/* ========================================================================= */}
        <aside className="hidden shrink-0 flex-col border-r bg-muted/30 p-3 sm:flex sm:w-64">
          <div className="flex items-center justify-between px-2 pt-1 pb-2">
            <DialogTitle className="text-base font-semibold tracking-tight text-foreground">
              {t("settings.title")}
            </DialogTitle>
          </div>

          {/* Compact User Header in Sidebar */}
          <button
            type="button"
            onClick={() => setSection("account")}
            className={cn(
              "mb-2 flex w-full cursor-pointer items-center gap-3 rounded-xl p-2.5 text-start text-foreground transition-colors",
              section === "account"
                ? "bg-card shadow-xs ring-1 ring-border/70 dark:bg-muted"
                : "hover:bg-muted/70",
            )}
          >
            <Avatar
              src={meQuery.data?.avatar_url ?? session.data?.user.image ?? null}
              name={
                meQuery.data?.name ??
                session.data?.user.name ??
                session.data?.user.username ??
                ""
              }
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-semibold leading-tight text-foreground">
                  {meQuery.data?.name ??
                    session.data?.user.name ??
                    session.data?.user.username}
                </p>
                {meQuery.data?.role && (
                  <Badge
                    variant="secondary"
                    className="h-4 px-1.5 text-xs font-normal"
                  >
                    {roleLabel(meQuery.data?.role, t)}
                  </Badge>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground mt-0.5">
                {session.data?.user.username
                  ? `@${session.data.user.username}`
                  : t("settings.group.account")}
              </p>
            </div>
          </button>

          {/* Sidebar Nav Items */}
          <nav className="flex-1 overflow-y-auto flex flex-col gap-3 py-1">
            {navGroups.map((group) => (
              <div
                key={group.titleKey ?? "default"}
                className="flex flex-col gap-0.5"
              >
                {group.titleKey && (
                  <div className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">
                    {t(group.titleKey)}
                  </div>
                )}
                {group.items.map((item) => {
                  const active = section === item.id;
                  const Icon = item.icon;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      aria-current={active ? "true" : undefined}
                      onClick={() => setSection(item.id)}
                      className={cn(
                        "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-start text-[13.5px] outline-none transition-[background-color,color,box-shadow] focus-visible:ring-3 focus-visible:ring-ring/25 [&>svg]:text-muted-foreground",
                        active
                          ? "bg-card font-medium text-foreground shadow-xs ring-1 ring-border/70 dark:bg-muted [&>svg]:text-primary"
                          : "text-foreground/70 hover:bg-muted/70 hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="truncate flex-1">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Desktop Sign Out */}
          <div className="mt-auto pt-3 border-t border-border/40">
            <Button
              className="w-full justify-start gap-2.5 px-2.5 text-[13.5px] text-foreground/70"
              onClick={() => void handleSignOut()}
              variant="ghost"
            >
              <LogOutIcon
                data-icon="inline-start"
                className="size-4 shrink-0"
              />
              {t("auth.signOut")}
            </Button>
          </div>
        </aside>

        {/* Desktop Detail Pane */}
        <section className="hidden min-w-0 flex-1 flex-col overflow-hidden sm:flex">
          {/* Desktop Detail Header */}
          <div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
            <h2 className="font-heading text-lg font-semibold tracking-tight text-foreground">
              {activeLabel}
            </h2>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label={t("common.close")}
              className="size-7 rounded-md text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-4" />
            </Button>
          </div>

          {/* Desktop Detail Body */}
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-2xl px-6 py-6">
              <div
                className="flex flex-col gap-4 motion-safe:animate-fade"
                key={section}
              >
                <SettingsSectionContent
                  accountPanel={accountPanel}
                  cfUsageQuery={cfUsageQuery}
                  dataTasksQuery={dataTasksQuery}
                  isInstanceOwner={isInstanceOwner}
                  isTeamAdmin={isTeamAdmin}
                  onCreateExport={() => retryExportMutation.mutate()}
                  onRetryExport={() => retryExportMutation.mutate()}
                  retryExportIsPending={retryExportMutation.isPending}
                  section={section}
                  showVoiceSettings={showVoiceSettings}
                  t={t}
                  vectorUsageQuery={vectorUsageQuery}
                  voiceUserId={session.data?.user.id}
                />
              </div>
            </div>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

export function AccountPage() {
  const navigate = useNavigate({ from: "/account" });
  const { section } = useSearch({ from: "/account" });
  return (
    <AccountSettingsDialog
      initialSection={section}
      open
      onClose={() =>
        void navigate({
          search: { ...TIMELINE_SEARCH },
          to: "/",
        })
      }
    />
  );
}
