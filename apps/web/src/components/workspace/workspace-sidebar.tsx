import { useNavigate } from "@tanstack/react-router";
import { DownloadIcon, MenuIcon, UploadIcon } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type UIEvent,
  useCallback,
  useMemo,
  useState,
} from "react";
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
};

/** Platform-aware label for the ⌘\ / Ctrl+\ sidebar shortcut. */
function sidebarShortcutLabel() {
  if (typeof navigator === "undefined") return "Ctrl \\";
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ \\" : "Ctrl \\";
}

/**
 * flomo's "show sidebar" entry: while the desktop sidebar is hidden, a 28px
 * menu button sits at the start of the page header, right before the title.
 * Narrow screens use the drawer trigger in the same spot instead.
 */
export function ShowSidebarButton({
  collapsed,
  onShow,
}: {
  collapsed: boolean;
  onShow: () => void;
}) {
  const { t } = useI18n();
  if (!collapsed) return null;
  const label = t("sidebar.expand");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-keyshortcuts="Meta+Backslash Control+Backslash"
            aria-label={label}
            className="hidden text-muted-foreground hover:text-foreground md:inline-flex"
            data-testid="sidebar-show"
            size="icon-sm"
            variant="ghost"
            onClick={onShow}
          />
        }
      >
        <MenuIcon />
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
          <WorkspaceExplorerPanel
            {...explorer}
            headerScrolled={scrolled}
            importInputId="flaremo-import-file-desktop"
          />
        </div>
      </aside>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only resize affordance; the sidebar width has sensible bounds without it */}
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
            importInputId="flaremo-import-file-mobile"
            onNavigate={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
