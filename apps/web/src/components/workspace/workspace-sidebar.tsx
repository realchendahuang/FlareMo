import { useNavigate } from "@tanstack/react-router";
import {
  DownloadIcon,
  MenuIcon,
  PanelLeftIcon,
  UploadIcon,
} from "lucide-react";
import { type UIEvent, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import type {
  CurrentFlareMoUser,
  MemoSpace,
  MemoStatsResponse,
  TagHierarchyNode,
} from "@/api";
import { FlareMoExplorer } from "@/components/flaremo-explorer";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserMenu } from "@/components/user-menu";
import { useI18n } from "@/i18n";
import { dayFilterQuery } from "@/lib/calendar-date";
import { cn } from "@/lib/utils";

/** Everything the explorer sidebar renders, shared by both drawers. */
export type WorkspaceSidebarContent = {
  activeTag?: string;
  hierarchy: TagHierarchyNode[];
  hierarchyPending: boolean;
  stats: MemoStatsResponse;
  /** Viewer's IANA zone + space scope: the year view anchors its own stats
   * query with them (issue #144). */
  timeZone: string;
  space?: MemoSpace;
  untagged: boolean;
  user: CurrentFlareMoUser | undefined;
  onDeleteTag: (tag: string) => void;
  onExport: () => Promise<void>;
  onImportFile: (bundle: unknown) => Promise<void>;
  onOpenSettings: () => void;
  onRenameTag: (from: string, to: string) => void;
  onTagChange: (tag?: string) => void;
  onToggleCollapsed: () => void;
  onUntaggedChange: (untagged: boolean) => void;
};

type WorkspaceExplorerPanelProps = WorkspaceSidebarContent & {
  /** Id of this instance's hidden import input (desktop and sheet differ). */
  importInputId: string;
  /** Draws the header hairline once the panel has scrolled. */
  headerScrolled?: boolean;
  onNavigate?: () => void;
  /** Leave room at the header's start for the fixed sidebar toggle. */
  reserveToggle?: boolean;
};

/** Platform-aware label for the ⌘\ / Ctrl+\ sidebar shortcut. */
function sidebarShortcutLabel() {
  if (typeof navigator === "undefined") return "Ctrl \\";
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ \\" : "Ctrl \\";
}

/**
 * The one sidebar toggle. It is fixed to the same spot on screen (top leading
 * corner, inside the sidebar header's row) in both states, so the pointer
 * never has to follow it: click, click again, and the sidebar slides out and
 * back from under a button that does not move. Clicks during the animation
 * reverse it from wherever it is.
 */
