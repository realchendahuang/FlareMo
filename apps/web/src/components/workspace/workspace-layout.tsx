import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  lazy,
  type ReactNode,
  type RefObject,
  Suspense,
  type UIEvent,
  useCallback,
  useState,
} from "react";
import {
  getCurrentFlareMoUser,
  getMemoStats,
  getTagHierarchy,
  type MemoStatsResponse,
} from "@/api";
import {
  WorkspaceSidebar,
  type WorkspaceSidebarContent,
} from "@/components/workspace/workspace-sidebar";
import { useDataTransfer } from "@/hooks/use-data-transfer";
import { useMemoMutations } from "@/hooks/use-memo-mutations";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

const AccountSettingsDialog = lazy(() =>
  import("@/pages/account-page").then((module) => ({
    default: module.AccountSettingsDialog,
  })),
);

const SIDEBAR_COLLAPSED_KEY = "flaremo.sidebar.collapsed";

const EMPTY_STATS: MemoStatsResponse = {
  counts: { normal: 0, archived: 0, trashed: 0, total: 0 },
  active_days: 0,
  tags: [],
  activity: [],
};

export type WorkspaceHeaderRenderProps = {
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
  mobileSheetOpen: boolean;
  setMobileSheetOpen: (open: boolean) => void;
  explorer: WorkspaceSidebarContent;
};

export type WorkspaceLayoutProps = {
  header: (props: WorkspaceHeaderRenderProps) => ReactNode;
  children: ReactNode;
  mainRef?: RefObject<HTMLElement | null>;
  onScroll?: (event: UIEvent<HTMLElement>) => void;
  maxWidthClass?: string;
};

export function WorkspaceLayout({
  header,
  children,
  mainRef,
  onScroll,
  maxWidthClass = "max-w-[640px]",
}: WorkspaceLayoutProps) {
  const navigate = useNavigate();
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Persistence is best-effort
      }
      return next;
    });
  }, []);

  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );

  const currentUserQuery = useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: getCurrentFlareMoUser,
    staleTime: 60_000,
  });

  const tagHierarchyQuery = useQuery({
    queryKey: ["tag-hierarchy", "all"],
    queryFn: () => getTagHierarchy("all"),
    staleTime: 30_000,
  });

  const statsQuery = useQuery({
    queryKey: ["memo-stats", "all", timeZone],
    queryFn: () => getMemoStats(timeZone, "all"),
    staleTime: 30_000,
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

  const stats: MemoStatsResponse = statsQuery.data ?? EMPTY_STATS;

  const sidebarContent: WorkspaceSidebarContent = {
    hierarchy: tagHierarchyQuery.data?.tags ?? [],
    hierarchyPending: tagHierarchyQuery.isPending,
    stats,
    untagged: false,
    user: currentUserQuery.data,
    onDeleteTag: (tag) => deleteTagMutation.mutate(tag),
    onExport: handleExport,
    onImportFile: handleImportFile,
    onOpenSettings: () => setAccountSettingsOpen(true),
    onRenameTag: (from, to) => renameTagMutation.mutate({ from, to }),
    // Tag filters live on the timeline; from any other workspace page a tag
    // click jumps there with the filter applied instead of doing nothing.
    onTagChange: (tag) => {
      setMobileSheetOpen(false);
      void navigate({ to: "/", search: { tag } });
    },
    onToggleCollapsed: toggleSidebarCollapsed,
    onUntaggedChange: (next) => {
      setMobileSheetOpen(false);
      void navigate({ to: "/", search: { untagged: next || undefined } });
    },
  };

  return (
    <div className="h-svh overflow-hidden bg-background">
      <div className="mx-auto flex h-full w-full max-w-[950px]">
        <WorkspaceSidebar
          collapsed={sidebarCollapsed}
          explorer={sidebarContent}
        />
        <div className="flex h-full min-w-0 flex-1 flex-col">
          {header({
            sidebarCollapsed,
            toggleSidebarCollapsed,
            mobileSheetOpen,
            setMobileSheetOpen,
            explorer: sidebarContent,
          })}
          <main
            ref={mainRef}
            className={cn(
              "mx-auto min-h-0 w-full flex-1 overflow-y-auto px-5 pt-1 pb-8 lg:px-3",
              maxWidthClass,
            )}
            onScroll={onScroll}
          >
            {children}
          </main>
        </div>
      </div>
      <Suspense fallback={null}>
        {accountSettingsOpen && (
          <AccountSettingsDialog
            open={accountSettingsOpen}
            onClose={() => setAccountSettingsOpen(false)}
          />
        )}
      </Suspense>
    </div>
  );
}
