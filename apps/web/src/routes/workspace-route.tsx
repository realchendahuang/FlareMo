import { createRoute, Outlet } from "@tanstack/react-router";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { AuthenticatedRoute } from "@/routes/authenticated-route";
import { rootRoute } from "@/routes/root-route";

/**
 * While a page's chunk loads, only the content column waits: the header row
 * and the sidebar stay where they are, so navigating never blanks the frame.
 */
function WorkspaceContentLoading() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto flex w-full max-w-[640px] flex-col px-5 md:ms-0 lg:px-2.5 motion-safe:animate-fade"
    >
      <div className="flex h-14 items-center">
        <Skeleton className="h-5 w-24 rounded-md" />
      </div>
      <div className="flex flex-col gap-3 pt-1">
        {[0, 1].map((index) => (
          <div
            className="flex flex-col gap-2.5 rounded-xl border border-border/50 bg-card/50 p-4 shadow-xs"
            key={index}
          >
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-3/4 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkspaceRouteComponent() {
  return (
    <AuthenticatedRoute>
      <WorkspaceShell>
        <Suspense fallback={<WorkspaceContentLoading />}>
          <Outlet />
        </Suspense>
      </WorkspaceShell>
    </AuthenticatedRoute>
  );
}

/**
 * Pathless parent of every page that sits beside the explorer sidebar. Its
 * component stays mounted across navigation between its children, which is
 * what keeps the sidebar (and its scroll position) persistent.
 */
export const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "workspace",
  component: WorkspaceRouteComponent,
});
