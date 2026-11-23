import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";
import { RootLayout } from "@/components/root-layout";
import { loadHomeContent } from "@/content/copy";
import { loadShowcaseContent } from "@/content/showcase-i18n";
import { getDoc } from "@/lib/docs-source.generated";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@/lib/seo";
import { DocsIndexPage } from "@/pages/docs-index-page";
import { NotFoundPage } from "@/pages/not-found-page";

const DocsDetailPage = lazyRouteComponent(
  () => import("@/pages/docs-detail-page"),
  "DocsDetailPage",
);
const HomePage = lazyRouteComponent(
  () => import("@/pages/home-page"),
  "HomePage",
);

export type History = ReturnType<typeof createRouter>["history"];

function loadHomeRouteData(locale: SupportedLocale) {
  return Promise.all([
    loadHomeContent(locale),
    loadShowcaseContent(locale),
  ]).then(([home, showcase]) => ({ home, showcase }));
}

/**
 * Code-based route tree, mirroring the shape of apps/web/src/App.tsx so the
 * marketing site stays on the exact same TanStack Router stack as the product.
 */
export function buildRouteTree() {
  const rootRoute = createRootRoute({
    component: RootLayout,
    // Every unmatched path (client-side navigation and the prerendered 404
    // shell) resolves through this component; the `*` route alone only
    // covered the route tree, not the router's own not-found path.
    notFoundComponent: NotFoundPage,
  });

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: HomePage,
    loader: () => loadHomeRouteData("en"),
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
    loader: ({ params }) =>
      getDoc(params.slug, "en-US").then((doc) => ({ doc })),
  });

  const notFoundRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "*",
    component: NotFoundPage,
  });

  const localeRoutes = SUPPORTED_LOCALES.flatMap((locale) => [
    createRoute({
      getParentRoute: () => rootRoute,
      path: `/${locale}`,
      component: HomePage,
      loader: () => loadHomeRouteData(locale),
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `/${locale}/docs`,
      component: DocsIndexPage,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `/${locale}/docs/$slug`,
      component: DocsDetailPage,
      loader: ({ params }) =>
        getDoc(params.slug, locale === "zh" ? "zh-CN" : "en-US").then(
          (doc) => ({ doc }),
        ),
    }),
  ]);

  const routeTree = rootRoute.addChildren([
    indexRoute,
    docsIndexRoute,
    docsSlugRoute,
    ...localeRoutes,
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
