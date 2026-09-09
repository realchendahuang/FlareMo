import { createRootRoute, Outlet, useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";

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

export const rootRoute = createRootRoute({
  component: () => <Outlet />,
  errorComponent: RouteErrorPage,
});
