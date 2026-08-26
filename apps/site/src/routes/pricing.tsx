import { createFileRoute } from "@tanstack/react-router";
import { PricingPage } from "@/pages/pricing-page";
import { seoHead, localeFromPath } from "@/lib/route-head";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: ({ location }) => {
    const locale = localeFromPath(location.pathname);
    const seo = seoHead({
      path: "/pricing",
      locale,
      title: locale === "zh-CN" ? "定价" : "Pricing",
      description:
        locale === "zh-CN"
          ? "FlareMo 定价：Free 永久免费，Pro 与 Team 由 Stripe 结算，Phase 2 上线。"
          : "FlareMo pricing: Free is forever, Pro and Team bill through Stripe (Phase 2).",
      jsonLd: {
        "@type": "Product",
        name: "FlareMo",
        description:
          locale === "zh-CN"
            ? "FlareMo 定价：Free 永久免费，Pro 与 Team 由 Stripe 结算，Phase 2 上线。"
            : "FlareMo pricing: Free is forever, Pro and Team bill through Stripe (Phase 2).",
        offers: [
          {
            "@type": "Offer",
            name: "Free",
            price: "0",
            priceCurrency: "USD",
            category: "Self-host",
          },
          {
            "@type": "Offer",
            name: "Pro",
            price: "4",
            priceCurrency: "USD",
            category: "Hosted",
          },
          {
            "@type": "Offer",
            name: "Team",
            price: "9",
            priceCurrency: "USD",
            category: "Hosted",
          },
        ],
      },
    });
    return {
      title: seo.title,
      meta: seo.meta,
      links: seo.links,
      scripts: seo.scripts,
    };
  },
});