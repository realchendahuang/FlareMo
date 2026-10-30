import type { ReactNode } from "react";
import { useWorkspaceShell } from "@/components/workspace/workspace-shell";
import type { WorkspaceSidebarContent } from "@/components/workspace/workspace-sidebar";
import {
  SidebarToggleButton,
  WorkspaceMobileSidebar,
} from "@/components/workspace/workspace-sidebar";
import { cn } from "@/lib/utils";

export function WorkspacePageHeader({
  icon,
  title,
  actions,
  explorer,
  mobileSheetOpen,
  setMobileSheetOpen,
  sidebarCollapsed,
  toggleSidebarCollapsed,
  isScrolled = false,
}: {
  icon?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  explorer: WorkspaceSidebarContent;
  mobileSheetOpen: boolean;
  setMobileSheetOpen: (open: boolean) => void;
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
  isScrolled?: boolean;
}) {
  const { setPeekIntent } = useWorkspaceShell();

  return (
    <header
      className={cn(
        "z-20 shrink-0 border-b bg-background/90 backdrop-blur-md motion-safe:transition-[border-color,box-shadow] motion-safe:duration-200",
        isScrolled ? "border-border shadow-xs" : "border-transparent",
      )}
    >
      {/* The header spans the content column, which the shell keeps at the
          page's width in both sidebar states; no re-centering here. */}
      <div className="mx-auto flex h-14 w-full items-center gap-2 px-5 lg:px-3">
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

        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* min-w-0 on the row as well as the parent: without it the flex
              item keeps its content width and `truncate` on the h1 has nothing
              to shrink into, so a long title ran under the actions. */}
          <div className="flex min-w-0 items-center gap-2 px-1">
            {icon}
            <h1 className="min-w-0 truncate text-[15px] leading-none font-semibold tracking-tight">
              {title}
            </h1>
          </div>
        </div>

        {actions && (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>
    </header>
  );
}
