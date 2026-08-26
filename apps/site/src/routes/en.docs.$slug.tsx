import { createFileRoute } from "@tanstack/react-router";
import { DocsDetailPage } from "@/pages/docs-detail-page";
import { seoHead, localeFromPath } from "@/lib/route-head";
import { getDoc } from "@/lib/docs-source.generated";

export const Route = createFileRoute("/en/docs/$slug")({
  component: DocsDetailPage,
  head: ({ location, params }) => {
    const locale = localeFromPath(location.pathname);
    const doc = getDoc(params.slug, locale);
    const title = doc?.title ?? "Documentation";
    const description = doc?.description ?? "FlareMo documentation";
    const seo = seoHead({
      path: `/docs/${params.slug}`,
      locale,
      title,
      description,
      ogType: "article",
      jsonLd: doc
        ? {
            "@type": "Article",
            headline: doc.title,
            description,
            inLanguage: locale === "zh-CN" ? "zh-CN" : "en-US",
            author: { "@type": "Organization", name: "FlareMo" },
          }
        : undefined,
    });
    return {
      title: seo.title,
      meta: seo.meta,
      links: seo.links,
      scripts: seo.scripts,
    };
  },
});