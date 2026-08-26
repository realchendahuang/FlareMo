import { createFileRoute } from "@tanstack/react-router";
import { HostedPage } from "@/pages/hosted-page";
import { seoHead, localeFromPath } from "@/lib/route-head";

export const Route = createFileRoute("/en/hosted")({
  component: HostedPage,
  head: ({ location }) => {
    const locale = localeFromPath(location.pathname);
    const seo = seoHead({
      path: "/hosted",
      locale,
      title: "Hosted trial",
      description:
        "FlareMo Hosted SaaS trial notification. Phase 2 plans to open hosted.flaremo.app for invite registration next quarter.",
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