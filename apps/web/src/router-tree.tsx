import {
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthenticatedRoute } from "@/routes/authenticated-route";
import { indexRoute } from "@/routes/index-route";
import { rootRoute } from "@/routes/root-route";
import { RouteLoading } from "@/routes/route-loading";

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
  component: ProjectsRoutePage,
});

const router = createRouter({
  defaultPreload: "intent",
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
  ]),
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function AppRoutes() {
  return (
    <TooltipProvider>
      <RouterProvider router={router} />
      <Toaster />
    </TooltipProvider>
  );
}
