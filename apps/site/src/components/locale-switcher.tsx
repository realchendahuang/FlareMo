import { Link } from "@tanstack/react-router";
import { Globe } from "lucide-react";
import type { Locale } from "@/lib/seo";

type LocaleSwitcherProps = {
  locale: Locale;
  /** Path under the locale (e.g. "/", "/pricing", "/docs/deploy"). */
  path: string;
};

const LABELS: Record<Locale, string> = {
  "zh-CN": "简体中文",
  "en-US": "English",
};

const OTHER_LOCALE: Record<Locale, Locale> = {
  "zh-CN": "en-US",
  "en-US": "zh-CN",
};

function localizedHref(path: string, locale: Locale): string {
  if (path === "/") {
    return locale === "en-US" ? "/en/" : "/";
  }
  return locale === "en-US" ? `/en${path}` : path;
}

export function LocaleSwitcher({ locale, path }: LocaleSwitcherProps) {
  const next = OTHER_LOCALE[locale];
  return (
    <Link
      aria-label={`Switch language to ${LABELS[next]}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      to={localizedHref(path, next)}
    >
      <Globe className="size-3.5" />
      {LABELS[next]}
    </Link>
  );
}