export function SidebarToggle({
  collapsed,
  onToggle,
  onPointerEnter,
  onPointerLeave,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}) {
  const { t } = useI18n();
  const label = t(collapsed ? "sidebar.expand" : "sidebar.collapse");
  return (
    <div className="fixed start-3 top-3.5 z-50 hidden lg:block">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-expanded={!collapsed}
              aria-keyshortcuts="Meta+Backslash Control+Backslash"
              aria-label={label}
              className="text-muted-foreground hover:text-foreground"
              data-testid="sidebar-toggle"
              size="icon-sm"
              variant="ghost"
              onClick={onToggle}
              onPointerEnter={onPointerEnter}
              onPointerLeave={onPointerLeave}
            />
          }
        >
          <PanelLeftIcon className="rtl:-scale-x-100" />
        </TooltipTrigger>
        <TooltipContent>
          {label}
          <kbd
            className="rounded-sm bg-background/15 px-1 font-sans text-[11px] tracking-wide"
            data-slot="kbd"
          >
            {sidebarShortcutLabel()}
          </kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/**
 * One mounted explorer sidebar. Desktop and mobile each render their own, as
 * the single `renderExplorer` helper did before the split.
 */
function WorkspaceExplorerPanel({
  activeTag,
  headerScrolled = false,
  hierarchy,
  hierarchyPending,
  importInputId,
  onDeleteTag,
  onExport,
  onImportFile,
  onNavigate,
  onOpenSettings,
  onRenameTag,
  onTagChange,
  onUntaggedChange,
  reserveToggle = false,
  space,
  stats,
  timeZone,
  untagged,
  user,
}: WorkspaceExplorerPanelProps) {
  const { t } = useI18n();
  const navigate = useNavigate({ from: "/" });

  // FlareMoExplorer is memoized but its slots are ReactNodes, so identity is
  // the only thing that matters: rebuilding them inline on every parent render
  // (the timeline shell re-renders on scroll, collapse, dialogs…) would re-run
  // the explorer's heatmap for nothing. Each slot and callback below is keyed
  // to exactly what it reads.
  const handleOpenSettings = useCallback(() => {
    onNavigate?.();
    onOpenSettings();
  }, [onNavigate, onOpenSettings]);

  const handleDaySelect = useCallback(
    (date: string) => {
      void navigate({
        replace: true,
        search: (current) => ({
          ...current,
          q: dayFilterQuery(date),
          tag: undefined,
          untagged: undefined,
          view: "all",
        }),
      });
    },
    [navigate],
  );

  const header = useMemo(
    () => <UserMenu onOpenSettings={handleOpenSettings} user={user} />,
    [handleOpenSettings, user],
  );

  const footer = useMemo(
    () => (
      <div className="flex items-center gap-1 text-muted-foreground">
        <LocaleSwitcher />
        <Button
          aria-label={t("common.export")}
          size="icon-sm"
          title={t("common.export")}
          variant="ghost"
          onClick={() => void onExport()}
        >
          <DownloadIcon />
        </Button>
        <Button
          render={
            <label
              aria-label={t("common.import")}
              htmlFor={importInputId}
              title={t("common.import")}
            />
          }
          size="icon-sm"
          variant="ghost"
        >
          <UploadIcon />
          <Input
            accept="application/json"
            className="hidden"
            id={importInputId}
            type="file"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              try {
                const text = await file.text();
                void onImportFile(JSON.parse(text) as unknown);
              } catch {
                toast.error(t("toast.invalidImport"));
              }
            }}
          />
        </Button>
      </div>
    ),
    [importInputId, onExport, onImportFile, t],
  );

  return (
    <FlareMoExplorer
      activeTag={activeTag}
      header={header}
      headerScrolled={headerScrolled}
      reserveToggle={reserveToggle}
      footer={footer}
      space={space}
      stats={stats}
      timeZone={timeZone}
      hierarchy={hierarchy}
      hierarchyPending={hierarchyPending}
      untagged={untagged}
      onDeleteTag={onDeleteTag}
      onRenameTag={onRenameTag}
      onTagChange={onTagChange}
      onUntaggedChange={onUntaggedChange}
      onDaySelect={handleDaySelect}
      onNavigate={onNavigate}
    />
  );
}

/** Scroll state for a sidebar scroller, driving the header hairline. */
function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    const next = event.currentTarget.scrollTop > 4;
    setScrolled((prev) => (prev === next ? prev : next));
  }, []);
  return [scrolled, onScroll] as const;
}

/**
 * The desktop sidebar column. Collapsing animates the column's width to zero
 * while the panel inside stays 312px and is pinned to the column's inner edge
 * (`justify-end`), so it slides out under the content instead of being cut
 * off at its right side. The frame's max width shrinks in step (see
 * WorkspaceShell), which keeps the content column's width constant.
 */
