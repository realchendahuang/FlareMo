import { createFileRoute } from "@tanstack/react-router";
import { DocsIndexPage } from "@/pages/docs-index-page";
import { seoHead, localeFromPath } from "@/lib/route-head";

export const Route = createFileRoute("/docs/")({
  component: DocsIndexPage,
  head: ({ location }) => {
    const locale = localeFromPath(location.pathname);
    const seo = seoHead({
      path: "/docs",
      locale,
      title: locale === "zh-CN" ? "文档总览" : "Documentation",
      description:
        locale === "zh-CN"
          ? "FlareMo 文档总览：部署、架构、兼容矩阵、Agent 集成与参考。"
          : "FlareMo documentation overview: deployment, architecture, compatibility, agent integrations, and reference.",
    });
    return {
      title: seo.title,
      meta: seo.meta,
      links: seo.links,
      scripts: seo.scripts,
    };
  },
});