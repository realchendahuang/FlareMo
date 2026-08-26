import { getDoc } from "@/lib/docs-source.generated";
import { SOFTWARE_APPLICATION_JSON_LD } from "@/lib/seo";

export type RouteMeta = {
  /** Route path with :param placeholders resolved, e.g. /docs/deploy */
  path: string;
  locale: "zh-CN" | "en-US";
  title: string;
  description: string;
  ogType?: "website" | "article";
  jsonLd?: unknown;
};

/**
 * Static route registry used by the SSG builder. Every path that should be
 * prerendered to dist/ must be listed here (or handled by the slug generator).
 */
export function getStaticRoutes(): RouteMeta[] {
  const routes: RouteMeta[] = [];

  routes.push(
    {
      path: "/",
      locale: "zh-CN",
      title: "FlareMo",
      description:
        "一个免费 Cloudflare 账号就能 24 小时在线的个人笔记系统。D1 + R2 + Better Auth + Memos 兼容 API。",
      jsonLd: SOFTWARE_APPLICATION_JSON_LD,
    },
    {
      path: "/en",
      locale: "en-US",
      title: "FlareMo",
      description:
        "A personal note system that runs 24/7 on a free Cloudflare account. D1 + R2 + Better Auth + Memos-compatible API.",
      jsonLd: SOFTWARE_APPLICATION_JSON_LD,
    },
    {
      path: "/pricing",
      locale: "zh-CN",
      title: "定价",
      description:
        "FlareMo 定价：Free 永久免费，Pro 与 Team 由 Stripe 结算，Phase 2 上线。",
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
    },
    {
      path: "/en/pricing",
      locale: "en-US",
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
    },
    {
      path: "/hosted",
      locale: "zh-CN",
      title: "Hosted 试用",
      description:
        "FlareMo Hosted SaaS 试用通知。Phase 2 计划于下一季度开放 hosted.flaremo.app 的邀请注册。",
    },
    {
      path: "/en/hosted",
      locale: "en-US",
      title: "Hosted trial",
      description:
        "FlareMo Hosted SaaS trial notification. Phase 2 plans to open hosted.flaremo.app for invite registration next quarter.",
    },
    {
      path: "/docs",
      locale: "zh-CN",
      title: "文档总览",
      description: "FlareMo 文档总览：部署、架构、兼容矩阵、Agent 集成与参考。",
    },
    {
      path: "/en/docs",
      locale: "en-US",
      title: "Documentation",
      description:
        "FlareMo documentation overview: deployment, architecture, compatibility, agent integrations, and reference.",
    },
  );

  return routes;
}

export function getDocRoutes(): RouteMeta[] {
  const slugs = [
    "agent-deploy",
    "agent-ingestion",
    "agent-memory",
    "architecture-notes",
    "deploy-button-test",
    "deploy",
    "design-system",
    "maintenance",
    "memos-compatibility",
    "memos-ecosystem",
    "product-requirements",
    "release",
    "semantic-search",
    "tech-stack",
    "update",
  ];
  const enSlugs = ["deploy", "agent-deploy", "memos-compatibility", "update"];

  const zh: RouteMeta[] = slugs.map((slug) => {
    const doc = getDoc(slug, "zh-CN");
    return {
      path: `/docs/${slug}`,
      locale: "zh-CN",
      title: doc?.title ?? "文档",
      description: doc?.description ?? "FlareMo 文档",
      ogType: "article",
      jsonLd: doc
        ? {
            "@type": "Article",
            headline: doc.title,
            description: doc.description,
            inLanguage: "zh-CN",
          }
        : undefined,
    };
  });

  const en: RouteMeta[] = enSlugs.map((slug) => {
    const doc = getDoc(slug, "en-US");
    return {
      path: `/en/docs/${slug}`,
      locale: "en-US",
      title: doc?.title ?? "Documentation",
      description: doc?.description ?? "FlareMo documentation",
      ogType: "article",
      jsonLd: doc
        ? {
            "@type": "Article",
            headline: doc.title,
            description: doc.description,
            inLanguage: "en-US",
          }
        : undefined,
    };
  });

  return [...zh, ...en];
}

export function getAllPrerenderPaths(): RouteMeta[] {
  return [...getStaticRoutes(), ...getDocRoutes()];
}
