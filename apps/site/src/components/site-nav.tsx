import { Link } from "@tanstack/react-router";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SiteMark } from "@/components/site-mark";
import type { Locale } from "@/lib/seo";

type NavItem = {
  to: string;
  label: string;
};

type SiteNavProps = {
  locale: Locale;
  /** Path of the current route, e.g. "/", "/pricing". */
  currentPath: string;
};

const ZH_ITEMS: NavItem[] = [
  { to: "/", label: "首页" },
  { to: "/pricing", label: "定价" },
  { to: "/docs", label: "文档" },
  { to: "/hosted", label: "Hosted" },
];

const EN_ITEMS: NavItem[] = [
  { to: "/en", label: "Home" },
  { to: "/en/pricing", label: "Pricing" },
  { to: "/en/docs", label: "Docs" },
  { to: "/en/hosted", label: "Hosted" },
];

export function SiteNav({ locale, currentPath }: SiteNavProps) {
  const items = locale === "zh-CN" ? ZH_ITEMS : EN_ITEMS;
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65">
      <div className="container-x flex h-14 items-center justify-between gap-4">
        <Link
          aria-label="FlareMo home"
          className="flex items-center gap-2 text-foreground transition-opacity hover:opacity-80"
          to={locale === "zh-CN" ? "/" : "/en"}
        >
          <SiteMark iconSize="size-6" />
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {items.map((item) => {
            const active = isActive(currentPath, item.to, locale);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
                key={item.to}
                to={item.to}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <a
            className="inline-flex items-center rounded-md bg-brand-gradient px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition-[filter,transform] hover:brightness-105 active:translate-y-px"
            href="https://app.flaremo.app"
            rel="noopener noreferrer"
          >
            {locale === "zh-CN" ? "登录 / 注册" : "Sign in"}
          </a>
          <a
            className="hidden items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
            href="https://github.com/realchendahuang/FlareMo"
            rel="noopener noreferrer"
            target="_blank"
          >
            GitHub ↗
          </a>
          <LocaleSwitcher locale={locale} path={currentPath} />
        </div>
      </div>
      <div className="container-x flex gap-1 overflow-x-auto pb-2 pt-1 md:hidden">
        {items.map((item) => {
          const active = isActive(currentPath, item.to, locale);
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
              key={item.to}
              to={item.to}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}

function isActive(
  currentPath: string,
  itemTo: string,
  locale: Locale,
): boolean {
  if (itemTo === "/") {
    return locale === "zh-CN" ? currentPath === "/" : currentPath === "/en";
  }
  if (itemTo === "/en") {
    return currentPath === "/en" || currentPath === "/en/";
  }
  return currentPath === itemTo || currentPath.startsWith(`${itemTo}/`);
}
