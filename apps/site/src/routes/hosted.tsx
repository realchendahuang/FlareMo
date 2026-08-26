import { createFileRoute } from "@tanstack/react-router";
import { HostedPage } from "@/pages/hosted-page";
import { seoHead, localeFromPath } from "@/lib/route-head";

export const Route = createFileRoute("/hosted")({
  component: HostedPage,
  head: ({ location }) => {
    const locale = localeFromPath(location.pathname);
    const seo = seoHead({
      path: "/hosted",
      locale,
      title: locale === "zh-CN" ? "Hosted 试用" : "Hosted trial",
      description:
        locale === "zh-CN"
          ? "FlareMo Hosted SaaS 试用通知。Phase 2 计划于下一季度开放 hosted.flaremo.app 的邀请注册。"
          : "FlareMo Hosted SaaS trial notification. Phase 2 plans to open hosted.flaremo.app for invite registration next quarter.",
      noindex: true,
    });
    return {
      title: seo.title,
      meta: seo.meta,
      links: seo.links,
      scripts: seo.scripts,
    };
  },
});