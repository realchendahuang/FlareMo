import type { MemoSpace } from "@/api";
import type { ExplorerView } from "@/components/flaremo-explorer";
import { ScopeSwitcher } from "@/components/scope-switcher";
import { SpotlightSearchTrigger } from "@/components/spotlight-search";
import { usePageContentWidth } from "@/components/workspace/workspace-layout";
import {
  SidebarToggleSlot,
  WorkspaceMobileSidebar,
  type WorkspaceSidebarContent,
} from "@/components/workspace/workspace-sidebar";
import { cn } from "@/lib/utils";

/**
 * The timeline top bar: sidebar toggle, scope switcher and the two spotlight
 * entries (desktop pill, mobile icon), plus the mobile sidebar trigger.
 */
export function WorkspaceHeader({
  activeQuery,
  explorer,
  sidebarCollapsed,
  isTimelineScrolled,
  mobileSheetOpen,
  setMobileSheetOpen,
  setQuery,
  setSpace,
  setSpotlightOpen,
  setView,
  space,
  team,
  view,
}: {
  /** Query shown in the spotlight pill; empty while a date filter owns it. */
  activeQuery: string;
  explorer: WorkspaceSidebarContent;
  isTimelineScrolled: boolean;
  mobileSheetOpen: boolean;
  setMobileSheetOpen: (open: boolean) => void;
  setQuery: (q: string) => void;
  setSpace: (space: MemoSpace) => void;
  setSpotlightOpen: (open: boolean) => void;
  setView: (view: ExplorerView) => void;
  sidebarCollapsed: boolean;
  space: MemoSpace;
  team: { id: string; name: string } | null;
  /** The shell's toggle owns collapsing; kept for call-site parity. */
  toggleSidebarCollapsed?: () => void;
  view: ExplorerView;
}) {
  const contentWidth = usePageContentWidth();

  return (
    <header
      className={cn(
        "z-20 shrink-0 border-b bg-background/90 backdrop-blur-md motion-safe:transition-[border-color,box-shadow] motion-safe:duration-200",
        isTimelineScrolled ? "border-border shadow-xs" : "border-transparent",
      )}
    >
      {/* The bar spans the whole area beside the sidebar (its hairline and
          blur run edge to edge); its row has the page's content width and
          starts where the column below starts, so the title lines up. */}
      <div
        className="mx-auto flex h-14 w-full items-center gap-1 px-5 md:ms-0 lg:px-2.5"
        style={{ maxWidth: contentWidth }}
      >
        <SidebarToggleSlot collapsed={sidebarCollapsed} />
        <WorkspaceMobileSidebar
          explorer={explorer}
          open={mobileSheetOpen}
          onOpenChange={setMobileSheetOpen}
        />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <ScopeSwitcher
            activeSpace={space}
            activeView={view}
            team={team}
            onSpaceChange={setSpace}
            onViewChange={setView}
          />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* One search everywhere: the same palette behind a field on wide
              screens and an icon on narrow ones. */}
          <SpotlightSearchTrigger
            className="hidden md:flex"
            onClick={() => setSpotlightOpen(true)}
            activeQuery={activeQuery}
            onClear={() => setQuery("")}
          />
          <SpotlightSearchTrigger
            compact
            className="md:hidden"
            onClick={() => setSpotlightOpen(true)}
            activeQuery={activeQuery}
          />
        </div>
      </div>
    </header>
  );
}
