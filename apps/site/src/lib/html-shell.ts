import {
  buildSeoHead,
  type Locale,
  localeDirection,
  localeHref,
  localeHtmlLang,
  type SeoHead,
} from "@/lib/seo";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

/**
 * Renders the full static HTML document shell used by scripts/build.mjs for
 * every prerendered route. Body is rendered by the router; head carries the
 * complete SEO payload (title, meta, links, JSON-LD scripts).
 */
export function renderHtmlShell(
  body: string,
  seo: SeoHead,
  locale: Locale = "en",
): string {
  // Same helpers the client-side effect in RootLayout uses, so a locale switch
  // without a reload lands on exactly the values this shell was built with.
  const lang = localeHtmlLang(locale);
  const dir = localeDirection(locale);

  const metaTags = seo.meta
    .map((m) => {
      if (m.property)
        return `<meta property="${m.property}" content="${escapeAttr(m.content)}" />`;
      return `<meta name="${m.name}" content="${escapeAttr(m.content)}" />`;
    })
    .join("\n    ");

  const linkTags = seo.links
    .map((l) => {
      const hreflang = l.hreflang ? ` hreflang="${l.hreflang}"` : "";
      return `<link rel="${l.rel}"${hreflang} href="${escapeAttr(l.href)}" />`;
    })
    .join("\n    ");

  const scriptTags = seo.scripts
    .map((s) => `<script type="${s.type}">${s.children}</script>`)
    .join("\n    ");

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#17191d" />
    <meta name="color-scheme" content="light dark" />
    <link rel="icon" type="image/png" href="/brand/flaremo-mark-light-300.png" />
    <link rel="apple-touch-icon" href="/brand/flaremo-app-icon-180.png" />
    <title>${escapeText(seo.title)}</title>
    ${metaTags}
    ${linkTags}
    ${scriptTags}
    <script>${THEME_BOOT_SCRIPT}</script>
  </head>
  <body>
    <div id="root">${body}</div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;
}

export function buildSeoForPath(
  pathname: string,
  title: string,
  description: string,
  locale: Locale = "en",
  opts?: {
    jsonLd?: unknown;
    ogType?: "website" | "article";
    noindex?: boolean;
  },
) {
  return buildSeoHead({
    path: pathname,
    locale,
    title,
    description,
    ogType: opts?.ogType,
    noindex: opts?.noindex,
    jsonLd: opts?.jsonLd as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined,
  });
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export { localeHref };
