import { useQueryClient } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useRouter,
} from "@tanstack/react-router";
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { FlareMoApp } from "@/App";
import { AUTHENTICATION_REQUIRED_EVENT } from "@/api";
import { authClient } from "@/auth-client";
import type { ExplorerView as ViewMode } from "@/components/flaremo-explorer";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";

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

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  errorComponent: RouteErrorPage,
});

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: ProtectedWorkspaceRoutePage,
  validateSearch: (search: Record<string, unknown>) => ({
    view: isViewMode(search.view) ? search.view : undefined,
    q: typeof search.q === "string" && search.q ? search.q : undefined,
    tag: typeof search.tag === "string" && search.tag ? search.tag : undefined,
    untagged:
      search.untagged === true || search.untagged === "true" ? true : undefined,
  }),
});

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

function ProtectedWorkspaceRoutePage() {
  return (
    <AuthenticatedRoute>
      <FlareMoApp />
    </AuthenticatedRoute>
  );
}

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

function AuthenticatedRoute({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const [authenticationRequired, setAuthenticationRequired] = useState(false);

  useEffect(() => {
    const handleAuthenticationRequired = () => {
      queryClient.clear();
      setAuthenticationRequired(true);
    };
    window.addEventListener(
      AUTHENTICATION_REQUIRED_EVENT,
      handleAuthenticationRequired,
    );
    return () =>
      window.removeEventListener(
        AUTHENTICATION_REQUIRED_EVENT,
        handleAuthenticationRequired,
      );
  }, [queryClient]);

  if (session.isPending) {
    return <RouteLoading />;
  }
  if (authenticationRequired || !session.data?.user) {
    return <Navigate replace to="/login" />;
  }
  return children;
}

// TanStack Router's ErrorComponentProps carries `error: unknown`; narrow it
// defensively instead of assuming an Error instance.
function RouteErrorPage({ error }: { error: unknown }) {
  const { t } = useI18n();
  const router = useRouter();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col items-center justify-center gap-4 px-5 text-center">
      <div>
        <h1 className="text-lg font-semibold">{t("list.errorTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </div>
      <Button onClick={() => void router.invalidate()}>
        {t("common.retry")}
      </Button>
    </main>
  );
}

function RouteLoading() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
      {t("common.loading")}
    </main>
  );
}

function isViewMode(value: unknown): value is ViewMode {
  return value === "all" || value === "archived" || value === "trashed";
}

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
