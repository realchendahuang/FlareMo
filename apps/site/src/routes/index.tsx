import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "@/pages/home-page";
import { seoHead, localeFromPath } from "@/lib/route-head";
import { SOFTWARE_APPLICATION_JSON_LD } from "@/lib/seo";

export const Route = createFileRoute("/")({
  component: HomePage,
  head: ({ location }) => {
    const locale = localeFromPath(location.pathname);
    const seo = seoHead({
      path: "/",
      locale,
      title: "FlareMo",
      description:
        locale === "zh-CN"
          ? "一个免费 Cloudflare 账号就能 24 小时在线的个人笔记系统。D1 + R2 + Better Auth + Memos 兼容 API。"
          : "A personal note system that runs 24/7 on a free Cloudflare account. D1 + R2 + Better Auth + Memos-compatible API.",
      jsonLd: [SOFTWARE_APPLICATION_JSON_LD],
    });
    return {
      title: seo.title,
      meta: seo.meta,
      links: seo.links,
      scripts: seo.scripts,
    };
  },
});