import { createFileRoute } from "@tanstack/react-router";
import { DocsIndexPage } from "@/pages/docs-index-page";
import { seoHead, localeFromPath } from "@/lib/route-head";

export const Route = createFileRoute("/en/docs/")({
  component: DocsIndexPage,
  head: ({ location }) => {
    const locale = localeFromPath(location.pathname);
    const seo = seoHead({
      path: "/docs",
      locale,
      title: "Documentation",
      description:
        "FlareMo documentation overview: deployment, architecture, compatibility, agent integrations, and reference.",
    });
    return {
      title: seo.title,
      meta: seo.meta,
      links: seo.links,
      scripts: seo.scripts,
    };
  },
});