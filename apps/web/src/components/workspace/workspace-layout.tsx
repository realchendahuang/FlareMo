import {
  type ReactNode,
  type RefObject,
  type UIEvent,
  useLayoutEffect,
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
 * belong to the shell and survive navigation; a page only reports the width
 * of its content column, from which the shell derives the frame.
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
    setContentMaxWidth,
    setMobileSheetOpen,
    sidebarCollapsed,
    toggleSidebarCollapsed,
  } = useWorkspaceShell();

  // Layout effect: the frame must take the page's width before paint, or a
  // wide page would flash at the previous page's width for one frame.
  useLayoutEffect(() => {
    setContentMaxWidth(contentMaxWidth);
  }, [contentMaxWidth, setContentMaxWidth]);

  return (
    <>
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
          "mx-auto min-h-0 w-full flex-1 overflow-y-auto px-5 pt-1 pb-8 lg:px-3",
          mainClassName,
        )}
        onScroll={onScroll}
        style={{ maxWidth: contentMaxWidth }}
      >
        {children}
      </main>
    </>
  );
}
