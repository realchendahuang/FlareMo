import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { getDoc } from "@/lib/docs-source.generated";
import { buildSeoForPath, renderHtmlShell } from "@/lib/html-shell";
import type { Locale } from "@/lib/seo";
import { SOFTWARE_APPLICATION_JSON_LD } from "@/lib/seo";
import { createAppRouter } from "@/router";

type RenderResult = {
  html: string;
  title: string;
};

const STATIC_META: Record<
  string,
  {
    locale: Locale;
    title: string;
    description: string;
    ogType?: "website" | "article";
    jsonLd?: unknown;
  }
> = {
  "/": {
    locale: "zh-CN",
    title: "FlareMo",
    description:
      "一个免费 Cloudflare 账号就能 24 小时在线的个人笔记系统。D1 + R2 + Better Auth + Memos 兼容 API。",
    jsonLd: SOFTWARE_APPLICATION_JSON_LD,
  },
  "/en": {
    locale: "en-US",
    title: "FlareMo",
    description:
      "A personal note system that runs 24/7 on a free Cloudflare account. D1 + R2 + Better Auth + Memos-compatible API.",
    jsonLd: SOFTWARE_APPLICATION_JSON_LD,
  },
  "/pricing": {
    locale: "zh-CN",
    title: "定价",
    description:
      "FlareMo 定价：Free 永久免费，Pro 与 Team 由 Stripe 结算，Phase 2 上线。",
  },
  "/en/pricing": {
    locale: "en-US",
    title: "Pricing",
    description:
      "FlareMo pricing: Free is forever, Pro and Team bill through Stripe (Phase 2).",
  },
  "/hosted": {
    locale: "zh-CN",
    title: "自部署",
    description:
      "FlareMo FlareMo 自部署通知。",
  },
  "/en/hosted": {
    locale: "en-US",
    title: "Self-host",
    description:
      "FlareMo self-host notification.",
  },
  "/docs": {
    locale: "zh-CN",
    title: "文档总览",
    description: "FlareMo 文档总览：部署、架构、兼容矩阵、Agent 集成与参考。",
  },
  "/en/docs": {
    locale: "en-US",
    title: "Documentation",
    description:
      "FlareMo documentation overview: deployment, architecture, compatibility, agent integrations, and reference.",
  },
};

function docMeta(pathname: string): {
  locale: Locale;
  title: string;
  description: string;
  ogType: "article";
  jsonLd?: unknown;
} | null {
  // /docs/<slug> (zh) or /en/docs/<slug> (en)
  const match = pathname.match(/^\/(?:en\/)?docs\/([^/]+)$/);
  if (!match) return null;
  const isEn = pathname.startsWith("/en");
  const slug = match[1];
  const locale: Locale = isEn ? "en-US" : "zh-CN";
  const doc = getDoc(slug, locale);
  if (!doc) return null;
  return {
    locale,
    title: doc.title,
    description: doc.description,
    ogType: "article",
    jsonLd: {
      "@type": "Article",
      headline: doc.title,
      description: doc.description,
      inLanguage: isEn ? "en-US" : "zh-CN",
    },
  };
}

function resolveMeta(pathname: string) {
  if (pathname in STATIC_META)
    return STATIC_META[pathname as keyof typeof STATIC_META];
  return docMeta(pathname);
}

/**
 * SSR-renders a single route path to a complete static HTML document.
 * Used by scripts/build.mjs via Vite's ssrLoadModule.
 */
export async function renderRoute(pathname: string): Promise<RenderResult> {
  const meta = resolveMeta(pathname);
  const locale = meta?.locale ?? "zh-CN";
  const title = meta?.title ?? "FlareMo";
  const description = meta?.description ?? "FlareMo";

  const history = createMemoryHistory({
    initialEntries: [pathname],
  });
  const router = createAppRouter({ history });

  await router.load();

  const seo = buildSeoForPath(pathname, title, description, locale, {
    ogType: meta?.ogType,
    jsonLd: meta?.jsonLd,
  });

  const body = renderToString(<RouterProvider router={router} />);

  const html = renderHtmlShell(body, seo, locale);
  return { html, title };
}
