import { useI18n } from "@/i18n";

export function RouteLoading() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
      {t("common.loading")}
    </main>
  );
}
