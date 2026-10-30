import {
  createContext,
  type ReactNode,
  type RefObject,
  type UIEvent,
  useContext,
} from "react";
import {
  DEFAULT_CONTENT_MAX_WIDTH,
  useWorkspaceShell,
} from "@/components/workspace/workspace-shell";
import type { WorkspaceSidebarContent } from "@/components/workspace/workspace-sidebar";
import { cn } from "@/lib/utils";

export {
  DEFAULT_CONTENT_MAX_WIDTH,
  WORKSPACE_SIDEBAR_WIDTH,
} from "@/components/workspace/workspace-shell";

const PageWidthContext = createContext(DEFAULT_CONTENT_MAX_WIDTH);

/** The current page's content column width; page headers align to it. */
export function usePageContentWidth() {
  return useContext(PageWidthContext);
}

export type WorkspaceHeaderRenderProps = {
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
  mobileSheetOpen: boolean;
  setMobileSheetOpen: (open: boolean) => void;
  explorer: WorkspaceSidebarContent;
};

/**
 * One page inside the persistent WorkspaceShell: its header and its scrolling
 * content column. The sidebar, the account dialog and the collapse state
 * belong to the shell and survive navigation. The page centers its header row
 * and its content column in the area beside the sidebar at one width.
 */
export type WorkspaceLayoutProps = {
  header: (props: WorkspaceHeaderRenderProps) => ReactNode;
  children: ReactNode;
  mainRef?: RefObject<HTMLElement | null>;
  onScroll?: (event: UIEvent<HTMLElement>) => void;
  /** Content column width in px; the sidebar column is added on top of it. */
  contentMaxWidth?: number;
  mainClassName?: string;
};

export function WorkspaceLayout({
  header,
  children,
  mainRef,
  onScroll,
  contentMaxWidth = DEFAULT_CONTENT_MAX_WIDTH,
  mainClassName,
}: WorkspaceLayoutProps) {
  const {
    explorer,
    mobileSheetOpen,
    setMobileSheetOpen,
    sidebarCollapsed,
    toggleSidebarCollapsed,
  } = useWorkspaceShell();

  return (
    <PageWidthContext.Provider value={contentMaxWidth}>
      {header({
        sidebarCollapsed,
        toggleSidebarCollapsed,
        mobileSheetOpen,
        setMobileSheetOpen,
        explorer,
      })}
      <main
        ref={mainRef}
        className={cn(
          // Centered on narrow screens; on desktop the shell centers the
          // frame, and the column starts at the frame's content edge.
          "mx-auto min-h-0 w-full flex-1 overflow-y-auto px-5 pt-1 pb-8 md:ms-0 lg:px-2.5",
          mainClassName,
        )}
        onScroll={onScroll}
        style={{ maxWidth: contentMaxWidth }}
      >
        {children}
      </main>
    </PageWidthContext.Provider>
  );
}
