import { DirectionProvider } from "@base-ui/react/direction-provider";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import {
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import {
  getDailyReview,
  getMemoContext,
  getRelatedMemos,
  listArticles,
  listMemories,
  listProjects,
} from "@/api";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isRtlLocale, useI18n } from "@/i18n";
import { todayKey } from "@/lib/calendar-date";
import { allTasksQuery, isTaskView, type TaskView } from "@/lib/task-views";
import { AuthenticatedRoute } from "@/routes/authenticated-route";
import { indexRoute } from "@/routes/index-route";
import { rootRoute } from "@/routes/root-route";
import { RouteLoading } from "@/routes/route-loading";

/**
 * Route loaders warm query caches without ever blocking navigation: a failed
 * or slow fetch must not turn into a broken route, so the promise is fired
 * and forgotten. The component's useQuery joins the in-flight request.
 */
function warmQuery(promise: Promise<unknown>) {
  void promise.catch(() => undefined);
}

const MemoDetailPage = lazy(() =>
  import("@/pages/memo-detail-page").then((module) => ({
    default: module.MemoDetailPage,
  })),
);
const PublicSharePage = lazy(() =>
  import("@/pages/public-share-page").then((module) => ({
    default: module.PublicSharePage,
  })),
);
const LoginPage = lazy(() =>
  import("@/pages/login-page").then((module) => ({
    default: module.LoginPage,
  })),
);
const RegisterPage = lazy(() =>
  import("@/pages/register-page").then((module) => ({
    default: module.RegisterPage,
  })),
);
const ResetPage = lazy(() =>
  import("@/pages/reset-page").then((module) => ({
    default: module.ResetPage,
  })),
);
const VerifyEmailPage = lazy(() =>
  import("@/pages/verify-email-page").then((module) => ({
    default: module.VerifyEmailPage,
  })),
);
const ForgotPasswordPage = lazy(() =>
  import("@/pages/forgot-password-page").then((module) => ({
    default: module.ForgotPasswordPage,
  })),
);
const VerifyEmailChangePage = lazy(() =>
  import("@/pages/verify-email-change-page").then((module) => ({
    default: module.VerifyEmailChangePage,
  })),
);
const RecoverPage = lazy(() =>
  import("@/pages/recover-page").then((module) => ({
    default: module.RecoverPage,
  })),
);
const SetupPage = lazy(() =>
  import("@/pages/setup-page").then((module) => ({
    default: module.SetupPage,
  })),
);
const AccountPage = lazy(() =>
  import("@/pages/account-page").then((module) => ({
    default: module.AccountPage,
  })),
);
const DailyReviewPage = lazy(() =>
  import("@/pages/daily-review-page").then((module) => ({
    default: module.DailyReviewPage,
  })),
);
const RandomWalkPage = lazy(() =>
  import("@/pages/random-walk-page").then((module) => ({
    default: module.RandomWalkPage,
  })),
);
const MemoryPage = lazy(() =>
  import("@/pages/memory-page").then((module) => ({
    default: module.MemoryPage,
  })),
);
const ProjectsPage = lazy(() =>
  import("@/pages/projects-page").then((module) => ({
    default: module.ProjectsPage,
  })),
);
const CapturePage = lazy(() =>
  import("@/pages/capture-page").then((module) => ({
    default: module.CapturePage,
  })),
);
const ArticlesPage = lazy(() =>
  import("@/pages/articles-page").then((module) => ({
    default: module.ArticlesPage,
  })),
);
const ArticleEditorPage = lazy(() =>
  import("@/pages/article-editor-page").then((module) => ({
    default: module.ArticleEditorPage,
  })),
);

function PublicShareRoutePage() {
  const { token } = shareRoute.useParams();
  return (
    <Suspense fallback={<RouteLoading />}>
      <PublicSharePage token={token} />
    </Suspense>
  );
}

const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/share/$token",
  component: PublicShareRoutePage,
});

function MemoDetailRoutePage() {
  const { memoId } = memoRoute.useParams();
  return (
    <AuthenticatedRoute>
      <Suspense fallback={<RouteLoading />}>
        <MemoDetailPage memoId={memoId} />
      </Suspense>
    </AuthenticatedRoute>
  );
}

const memoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/memo/$memoId",
  component: MemoDetailRoutePage,
  // Intent preload already warms the JS chunk; this warms the data so the
  // page (hover-prefetched from memo cards, cold on direct visits) paints
  // with content on the first render instead of a full-page skeleton.
  loader: ({ context, params }) => {
    warmQuery(
      context.queryClient.ensureQueryData({
        queryKey: ["memo-context", params.memoId],
        queryFn: () => getMemoContext(params.memoId),
      }),
    );
    warmQuery(
      context.queryClient.ensureQueryData({
        queryKey: ["memo-related", params.memoId],
        queryFn: () => getRelatedMemos(params.memoId),
      }),
    );
  },
});

function LoginRoutePage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <LoginPage />
    </Suspense>
  );
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginRoutePage,
  // The auth guard preserves the intended destination under `redirect`;
  // only same-origin relative paths are accepted (open-redirect guard).
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    if (
      typeof search.redirect === "string" &&
      search.redirect.startsWith("/") &&
      !search.redirect.startsWith("//")
    ) {
      return { redirect: search.redirect };
    }
    return {};
  },
});

function RegisterRoutePage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <RegisterPage />
    </Suspense>
  );
}

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register",
  component: RegisterRoutePage,
});

function VerifyEmailRoutePage() {
  const { token } = verifyEmailRoute.useSearch();
  if (!token) {
    return (
      <Suspense fallback={<RouteLoading />}>
        <VerifyEmailPage token="" />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<RouteLoading />}>
      <VerifyEmailPage token={token} />
    </Suspense>
  );
}

const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/verify-email",
  component: VerifyEmailRoutePage,
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
});

function ForgotPasswordRoutePage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <ForgotPasswordPage />
    </Suspense>
  );
}

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  component: ForgotPasswordRoutePage,
});

function VerifyEmailChangeRoutePage() {
  const { token } = verifyEmailChangeRoute.useSearch();
  return (
    <Suspense fallback={<RouteLoading />}>
      <VerifyEmailChangePage token={token ?? ""} />
    </Suspense>
  );
}

const verifyEmailChangeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/verify-email-change",
  component: VerifyEmailChangeRoutePage,
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
});

function ResetRoutePage() {
  const { token } = resetRoute.useSearch();
  return (
    <Suspense fallback={<RouteLoading />}>
      <ResetPage token={token} />
    </Suspense>
  );
}

const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset",
  component: ResetRoutePage,
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
});

function RecoverRoutePage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <RecoverPage />
    </Suspense>
  );
}

const recoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recover",
  component: RecoverRoutePage,
});

function SetupRoutePage() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <SetupPage />
    </Suspense>
  );
}

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  component: SetupRoutePage,
});

function AccountRoutePage() {
  return (
    <AuthenticatedRoute>
      <Suspense fallback={<RouteLoading />}>
        <AccountPage />
      </Suspense>
    </AuthenticatedRoute>
  );
}

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account",
  component: AccountRoutePage,
  // Deep links (e.g. the capture page's "enable voice" hint) can open a
  // specific settings section.
  validateSearch: (search: Record<string, unknown>): { section?: string } => ({
    section: typeof search.section === "string" ? search.section : undefined,
  }),
});

function DailyReviewRoutePage() {
  return (
    <AuthenticatedRoute>
      <Suspense fallback={<RouteLoading />}>
        <DailyReviewPage />
      </Suspense>
    </AuthenticatedRoute>
  );
}

const dailyReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review/daily",
  component: DailyReviewRoutePage,
  loader: ({ context }) => {
    const today = todayKey();
    const tzOffset = -new Date().getTimezoneOffset();
    warmQuery(
      context.queryClient.ensureQueryData({
        queryKey: ["daily-review", today, tzOffset],
        queryFn: () => getDailyReview(today, tzOffset),
      }),
    );
  },
});

function RandomWalkRoutePage() {
  return (
    <AuthenticatedRoute>
      <Suspense fallback={<RouteLoading />}>
        <RandomWalkPage />
      </Suspense>
    </AuthenticatedRoute>
  );
}

const randomWalkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review/walk",
  component: RandomWalkRoutePage,
});

