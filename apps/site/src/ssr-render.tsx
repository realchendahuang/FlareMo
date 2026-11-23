import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { NOT_FOUND_COPY } from "@/content/not-found-i18n";
import { STATIC_PAGE_META } from "@/content/static-page-meta";
import { getDoc } from "@/lib/docs-source.generated";
import { buildSeoForPath, renderHtmlShell } from "@/lib/html-shell";
import {
  getLocaleFromPath,
  getPathWithoutLocale,
  SOFTWARE_APPLICATION_JSON_LD,
  type SupportedLocale,
} from "@/lib/seo";
import { createAppRouter } from "@/router";

type RenderResult = {
  html: string;
  title: string;
};

async function resolveMeta(pathname: string): Promise<{
  locale: SupportedLocale;
  title: string;
  description: string;
  ogType?: "website" | "article";
  jsonLd?: unknown;
  noindex?: boolean;
}> {
  const locale = getLocaleFromPath(pathname);
  const cleanPath = getPathWithoutLocale(pathname);

  // 404 shell: rendered to dist/site/404.html and served by Cloudflare for
  // every unmatched path. Never index it.
  if (cleanPath === "/404" || cleanPath === "/__404") {
    const copy = NOT_FOUND_COPY[locale] ?? NOT_FOUND_COPY.en;
    return {
      locale,
      title: copy.title,
      description: copy.description,
      noindex: true,
    };
  }

  // Home route
  if (cleanPath === "/") {
    const meta = STATIC_PAGE_META[locale];
    return {
      locale,
      title: meta.homeTitle,
      description: meta.homeDesc,
      ogType: "website",
      jsonLd: SOFTWARE_APPLICATION_JSON_LD,
    };
  }

  // Docs index route
  if (cleanPath === "/docs") {
    const meta = STATIC_PAGE_META[locale];
    return {
      locale,
      title: meta.docsTitle,
      description: meta.docsDesc,
      ogType: "website",
    };
  }

  // Docs detail route: /docs/:slug
  const match = cleanPath.match(/^\/docs\/([^/]+)$/);
  if (match) {
    const slug = match[1];
    const docLocale = locale === "zh" ? "zh-CN" : "en-US";
    const doc = await getDoc(slug, docLocale);
    if (doc) {
      return {
        locale,
        title: doc.title,
        description: doc.description,
        ogType: "article",
        jsonLd: {
          "@type": "Article",
          headline: doc.title,
          description: doc.description,
          inLanguage: docLocale,
        },
      };
    }
  }

  return {
    locale,
    title: "FlareMo",
    description: "FlareMo",
  };
}

/**
 * SSR-renders a single route path to a complete static HTML document.
 * Used by scripts/build.mjs via Vite's ssrLoadModule.
 */
export async function renderRoute(pathname: string): Promise<RenderResult> {
  const meta = await resolveMeta(pathname);
  const locale = meta.locale;
  const title = meta.title;
  const description = meta.description;

  const history = createMemoryHistory({
    initialEntries: [pathname],
  });
  const router = createAppRouter({ history });

  await router.load();

  const seo = buildSeoForPath(
    meta.noindex ? "/" : pathname,
    title,
    description,
    locale,
    { ogType: meta.ogType, jsonLd: meta.jsonLd, noindex: meta.noindex },
  );

  const body = renderToString(<RouterProvider router={router} />);

  const html = renderHtmlShell(body, seo, locale);
  return { html, title };
}
