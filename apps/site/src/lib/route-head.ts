import { buildSeoHead, type Locale, type SeoInput } from "@/lib/seo";

/**
 * Build a TanStack Router `head` config from SEO input. Used inside
 * `routeOptions.head` of file-based routes.
 */
export function seoHead(input: SeoInput): {
  meta: Array<{ name?: string; property?: string; content: string }>;
  links: Array<{ rel: string; href: string; hreflang?: string }>;
  scripts: Array<{ type: string; children: string }>;
  title: string;
} {
  const built = buildSeoHead(input);
  return {
    meta: built.meta,
    links: built.links,
    scripts: built.scripts,
    title: built.title,
  };
}

/**
 * Helper to determine the locale of a route based on its pathname. Used in
 * route files where `useLocation()` isn't available inside `head`.
 */
export function localeFromPath(pathname: string): Locale {
  return pathname.startsWith("/en") ? "en-US" : "zh-CN";
}