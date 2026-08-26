import { Outlet, useLocation } from "@tanstack/react-router";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import type { Locale } from "@/lib/seo";

export function RootLayout() {
  const { pathname } = useLocation();
  const locale: Locale = pathname.startsWith("/en") ? "en-US" : "zh-CN";

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground antialiased">
      <SiteNav currentPath={pathname} locale={locale} />
      <main className="flex-1">
        <Outlet />
      </main>
      <SiteFooter locale={locale} />
    </div>
  );
}
