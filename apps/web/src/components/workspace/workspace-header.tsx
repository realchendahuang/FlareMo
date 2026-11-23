import { ArchiveIcon, LayoutGridIcon, Trash2Icon } from "lucide-react";
import type { MemoSpace } from "@/api";
import type { ExplorerView } from "@/components/flaremo-explorer";
import { ScopeSwitcher } from "@/components/scope-switcher";
import { SpotlightSearchTrigger } from "@/components/spotlight-search";
import { WorkspacePageHeader } from "@/components/workspace/workspace-page-header";
import type { WorkspaceSidebarContent } from "@/components/workspace/workspace-sidebar";
import { useI18n } from "@/i18n";

/**
 * The timeline top bar. The title names the page the sidebar opened (memos,
 * archive or trash), like every other page; the right side holds what narrows
 * it: the space filter (only with a shared team) and the search entry.
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
  /** Kept for call-site parity; archive and trash are sidebar pages now. */
  setView?: (view: ExplorerView) => void;
  sidebarCollapsed: boolean;
  space: MemoSpace;
  team: { id: string; name: string } | null;
  /** The shell's toggle owns collapsing; kept for call-site parity. */
  toggleSidebarCollapsed?: () => void;
  view: ExplorerView;
}) {
  const { t } = useI18n();
  const [Icon, title] =
    view === "archived"
      ? [ArchiveIcon, t("view.archive")]
      : view === "trashed"
        ? [Trash2Icon, t("view.trash")]
        : [LayoutGridIcon, t("nav.allMemos")];

  return (
    <WorkspacePageHeader
      explorer={explorer}
      icon={<Icon />}
      isScrolled={isTimelineScrolled}
      mobileSheetOpen={mobileSheetOpen}
      setMobileSheetOpen={setMobileSheetOpen}
      sidebarCollapsed={sidebarCollapsed}
      title={title}
      actions={
        <>
          <ScopeSwitcher
            activeSpace={space}
            team={team}
            onSpaceChange={setSpace}
          />
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
        </>
      }
    />
  );
}