function MemoryRoutePage() {
  return (
    <AuthenticatedRoute>
      <Suspense fallback={<RouteLoading />}>
        <MemoryPage />
      </Suspense>
    </AuthenticatedRoute>
  );
}

const memoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/memory",
  component: MemoryRoutePage,
  loader: ({ context }) => {
    warmQuery(
      context.queryClient.ensureQueryData({
        queryKey: ["memories", "list"],
        queryFn: () => listMemories(),
      }),
    );
  },
});

function ProjectsRoutePage() {
  return (
    <AuthenticatedRoute>
      <Suspense fallback={<RouteLoading />}>
        <ProjectsPage />
      </Suspense>
    </AuthenticatedRoute>
  );
}

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  // A to-do view (today / upcoming / all) or one project, so reminders and
  // memo badges can deep-link to the exact list.
  validateSearch: (
    search: Record<string, unknown>,
  ): { view?: TaskView; project?: string } => ({
    view: isTaskView(search.view) ? search.view : undefined,
    project:
      typeof search.project === "string" && search.project
        ? search.project
        : undefined,
  }),
  component: ProjectsRoutePage,
  loader: ({ context }) => {
    warmQuery(
      context.queryClient.ensureQueryData({
        queryKey: ["projects"],
        queryFn: () => listProjects(),
      }),
    );
    // Same key as the board's default all-tasks view and the mini calendar.
    warmQuery(context.queryClient.ensureQueryData(allTasksQuery));
  },
});

function CaptureRoutePage() {
  return (
    <AuthenticatedRoute>
      <Suspense fallback={<RouteLoading />}>
        <CapturePage />
      </Suspense>
    </AuthenticatedRoute>
  );
}

const captureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/capture",
  component: CaptureRoutePage,
});

function ArticlesRoutePage() {
  return (
    <AuthenticatedRoute>
      <Suspense fallback={<RouteLoading />}>
        <ArticlesPage />
      </Suspense>
    </AuthenticatedRoute>
  );
}

const articlesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/articles",
  component: ArticlesRoutePage,
  loader: ({ context }) => {
    warmQuery(
      context.queryClient.ensureQueryData({
        queryKey: ["articles"],
        queryFn: () => listArticles({ include_deleted: true }),
      }),
    );
  },
});

function ArticleEditorRoutePage() {
  const { articleId } = articleEditRoute.useParams();
  return (
    <AuthenticatedRoute>
      <Suspense fallback={<RouteLoading />}>
        <ArticleEditorPage articleId={articleId} />
      </Suspense>
    </AuthenticatedRoute>
  );
}

const articleEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/articles/$articleId/edit",
  component: ArticleEditorRoutePage,
});

const router = createRouter({
  defaultPreload: "intent",
  // The real QueryClient is injected by AppRoutes (inside
  // QueryClientProvider) through RouterProvider's context prop; the typed
  // placeholder keeps route loader signatures aware of it.
  context: { queryClient: undefined as unknown as QueryClient },
  routeTree: rootRoute.addChildren([
    indexRoute,
    memoRoute,
    shareRoute,
    loginRoute,
    registerRoute,
    verifyEmailRoute,
    forgotPasswordRoute,
    verifyEmailChangeRoute,
    resetRoute,
    recoverRoute,
    setupRoute,
    accountRoute,
    dailyReviewRoute,
    randomWalkRoute,
    memoryRoute,
    projectsRoute,
    captureRoute,
    articlesRoute,
    articleEditRoute,
  ]),
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// DirectionProvider 开关镜像菜单/弹层的 RTL 行为；dir 属性与视觉排版
// 由 I18nProvider 与 CSS 各自负责（Base UI 不代管 HTML）。
function DirectionalRoutes() {
  const { locale } = useI18n();
  const queryClient = useQueryClient();
  return (
    <DirectionProvider direction={isRtlLocale(locale) ? "rtl" : "ltr"}>
      <RouterProvider context={{ queryClient }} router={router} />
      <Toaster />
    </DirectionProvider>
  );
}

export function AppRoutes() {
  return (
    <TooltipProvider>
      <DirectionalRoutes />
    </TooltipProvider>
  );
}