export function WorkspaceSidebar({
  animating,
  collapsed,
  explorer,
  widthAnimating,
}: {
  /** Fade the panel in/out (off while a pinned peek covers the column). */
  animating: boolean;
  collapsed: boolean;
  explorer: WorkspaceSidebarContent;
  /** Animate the column width, which moves the page column beside it. */
  widthAnimating: boolean;
}) {
  const [scrolled, onScroll] = useScrolled();
  return (
    <aside
      aria-hidden={collapsed || undefined}
      className={cn(
        "hidden h-full shrink-0 justify-end overflow-hidden lg:flex",
        widthAnimating &&
          "motion-safe:transition-[width] motion-safe:duration-300 motion-safe:ease-signal",
      )}
      inert={collapsed}
      style={{ width: collapsed ? 0 : 312 }}
    >
      <div
        className={cn(
          "no-scrollbar h-full w-[312px] shrink-0 overflow-y-auto border-e bg-background",
          animating &&
            "motion-safe:transition-opacity motion-safe:duration-200 motion-safe:ease-out",
          collapsed ? "opacity-0" : "opacity-100",
        )}
        onScroll={onScroll}
      >
        <WorkspaceExplorerPanel
          {...explorer}
          headerScrolled={scrolled}
          importInputId="flaremo-import-file-desktop"
          reserveToggle
        />
      </div>
    </aside>
  );
}

/**
 * The collapsed sidebar, on demand: hovering the window's leading edge (or
 * the expand button) slides the full sidebar in as a floating panel, and
 * leaving it slides it away. Pointer-only by design; keyboard users have the
 * expand button and ⌘\. Mounted only while collapsed.
 */
export function WorkspaceSidebarPeek({
  explorer,
  open,
  pinned = false,
  onIntent,
}: {
  explorer: WorkspaceSidebarContent;
  open: boolean;
  /** Being promoted to the docked sidebar: hold still, ignore the pointer. */
  pinned?: boolean;
  onIntent: (open: boolean) => void;
}) {
  const [scrolled, onScroll] = useScrolled();
  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-y-0 start-0 z-30 hidden w-2 lg:block"
        onPointerEnter={() => onIntent(true)}
        onPointerLeave={() => onIntent(false)}
      />
      {/* Same box as the docked sidebar (full height, flush with the edge,
          312px), so expanding from a peek is a hand-off, not a second
          entrance. Only the shadow says it floats. */}
      <div
        aria-hidden={!open || pinned || undefined}
        className={cn(
          "fixed inset-y-0 start-0 z-40 hidden w-[312px] overflow-hidden border-e bg-background lg:block",
          // While pinning only the shadow eases away, so the panel settles
          // into the page instead of losing its lift in one frame.
          pinned
            ? "motion-safe:transition-[box-shadow] motion-safe:duration-300 motion-safe:ease-signal"
            : "motion-safe:transition-[translate,opacity,box-shadow] motion-safe:duration-250 motion-safe:ease-signal",
          pinned ? "pointer-events-none shadow-none" : "shadow-xl",
          open
            ? "translate-x-0 opacity-100"
            : "pointer-events-none opacity-0 ltr:-translate-x-full rtl:translate-x-full",
        )}
        data-testid="sidebar-peek"
        inert={!open || pinned}
        onPointerEnter={() => onIntent(true)}
        onPointerLeave={() => onIntent(false)}
      >
        <div
          className="no-scrollbar h-full overflow-y-auto overscroll-contain"
          onScroll={onScroll}
        >
          <WorkspaceExplorerPanel
            {...explorer}
            headerScrolled={scrolled}
            importInputId="flaremo-import-file-peek"
            reserveToggle
            onNavigate={() => onIntent(false)}
          />
        </div>
      </div>
    </>
  );
}

/** The mobile drawer: its trigger sits in the header, its panel in the sheet. */
export function WorkspaceMobileSidebar({
  explorer,
  open,
  onOpenChange,
}: {
  explorer: WorkspaceSidebarContent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger
        render={
          <Button
            aria-label={t("sidebar.toggle")}
            className="lg:hidden"
            size="icon-sm"
            variant="ghost"
          >
            <MenuIcon />
          </Button>
        }
      />
      <SheetContent className="w-[312px] overflow-hidden p-0" side="left">
        <SheetTitle className="sr-only">{t("sidebar.title")}</SheetTitle>
        <div
          className="no-scrollbar h-full overflow-y-auto overscroll-contain"
          data-testid="mobile-sidebar-scroll"
        >
          <WorkspaceExplorerPanel
            {...explorer}
            importInputId="flaremo-import-file-mobile"
            onNavigate={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
