import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  type CSSProperties,
  createContext,
  lazy,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  getCurrentFlareMoUser,
  getMemoStats,
  getTagHierarchy,
  type MemoSpace,
  type MemoStatsResponse,
} from "@/api";
import {
  SidebarToggle,
  WorkspaceSidebar,
  type WorkspaceSidebarContent,
} from "@/components/workspace/workspace-sidebar";
import { useDataTransfer } from "@/hooks/use-data-transfer";
import { useMemoMutations } from "@/hooks/use-memo-mutations";
import { queryKeys } from "@/lib/query-keys";
import { ACTIVITY_WINDOW_DAYS } from "@/lib/time-horizon";
import { TIMELINE_SEARCH } from "@/lib/timeline-search";
import { cn } from "@/lib/utils";

const AccountSettingsDialog = lazy(() =>
  import("@/pages/account-page").then((module) => ({
    default: module.AccountSettingsDialog,
  })),
);

// Persisted so the desktop sidebar keeps its visibility and width on reload.
const SIDEBAR_COLLAPSED_KEY = "flaremo.sidebar.collapsed";
const SIDEBAR_WIDTH_KEY = "flaremo.sidebar.width";

/** Widest the sidebar gets, and its default (flomo's sidebar rail). */
export const WORKSPACE_SIDEBAR_WIDTH = 312;
/** Narrowest the resize handle allows. */
export const WORKSPACE_SIDEBAR_MIN_WIDTH = 216;
/** The hit area between the sidebar and the page that resizes the sidebar. */
const RESIZER_WIDTH = 8;
/** Gutter on each side of the frame. */
const FRAME_GUTTER = 10;
/** Content column width of a page that does not ask for another. */
export const DEFAULT_CONTENT_MAX_WIDTH = 640;
/** Matches Tailwind's `md`: from here up the sidebar is a column, below a drawer. */
const DESKTOP_QUERY = "(min-width: 768px)";
/** Show/hide duration; the sidebar, its gutter, the frame and the toggle share it. */
const SIDEBAR_MOTION_MS = 400;
/** Dragging the handle this far in hides the sidebar on release. */
const COLLAPSE_DRAG_THRESHOLD = 120;

function clampSidebarWidth(width: number) {
  return Math.min(
    WORKSPACE_SIDEBAR_WIDTH,
    Math.max(WORKSPACE_SIDEBAR_MIN_WIDTH, Math.round(width)),
  );
}

