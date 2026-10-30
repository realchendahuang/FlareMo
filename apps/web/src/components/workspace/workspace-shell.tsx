import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getCurrentFlareMoUser,
  getMemoStats,
  getTagHierarchy,
  type MemoSpace,
  type MemoStatsResponse,
} from "@/api";
import {
  WorkspaceSidebar,
  type WorkspaceSidebarContent,
  WorkspaceSidebarPeek,
} from "@/components/workspace/workspace-sidebar";
import { useDataTransfer } from "@/hooks/use-data-transfer";
import { useMemoMutations } from "@/hooks/use-memo-mutations";
import { queryKeys } from "@/lib/query-keys";
import { ACTIVITY_WINDOW_DAYS } from "@/lib/time-horizon";
import { TIMELINE_SEARCH } from "@/lib/timeline-search";

const AccountSettingsDialog = lazy(() =>
  import("@/pages/account-page").then((module) => ({
    default: module.AccountSettingsDialog,
  })),
);

// Persisted so a collapsed desktop sidebar stays collapsed across reloads.
const SIDEBAR_COLLAPSED_KEY = "flaremo.sidebar.collapsed";

/** Desktop sidebar width, and therefore the shell's gutter beside the content. */
export const WORKSPACE_SIDEBAR_WIDTH = 312;
/** Content column width of a page that does not ask for another. */
export const DEFAULT_CONTENT_MAX_WIDTH = 640;
/** Collapse/expand duration; the sidebar, the frame and the content share it. */
const SIDEBAR_MOTION_MS = 300;
/** Matches Tailwind's `lg` breakpoint, where the desktop sidebar appears. */
const DESKTOP_QUERY = "(min-width: 1024px)";

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
  /** Hover intent on the collapsed-state expand button opens the peek. */
  setPeekIntent: (open: boolean) => void;
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
  // Transitions only run while the sidebar itself is moving, so nothing
  // animates on first paint or on navigation.
  const [animating, setAnimating] = useState(false);
  const animationTimer = useRef<number | undefined>(undefined);
  const [peekOpen, setPeekOpen] = useState(false);
  const peekTimer = useRef<number | undefined>(undefined);
  const peekOpenRef = useRef(false);
  peekOpenRef.current = peekOpen;
  // Expanding while the peek is showing "pins" it: the floating panel already
  // sits exactly where the docked sidebar ends up, so it stays on screen while
  // the docked column grows underneath it and is then removed without any
  // motion. Without this the peek vanished and the docked sidebar slid in a
  // second time — the same panel appearing twice.
  const [pinning, setPinning] = useState(false);

  const toggleSidebarCollapsed = useCallback(() => {
    window.clearTimeout(animationTimer.current);
    window.clearTimeout(peekTimer.current);
    const pinPeek = peekOpenRef.current;
    setAnimating(true);
    setPinning(pinPeek);
    animationTimer.current = window.setTimeout(() => {
      setAnimating(false);
      setPinning(false);
    }, SIDEBAR_MOTION_MS + 50);
    setPeekOpen(false);
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Persistence is best-effort; the in-memory choice still applies.
      }
      return next;
    });
  }, []);

  // Hover intent with a short grace period both ways: a cursor that merely
  // grazes the edge must not flash the panel, and moving from the trigger
  // onto the panel must not close it in between.
  const setPeekIntent = useCallback((open: boolean) => {
    window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(
      () => setPeekOpen(open),
      open ? 120 : 260,
    );
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(animationTimer.current);
      window.clearTimeout(peekTimer.current);
    },
    [],
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
      setPeekIntent,
      sidebarCollapsed,
      toggleSidebarCollapsed,
    }),
    [
      explorer,
      mobileSheetOpen,
      setPeekIntent,
      sidebarCollapsed,
      toggleSidebarCollapsed,
    ],
  );

  return (
    <WorkspaceShellContext.Provider value={value}>
      <div className="h-svh overflow-hidden bg-background">
        {/* The sidebar is pinned to the window's leading edge and every page
            centers its own column in the space beside it. The sidebar's
            position therefore never depends on the page: switching between a
            640px timeline and a 1024px board leaves it exactly where it is.
            Collapsing animates only the sidebar's width; the page column,
            centered in the growing area, glides with it at its own width. */}
        <div
          className="flex h-full w-full"
          data-sidebar-collapsed={sidebarCollapsed || undefined}
        >
          <WorkspaceSidebar
            animating={animating && !pinning}
            collapsed={sidebarCollapsed}
            explorer={explorer}
            widthAnimating={animating}
          />
          <div className="flex h-full min-w-0 flex-1 flex-col">{children}</div>
        </div>
        {(sidebarCollapsed || pinning) && (
          <WorkspaceSidebarPeek
            explorer={explorer}
            open={peekOpen || pinning}
            pinned={pinning}
            onIntent={setPeekIntent}
          />
        )}
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
