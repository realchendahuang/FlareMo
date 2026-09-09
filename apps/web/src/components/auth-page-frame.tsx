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
        <div className="relative max-w-md py-16">
          <p className="mb-4 text-xs font-semibold tracking-[0.2em] text-flame-50/70 uppercase">
            {t("auth.brandEyebrow")}
          </p>
          <h1 className="max-w-sm font-heading text-4xl font-semibold leading-tight tracking-tight text-flame-50 xl:text-5xl">
            {t("auth.brandTitle")}
          </h1>
          <p className="mt-5 max-w-sm text-base leading-7 text-flame-50/75">
            {t("auth.brandDescription")}
          </p>
          <ul className="mt-8 grid max-w-sm grid-cols-3 gap-2">
            <li className="rounded-xl border border-flame-50/15 bg-flame-50/10 px-3 py-3 text-xs font-medium text-flame-50/85 backdrop-blur-sm">
              {t("auth.brandPointCapture")}
            </li>
            <li className="rounded-xl border border-flame-50/15 bg-flame-50/10 px-3 py-3 text-xs font-medium text-flame-50/85 backdrop-blur-sm">
              {t("auth.brandPointMemory")}
            </li>
            <li className="rounded-xl border border-flame-50/15 bg-flame-50/10 px-3 py-3 text-xs font-medium text-flame-50/85 backdrop-blur-sm">
              {t("auth.brandPointOwnership")}
            </li>
          </ul>
        </div>
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
