import { createRoute } from "@tanstack/react-router";
import type { ComponentType } from "react";
import type { ExplorerView as ViewMode } from "@/components/flaremo-explorer";
import { AuthenticatedRoute } from "@/routes/authenticated-route";
import { rootRoute } from "@/routes/root-route";
import { RouteLoading } from "@/routes/route-loading";

// The workspace component is injected by App.tsx through
// `registerWorkspaceComponent` at module-eval time. This module must not
// import `@/App`: App imports `indexRoute` from here, so a static import
// back would recreate the App ↔ router-tree cycle this split exists to
// prevent, and a lazy wrapper here changes route-commit timing.
let WorkspaceComponent: ComponentType | undefined;

export function registerWorkspaceComponent(component: ComponentType) {
  WorkspaceComponent = component;
}

function WorkspaceRoutePage() {
  const Workspace = WorkspaceComponent;
  // Never reached in the app (App.tsx registers before first render); kept
  // so the route is honest if this module is ever mounted standalone.
  if (!Workspace) return <RouteLoading />;
  return (
    <AuthenticatedRoute>
      <Workspace />
    </AuthenticatedRoute>
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: WorkspaceRoutePage,
  validateSearch: (search: Record<string, unknown>) => ({
    view: isViewMode(search.view) ? search.view : undefined,
    q: typeof search.q === "string" && search.q ? search.q : undefined,
    tag: typeof search.tag === "string" && search.tag ? search.tag : undefined,
    untagged:
      search.untagged === true || search.untagged === "true" ? true : undefined,
    // Set by the PWA "new note" shortcut (`/?compose=1`) to focus the composer
    // on launch.
    compose:
      search.compose === true || search.compose === "1" ? true : undefined,
  }),
});

function isViewMode(value: unknown): value is ViewMode {
  return value === "all" || value === "archived" || value === "trashed";
}
