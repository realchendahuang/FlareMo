import type { MemoSpace } from "@/api";
import type { ExplorerView } from "@/components/flaremo-explorer";
import { ScopeSwitcher } from "@/components/scope-switcher";
import { SpotlightSearchTrigger } from "@/components/spotlight-search";
import { usePageContentWidth } from "@/components/workspace/workspace-layout";
import { useWorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  SidebarToggleButton,
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
  isTimelineScrolled,
  mobileSheetOpen,
  setMobileSheetOpen,
  setQuery,
  setSpace,
  setSpotlightOpen,
  setView,
  sidebarCollapsed,
  space,
  team,
  toggleSidebarCollapsed,
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
  toggleSidebarCollapsed: () => void;
  view: ExplorerView;
}) {
  const { setPeekIntent } = useWorkspaceShell();
  const contentWidth = usePageContentWidth();

  return (
    <header
      className={cn(
        "z-20 shrink-0 border-b bg-background/90 backdrop-blur-md motion-safe:transition-[border-color,box-shadow] motion-safe:duration-200",
        isTimelineScrolled ? "border-border shadow-xs" : "border-transparent",
      )}
    >
      {/* The bar spans the whole area beside the sidebar (its hairline and
          blur run edge to edge); its row is centered at the page's content
          width so the title lines up with the column below it. */}
      <div
        className="mx-auto flex h-14 w-full items-center gap-2 px-5 lg:px-3"
        style={{ maxWidth: contentWidth }}
      >
        <div
          className={cn(
            "hidden items-center overflow-hidden lg:flex motion-safe:transition-[width,opacity,margin] motion-safe:duration-300 motion-safe:ease-signal",
            sidebarCollapsed
              ? "w-8 opacity-100"
              : "pointer-events-none -me-2 w-0 opacity-0",
          )}
          inert={!sidebarCollapsed}
        >
          <SidebarToggleButton
            action="expand"
            onClick={toggleSidebarCollapsed}
            onPointerEnter={() => setPeekIntent(true)}
            onPointerLeave={() => setPeekIntent(false)}
          />
        </div>
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
          <SpotlightSearchTrigger
            className="hidden md:flex"
            onClick={() => setSpotlightOpen(true)}
            activeQuery={activeQuery}
            onClear={() => setQuery("")}
          />
          {/* Small screens search from the box above the timeline, which
              also carries the semantic toggle; a second icon here was a
              duplicate way into the same thing. */}
        </div>
      </div>
    </header>
  );
}
