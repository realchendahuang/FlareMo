import { LanguagesIcon } from "lucide-react";
import type { ReactNode } from "react";
import { FlareMoLogo } from "@/components/flaremo-logo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/i18n";

export function AuthPageFrame({
  children,
  description,
  eyebrow,
  title,
}: {
  children: ReactNode;
  description?: string;
  eyebrow?: string;
  title: string;
}) {
  const { t, toggleLocale } = useI18n();

  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-flame-700 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
        >
          <div className="absolute -top-32 -left-32 size-112 rounded-full bg-flame-500/50 blur-3xl" />
          <div className="absolute -right-24 -bottom-24 size-96 rounded-full bg-flame-coral/40 blur-3xl" />
        </div>
        <div className="relative flex items-center gap-2.5">
          <img
            alt=""
            aria-hidden="true"
            className="size-8"
            src="/brand/flaremo-mark-dark-320.png"
          />
          <span className="font-heading text-lg font-semibold tracking-tight text-flame-50">
            FlareMo
          </span>
        </div>
        <p className="relative max-w-md font-heading text-4xl font-semibold leading-snug tracking-tight text-flame-50">
          {t("auth.brandTagline")}
        </p>
      </aside>
      <div className="relative flex items-center justify-center bg-[radial-gradient(circle_at_top,_var(--color-flame-100),_transparent_42%)] px-4 py-8 dark:bg-[radial-gradient(circle_at_top,_color-mix(in_oklab,var(--color-flame-400)_15%,transparent),_transparent_42%)]">
        <header className="absolute inset-x-0 top-0 flex items-center justify-between p-4 lg:justify-end">
          <span className="lg:hidden">
            <FlareMoLogo labelClassName="text-lg" markClassName="size-7" />
          </span>
          <Button
            aria-label={t("language.toggle")}
            size="sm"
            title={t("language.toggle")}
            variant="ghost"
            onClick={toggleLocale}
          >
            <LanguagesIcon data-icon="inline-start" />
            {t("language.next")}
          </Button>
        </header>
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="gap-2">
            {eyebrow ? (
              <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">
                {eyebrow}
              </p>
            ) : null}
            <CardTitle className="text-xl">{title}</CardTitle>
            {description ? (
              <CardDescription>{description}</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </div>
    </main>
  );
}

export function errorMessage(error: unknown, fallback: string) {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }
  return fallback;
}
