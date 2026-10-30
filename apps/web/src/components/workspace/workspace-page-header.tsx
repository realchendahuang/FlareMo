import type { ReactNode } from "react";
import { usePageContentWidth } from "@/components/workspace/workspace-layout";
import type { WorkspaceSidebarContent } from "@/components/workspace/workspace-sidebar";
import { WorkspaceMobileSidebar } from "@/components/workspace/workspace-sidebar";
import { cn } from "@/lib/utils";

export function WorkspacePageHeader({
  icon,
  title,
  actions,
  explorer,
  mobileSheetOpen,
  setMobileSheetOpen,
  isScrolled = false,
}: {
  icon?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  explorer: WorkspaceSidebarContent;
  mobileSheetOpen: boolean;
  setMobileSheetOpen: (open: boolean) => void;
  /** Owned by the shell's fixed toggle now; accepted for call-site parity. */
  sidebarCollapsed?: boolean;
  toggleSidebarCollapsed?: () => void;
  isScrolled?: boolean;
}) {
  const contentWidth = usePageContentWidth();

  return (
    <header
      className={cn(
        "z-20 shrink-0 border-b bg-background/90 backdrop-blur-md motion-safe:transition-[border-color,box-shadow] motion-safe:duration-200",
        isScrolled ? "border-border shadow-xs" : "border-transparent",
      )}
    >
      {/* The bar spans the whole area beside the sidebar (its hairline and
          blur run edge to edge); its row is centered at the page's content
          width so the title lines up with the column below it. */}
      <div
        className="mx-auto flex h-14 w-full items-center gap-2 px-5 lg:px-3"
        style={{ maxWidth: contentWidth }}
      >
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
