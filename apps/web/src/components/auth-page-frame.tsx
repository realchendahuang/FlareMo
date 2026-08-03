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
  description: string;
  eyebrow: string;
  title: string;
}) {
  const { t, toggleLocale } = useI18n();

  return (
    <main className="flex min-h-svh items-center justify-center bg-[radial-gradient(circle_at_top,_var(--color-flame-100),_transparent_42%)] px-4 py-8 dark:bg-[radial-gradient(circle_at_top,_color-mix(in_oklab,var(--color-flame-400)_15%,transparent),_transparent_42%)]">
      <div className="flex w-full max-w-md flex-col gap-4">
        <header className="flex items-center justify-between px-1">
          <FlareMoLogo labelClassName="text-lg" markClassName="size-7" />
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
        <Card className="shadow-lg shadow-flame-950/5">
          <CardHeader className="gap-2">
            <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">
              {eyebrow}
            </p>
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
        <p className="px-2 text-center text-xs leading-5 text-muted-foreground">
          {t("auth.sessionSecurity")}
        </p>
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
