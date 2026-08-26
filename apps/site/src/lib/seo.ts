/**
 * SEO head builder for the marketing site. Returns the props for TanStack
 * Router's `head` directive: title, meta, link, script tags. Source of truth
 * for title/description/og/twitter/canonical/hreflang/json-ld.
 */

export type Locale = "zh-CN" | "en-US";

export type SeoInput = {
  /** Path without locale prefix, e.g. "/", "/pricing", "/docs/deploy". */
  path: string;
  locale: Locale;
  title: string;
  description: string;
  /** Open Graph type. Defaults to "website". */
  ogType?: "website" | "article";
  /** JSON-LD payload as a plain object. Will be serialized as a single graph. */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  /** Override the OG image. Defaults to https://flaremo.app/og-image.svg. */
  ogImage?: string;
  /** Article-specific publish/modified time. */
  articlePublishedTime?: string;
  articleModifiedTime?: string;
  /** Whether this route should not be indexed. */
  noindex?: boolean;
};

export type SeoHead = {
  title: string;
  meta: Array<{ name?: string; property?: string; content: string }>;
  links: Array<{ rel: string; href: string; hreflang?: string }>;
  scripts: Array<{ type: string; children: string }>;
};

const SITE_NAME = "FlareMo";
const SITE_URL = "https://flaremo.app";
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.svg`;

const LOCALE_PREFIX: Record<Locale, string> = {
  "zh-CN": "",
  "en-US": "/en",
};

export function localeHref(path: string, locale: Locale): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (path === "/") {
    return `${SITE_URL}${LOCALE_PREFIX[locale] || ""}/`;
  }
  return `${SITE_URL}${LOCALE_PREFIX[locale]}${cleanPath}`;
}

function fullTitle(title: string, locale: Locale): string {
  if (title === SITE_NAME) return title;
  return locale === "zh-CN"
    ? `${title} · ${SITE_NAME}`
    : `${title} · ${SITE_NAME}`;
}

export function buildSeoHead(input: SeoInput): SeoHead {
  const {
    path,
    locale,
    title,
    description,
    ogType = "website",
    jsonLd,
    ogImage = DEFAULT_OG_IMAGE,
    articlePublishedTime,
    articleModifiedTime,
    noindex,
  } = input;

  const canonical = localeHref(path, locale);
  const meta: SeoHead["meta"] = [
    { name: "description", content: description },
    { property: "og:type", content: ogType },
    { property: "og:title", content: fullTitle(title, locale) },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
    { property: "og:url", content: canonical },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:locale", content: locale === "zh-CN" ? "zh_CN" : "en_US" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: fullTitle(title, locale) },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
  ];

  if (ogType === "article") {
    if (articlePublishedTime) {
      meta.push({
        property: "article:published_time",
        content: articlePublishedTime,
      });
    }
    if (articleModifiedTime) {
      meta.push({
        property: "article:modified_time",
        content: articleModifiedTime,
      });
    }
  }

  if (noindex) {
    meta.push({ name: "robots", content: "noindex,nofollow" });
  } else {
    meta.push({ name: "robots", content: "index,follow" });
  }

  const links: SeoHead["links"] = [
    { rel: "canonical", href: canonical },
    {
      rel: "alternate",
      hreflang: "zh-CN",
      href: localeHref(path, "zh-CN"),
    },
    {
      rel: "alternate",
      hreflang: "en-US",
      href: localeHref(path, "en-US"),
    },
    {
      rel: "alternate",
      hreflang: "x-default",
      href: localeHref(path, "zh-CN"),
    },
  ];

  const scripts: SeoHead["scripts"] = [];
  if (jsonLd) {
    const graph = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
    scripts.push({
      type: "application/ld+json",
      children: JSON.stringify(
        {
          "@context": "https://schema.org",
          "@graph": graph,
        },
        null,
        0,
      ),
    });
  }

  return {
    title: fullTitle(title, locale),
    meta,
    links,
    scripts,
  };
}

export const SOFTWARE_APPLICATION_JSON_LD = {
  "@type": "SoftwareApplication",
  name: "FlareMo",
  applicationCategory: "ProductivityApplication",
  operatingSystem: "Web",
  description:
    "A Cloudflare-native personal knowledge system that runs on a free Cloudflare account with D1, R2, and Better Auth built in.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  url: SITE_URL,
  image: DEFAULT_OG_IMAGE,
  author: {
    "@type": "Organization",
    name: "FlareMo",
    url: SITE_URL,
  },
};