function subscribeViewport(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/** The window's width, live; the shell's layout math reads it. */
function useViewportWidth() {
  return useSyncExternalStore(
    subscribeViewport,
    () => window.innerWidth,
    () => 1280,
  );
}

function readSidebarWidth() {
  try {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return stored ? clampSidebarWidth(stored) : WORKSPACE_SIDEBAR_WIDTH;
  } catch {
    return WORKSPACE_SIDEBAR_WIDTH;
  }
}

const EMPTY_STATS: MemoStatsResponse = {
  counts: { normal: 0, archived: 0, trashed: 0, total: 0 },
  active_days: 0,
  tags: [],
  activity: [],
};

type WorkspaceShellValue = {
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
  mobileSheetOpen: boolean;
  setMobileSheetOpen: (open: boolean) => void;
  explorer: WorkspaceSidebarContent;
};

const WorkspaceShellContext = createContext<WorkspaceShellValue | null>(null);

export function useWorkspaceShell(): WorkspaceShellValue {
  const value = useContext(WorkspaceShellContext);
  if (!value) {
    throw new Error("useWorkspaceShell must be used inside <WorkspaceShell>");
  }
  return value;
}

function readCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** The timeline's filter params, read without binding to the index route. */
function useTimelineSearch() {
  return useRouterState({
    select: (state) => {
      if (state.location.pathname !== "/") return null;
      const search = state.location.search as {
        space?: MemoSpace;
        tag?: string;
        untagged?: boolean;
      };
      return {
        space: search.space ?? "all",
        tag: search.tag,
        untagged: Boolean(search.untagged),
      };
    },
    structuralSharing: true,
  });
}

/**
 * The persistent workspace frame: one sidebar for every workspace page, so
 * navigating swaps only the content column. Previously each page mounted its
 * own sidebar; a route change unmounted it, painted a full-page skeleton
 * while the next chunk loaded, and replayed the sidebar's entry animations.
 */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const timeline = useTimelineSearch();
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [resizing, setResizing] = useState(false);
  // Width and frame offset ease only while the sidebar is being shown or
  // hidden. Resizing the window or dragging the handle must track instantly:
  // an always-on transition made the layout trail the window edge by 400ms,
  // so narrowing the window felt like the page refused to get narrower.
  const [animating, setAnimating] = useState(false);
  const animationTimer = useRef<number | undefined>(undefined);
  const startToggleAnimation = useCallback(() => {
    window.clearTimeout(animationTimer.current);
    setAnimating(true);
    animationTimer.current = window.setTimeout(
      () => setAnimating(false),
      SIDEBAR_MOTION_MS + 60,
    );
  }, []);
  useEffect(() => () => window.clearTimeout(animationTimer.current), []);

  // On a narrow window the sidebar gives way first: it shrinks from its
  // chosen width toward 216px so the column can keep 640px, and only then
  // does the column narrow. Below 768px the sidebar becomes the drawer.
  const viewportWidth = useViewportWidth();
  const effectiveSidebarWidth = Math.min(
    sidebarWidth,
    Math.max(
      WORKSPACE_SIDEBAR_MIN_WIDTH,
      viewportWidth - FRAME_GUTTER - RESIZER_WIDTH - DEFAULT_CONTENT_MAX_WIDTH,
    ),
  );

  const setCollapsed = useCallback(
    (next: boolean) => {
      startToggleAnimation();
      setSidebarCollapsed(next);
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Persistence is best-effort; the in-memory choice still applies.
      }
    },
    [startToggleAnimation],
  );
  const toggleSidebarCollapsed = useCallback(() => {
    startToggleAnimation();
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Persistence is best-effort; the in-memory choice still applies.
      }
      return next;
    });
  }, [startToggleAnimation]);

  // Drag the handle between the sidebar and the page: the sidebar follows the
  // pointer between 216px and 312px; letting go after dragging it nearly shut
  // hides it.
  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      // Start from what is on screen, which a narrow window may have
      // squeezed below the stored width.
      const startWidth = effectiveSidebarWidth;
      const direction = document.dir === "rtl" ? -1 : 1;
      let raw = startWidth;
      setResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (move: PointerEvent) => {
        raw = startWidth + (move.clientX - startX) * direction;
        setSidebarWidth(clampSidebarWidth(raw));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setResizing(false);
        const width = clampSidebarWidth(raw);
        try {
          localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
        } catch {
          // Best-effort.
        }
        if (raw < COLLAPSE_DRAG_THRESHOLD) setCollapsed(true);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [effectiveSidebarWidth, setCollapsed],
  );

  // ⌘\ / Ctrl+\ toggles the sidebar: the desktop column, or the drawer on
  // narrow screens where there is no column to collapse.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key !== "\\") return;
      event.preventDefault();
      if (window.matchMedia(DESKTOP_QUERY).matches) {
        toggleSidebarCollapsed();
      } else {
        setMobileSheetOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebarCollapsed]);

  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  // The timeline scopes the sidebar to its space; every other page shows all.
  const space: MemoSpace = timeline?.space ?? "all";

  const currentUserQuery = useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: getCurrentFlareMoUser,
    staleTime: 60_000,
    retry: false,
  });
  const tagHierarchyQuery = useQuery({
    // Same key as the timeline's own query so the page issues one request.
    queryKey: queryKeys.tagHierarchy.forSpace(space),
    queryFn: () => getTagHierarchy(space),
    staleTime: 30_000,
    retry: false,
  });
  const statsQuery = useQuery({
    queryKey: queryKeys.memoStats.forWindow(
      space,
      timeZone,
      ACTIVITY_WINDOW_DAYS,
    ),
    queryFn: () => getMemoStats(timeZone, space, ACTIVITY_WINDOW_DAYS),
    staleTime: 30_000,
    retry: false,
  });

  const {
    deleteTagMutation,
    handleMutationError,
    invalidateWorkspace,
    renameTagMutation,
  } = useMemoMutations();
  const { handleExport, handleImportFile } = useDataTransfer({
    handleMutationError,
    invalidateWorkspace,
  });

  const stats = statsQuery.data ?? EMPTY_STATS;
  const onTimeline = timeline !== null;
  const activeTag = timeline?.tag;
  const untagged = timeline?.untagged ?? false;
  const deleteTag = deleteTagMutation.mutate;
  const renameTag = renameTagMutation.mutate;

  const explorer: WorkspaceSidebarContent = useMemo(
    () => ({
      activeTag,
      hierarchy: tagHierarchyQuery.data?.tags ?? [],
      hierarchyPending: tagHierarchyQuery.isPending,
      space,
      stats,
      timeZone,
      untagged,
      user: currentUserQuery.data,
      onDeleteTag: (tag) => deleteTag(tag),
      onExport: handleExport,
      onImportFile: handleImportFile,
      onOpenSettings: () => setAccountSettingsOpen(true),
      onRenameTag: (from, to) => renameTag({ from, to }),
      // On the timeline a tag click filters in place; from any other page it
      // jumps to the timeline with the filter applied.
      onTagChange: (tag) => {
        setMobileSheetOpen(false);
        if (onTimeline) {
          void navigate({
            from: "/",
            to: "/",
            replace: true,
            search: (current) => ({ ...current, tag, untagged: undefined }),
          });
        } else {
          void navigate({ to: "/", search: { ...TIMELINE_SEARCH, tag } });
        }
      },
      onToggleCollapsed: toggleSidebarCollapsed,
      onUntaggedChange: (next) => {
        setMobileSheetOpen(false);
        if (onTimeline) {
          void navigate({
            from: "/",
            to: "/",
            replace: true,
            search: (current) => ({
              ...current,
              tag: undefined,
              untagged: next || undefined,
            }),
          });
        } else {
          void navigate({
            to: "/",
            search: { ...TIMELINE_SEARCH, untagged: next || undefined },
          });
        }
      },
    }),
    [
      activeTag,
      currentUserQuery.data,
      deleteTag,
      handleExport,
      handleImportFile,
      navigate,
      onTimeline,
      renameTag,
      space,
      stats,
      tagHierarchyQuery.data?.tags,
      tagHierarchyQuery.isPending,
      timeZone,
      toggleSidebarCollapsed,
      untagged,
    ],
  );

  const value = useMemo<WorkspaceShellValue>(
    () => ({
      explorer,
      mobileSheetOpen,
      setMobileSheetOpen,
      sidebarCollapsed,
      toggleSidebarCollapsed,
    }),
    [explorer, mobileSheetOpen, sidebarCollapsed, toggleSidebarCollapsed],
  );

  return (
    <WorkspaceShellContext.Provider value={value}>
      <div className="h-svh overflow-hidden bg-background">
        {/* flomo's frame: [gutter | sidebar | resize handle | 640px column |
            gutter], centered as one group. The group's offset is computed
            from the 640px column on every page, so a wider page (the to-do
            board, articles) grows to the right from the same left edge and
            the sidebar never moves on navigation. Showing or hiding the
            sidebar eases its width and the group's offset together. */}
        <div
          className={cn(
            "flex h-full md:ms-(--frame-offset)",
            animating &&
              "motion-safe:transition-[margin] motion-safe:duration-[400ms] motion-safe:ease-in-out",
          )}
          data-sidebar-collapsed={sidebarCollapsed || undefined}
          style={
            {
              "--frame-offset": `max(0px, calc((100vw - ${
                (sidebarCollapsed
                  ? 0
                  : FRAME_GUTTER + effectiveSidebarWidth + RESIZER_WIDTH) +
                DEFAULT_CONTENT_MAX_WIDTH
              }px) / 2))`,
            } as CSSProperties
          }
        >
          {/* The sidebar's leading gutter; it goes with the sidebar. */}
          <div
            aria-hidden="true"
            className={cn(
              "hidden shrink-0 md:block",
              animating &&
                "motion-safe:transition-[width] motion-safe:duration-[400ms] motion-safe:ease-in-out",
            )}
            style={{ width: sidebarCollapsed ? 0 : FRAME_GUTTER }}
          />
          <WorkspaceSidebar
            animate={animating}
            collapsed={sidebarCollapsed}
            explorer={explorer}
            resizing={resizing}
            width={effectiveSidebarWidth}
            onResizeStart={startResize}
          />
          <div className="relative flex h-full min-w-0 flex-1 flex-col">
            <SidebarToggle
              animate={animating}
              collapsed={sidebarCollapsed}
              onToggle={toggleSidebarCollapsed}
            />
            {children}
          </div>
        </div>
        <Suspense fallback={null}>
          {accountSettingsOpen && (
            <AccountSettingsDialog
              open
              onClose={() => setAccountSettingsOpen(false)}
            />
          )}
        </Suspense>
      </div>
    </WorkspaceShellContext.Provider>
  );
}
