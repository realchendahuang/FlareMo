import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { RootLayout } from "@/components/root-layout";
import { DocsDetailPage } from "@/pages/docs-detail-page";
import { DocsIndexPage } from "@/pages/docs-index-page";
import { HomePage } from "@/pages/home-page";
import { HostedPage } from "@/pages/hosted-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { PricingPage } from "@/pages/pricing-page";

export type History = ReturnType<typeof createRouter>["history"];

/**
 * Code-based route tree, mirroring the shape of apps/web/src/App.tsx so the
 * marketing site stays on the exact same TanStack Router stack as the product.
 */
export function buildRouteTree() {
  const rootRoute = createRootRoute({
    component: RootLayout,
  });

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: HomePage,
  });

  const pricingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/pricing",
    component: PricingPage,
  });

  const hostedRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/hosted",
    component: HostedPage,
  });

  const docsIndexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/docs",
    component: DocsIndexPage,
  });

  const docsSlugRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/docs/$slug",
    component: DocsDetailPage,
  });

  const enIndexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/en",
    component: HomePage,
  });

  const enPricingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/en/pricing",
    component: PricingPage,
  });

  const enHostedRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/en/hosted",
    component: HostedPage,
  });

  const enDocsIndexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/en/docs",
    component: DocsIndexPage,
  });

  const enDocsSlugRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/en/docs/$slug",
    component: DocsDetailPage,
  });

  const notFoundRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "*",
    component: NotFoundPage,
  });

  const routeTree = rootRoute.addChildren([
    indexRoute,
    pricingRoute,
    hostedRoute,
    docsIndexRoute,
    docsSlugRoute,
    enIndexRoute,
    enPricingRoute,
    enHostedRoute,
    enDocsIndexRoute,
    enDocsSlugRoute,
    notFoundRoute,
  ]);

  return { rootRoute, routeTree };
}

export function createAppRouter(opts?: {
  history?: ReturnType<typeof createRouter>["history"];
}) {
  const { routeTree } = buildRouteTree();
  return createRouter({
    routeTree,
    history: opts?.history,
    scrollRestoration: true,
    defaultPreload: "intent",
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
