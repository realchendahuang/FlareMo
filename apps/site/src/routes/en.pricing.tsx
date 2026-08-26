import { createFileRoute } from "@tanstack/react-router";
import { PricingPage } from "@/pages/pricing-page";
import { seoHead, localeFromPath } from "@/lib/route-head";

export const Route = createFileRoute("/en/pricing")({
  component: PricingPage,
  head: ({ location }) => {
    const locale = localeFromPath(location.pathname);
    const seo = seoHead({
      path: "/pricing",
      locale,
      title: "Pricing",
      description:
        "FlareMo pricing: Free is forever, Pro and Team bill through Stripe (Phase 2).",
      jsonLd: {
        "@type": "Product",
        name: "FlareMo",
        description:
          "FlareMo pricing: Free is forever, Pro and Team bill through Stripe (Phase 2).",
        offers: [
          { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD" },
          { "@type": "Offer", name: "Pro", price: "4", priceCurrency: "USD" },
          { "@type": "Offer", name: "Team", price: "9", priceCurrency: "USD" },
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