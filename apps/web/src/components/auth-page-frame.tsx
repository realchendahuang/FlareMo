import type { ReactNode } from "react";
import { FlareMoLogo } from "@/components/flaremo-logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
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
  const { t } = useI18n();

  return (
    <main className="grid min-h-svh lg:grid-cols-2" data-auth-page>
      <aside className="relative hidden overflow-hidden bg-muted lg:flex lg:flex-col lg:justify-between lg:border-e lg:border-border/60 lg:p-12">
        <div className="flex items-center gap-2.5">
          <FlareMoLogo labelClassName="text-lg" markClassName="size-8" />
        </div>
        <div className="relative max-w-md">
          <span
            aria-hidden="true"
            className="mb-6 block h-1 w-10 rounded-full bg-brand-gradient"
          />
          <h1 className="max-w-sm font-heading text-4xl font-semibold leading-[1.1] tracking-tight text-balance text-foreground xl:text-5xl">
            {t("auth.brandTitle")}
          </h1>
        </div>
      </aside>
      <div className="relative flex items-center justify-center bg-background px-4 py-8">
        <header className="absolute inset-x-0 top-0 flex items-center justify-between p-4 lg:justify-end">
          <span className="lg:hidden">
            <FlareMoLogo labelClassName="text-lg" markClassName="size-7" />
          </span>
          <LocaleSwitcher />
        </header>
        <Card className="w-full max-w-[400px] gap-5 py-6 shadow-md [--card-spacing:--spacing(6)]">
          <CardHeader className="gap-2">
            {eyebrow ? (
              <p className="text-xs font-medium text-primary">{eyebrow}</p>
            ) : null}
            <CardTitle className="text-xl font-semibold tracking-tight">
              {title}
            </CardTitle>
            {description ? (
              <CardDescription className="text-sm leading-6 text-pretty">
                {description}
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </div>
    </main>
  );
}
