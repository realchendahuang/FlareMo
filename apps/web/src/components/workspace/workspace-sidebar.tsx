import { useNavigate } from "@tanstack/react-router";
import { MenuIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type UIEvent,
  useCallback,
  useMemo,
  useState,
} from "react";
import type {
  CurrentFlareMoUser,
  MemoSpace,
  MemoStatsResponse,
  TagHierarchyNode,
} from "@/api";
import { FlareMoExplorer } from "@/components/flaremo-explorer";
import { Button } from "@/components/ui/button";
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
  /** Draws the header hairline once the panel has scrolled. */
  headerScrolled?: boolean;
  onNavigate?: () => void;
};

/** Platform-aware label for the ⌘\ / Ctrl+\ sidebar shortcut. */
function sidebarShortcutLabel() {
  if (typeof navigator === "undefined") return "Ctrl \\";
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ \\" : "Ctrl \\";
}

/** Space the collapsed-state toggle takes at the start of the page header. */
const TOGGLE_SLOT = 32;

/**
 * The sidebar toggle: one button that travels with the sidebar's edge.
 * Expanded, it sits in the sidebar header's trailing corner; collapsing
 * slides it, together with the shrinking sidebar, to the start of the page
 * header, where it waits as the expand button. It never disappears and never
 * jumps, so it can be clicked again at any point, including mid-animation.
 * It is positioned from the page column's leading edge, which is exactly the
 * edge the sidebar collapses towards.
 */
export function SidebarToggle({
  animate,
  collapsed,
  onToggle,
}: {
  animate: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const label = t(collapsed ? "sidebar.expand" : "sidebar.collapse");
  return (
    <div
      className={cn(
        "absolute top-3.5 z-30 hidden md:block",
        animate &&
          "motion-safe:transition-[inset-inline-start] motion-safe:duration-[400ms] motion-safe:ease-in-out",
      )}
      // Expanded: 8px resize handle + the sidebar header's 16px padding +
      // the 28px button to the left of the column. Collapsed: the page
      // header's 10px padding.
      style={{ insetInlineStart: collapsed ? 10 : -52 }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-keyshortcuts="Meta+Backslash Control+Backslash"
              aria-label={label}
              className="text-muted-foreground hover:text-foreground"
              data-testid="sidebar-toggle"
              size="icon-sm"
              variant="ghost"
              onClick={onToggle}
            />
          }
        >
          {collapsed ? (
            <PanelLeftOpenIcon className="rtl:-scale-x-100" />
          ) : (
            <PanelLeftCloseIcon className="rtl:-scale-x-100" />
          )}
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
 * Keeps the page header's title clear of the toggle while the sidebar is
 * collapsed; it opens and closes in step with the toggle's travel.
 */
export function SidebarToggleSlot({ collapsed }: { collapsed: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="hidden shrink-0 motion-safe:transition-[width] motion-safe:duration-[400ms] motion-safe:ease-in-out md:block"
      style={{ width: collapsed ? TOGGLE_SLOT : 0 }}
    />
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
  onDeleteTag,
  onExport,
  onImportFile,
  onNavigate,
  onOpenSettings,
  onRenameTag,
  onTagChange,
  onUntaggedChange,
  space,
  stats,
  timeZone,
  untagged,
  user,
}: WorkspaceExplorerPanelProps) {
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
    () => (
      <UserMenu
        onExport={onExport}
        onImportFile={onImportFile}
        onOpenSettings={handleOpenSettings}
        user={user}
      />
    ),
    [handleOpenSettings, onExport, onImportFile, user],
  );

  return (
    <FlareMoExplorer
      activeTag={activeTag}
      header={header}
      headerScrolled={headerScrolled}
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
 * The desktop sidebar column plus its resize handle (flomo's rails). Hiding
 * eases the column's width to zero; the panel inside keeps its width and is
 * pinned to the column's inner edge, so it slides away under the page rather
 * than being squeezed. The 8px handle after it resizes the column between
 * 216px and 312px and shows a hairline while hovered or dragged.
 */
export function WorkspaceSidebar({
  animate,
  collapsed,
  explorer,
  resizing,
  width,
  onResizeStart,
}: {
  /** Ease width changes (off on first paint and while dragging). */
  animate: boolean;
  collapsed: boolean;
  explorer: WorkspaceSidebarContent;
  resizing: boolean;
  width: number;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const { t } = useI18n();
  const [scrolled, onScroll] = useScrolled();
  return (
    <>
      <aside
        aria-hidden={collapsed || undefined}
        className={cn(
          "hidden h-full shrink-0 justify-end overflow-hidden md:flex",
          animate &&
            "motion-safe:transition-[width,opacity] motion-safe:duration-[400ms] motion-safe:ease-in-out",
          collapsed && "opacity-0",
        )}
        inert={collapsed}
        style={{ width: collapsed ? 0 : width }}
      >
        <div
          className="no-scrollbar h-full shrink-0 overflow-y-auto bg-background"
          style={{ width }}
          onScroll={onScroll}
        >
          <WorkspaceExplorerPanel {...explorer} headerScrolled={scrolled} />
        </div>
      </aside>
      <div
        aria-hidden="true"
        className={cn(
          "group/resizer relative hidden h-full shrink-0 cursor-col-resize md:block",
          animate &&
            "motion-safe:transition-[width] motion-safe:duration-[400ms] motion-safe:ease-in-out",
          collapsed ? "pointer-events-none w-0" : "w-2",
        )}
        data-testid="sidebar-resizer"
        title={t("sidebar.resize")}
        onDoubleClick={() => explorer.onToggleCollapsed()}
        onPointerDown={onResizeStart}
      >
        <span
          className={cn(
            "absolute inset-y-0 start-1/2 w-px -translate-x-1/2 bg-border opacity-0 motion-safe:transition-opacity motion-safe:duration-150 group-hover/resizer:opacity-100",
            resizing && "opacity-100",
          )}
        />
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
            className="text-muted-foreground hover:text-foreground md:hidden"
            size="icon-sm"
            variant="ghost"
          >
            <MenuIcon />
          </Button>
        }
      />
      <SheetContent className="w-[300px] overflow-hidden p-0" side="left">
        <SheetTitle className="sr-only">{t("sidebar.title")}</SheetTitle>
        <div
          className="no-scrollbar h-full overflow-y-auto overscroll-contain"
          data-testid="mobile-sidebar-scroll"
        >
          <WorkspaceExplorerPanel
            {...explorer}
            onNavigate={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
