/**
 * SEO head builder for the marketing site. Returns the props for TanStack
 * Router's `head` directive: title, meta, link, script tags. Source of truth
 * for title/description/og/twitter/canonical/hreflang/json-ld.
 */

export const SUPPORTED_LOCALES = [
  "en",
  "zh",
  "ja",
  "fr",
  "es",
  "ko",
  "ru",
  "ar",
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type Locale = SupportedLocale | "zh-CN" | "en-US";

export function normalizeLocale(l?: string): SupportedLocale {
  if (!l) return "en";
  const lower = l.toLowerCase();
  if (lower.startsWith("zh")) return "zh";
  if (lower.startsWith("ja")) return "ja";
  if (lower.startsWith("fr")) return "fr";
  if (lower.startsWith("es")) return "es";
  if (lower.startsWith("ko")) return "ko";
  if (lower.startsWith("ru")) return "ru";
  if (lower.startsWith("ar")) return "ar";
  return "en";
}

export type SeoInput = {
  /** Path without locale prefix, e.g. "/", "/docs/deploy". */
  path: string;
  locale: Locale;
  title: string;
  description: string;
  /** Open Graph type. Defaults to "website". */
  ogType?: "website" | "article";
  /** JSON-LD payload as a plain object. Will be serialized as a single graph. */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  /** Override the OG image. Defaults to https://flaremo.app/og-image.png. */
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
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;

export const LOCALE_PREFIX: Record<SupportedLocale, string> = {
  en: "",
  zh: "/zh",
  ja: "/ja",
  fr: "/fr",
  es: "/es",
  ko: "/ko",
  ru: "/ru",
  ar: "/ar",
};

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: "English",
  zh: "简体中文",
  ja: "日本語",
  fr: "Français",
  es: "Español",
  ko: "한국어",
  ru: "Русский",
  ar: "العربية",
};

/**
 * `dir` attribute for a locale. Arabic is the only RTL locale; the SSG shell
 * and the client-side locale sync must agree on this value.
 */
export function localeDirection(locale: Locale): "ltr" | "rtl" {
  return normalizeLocale(locale) === "ar" ? "rtl" : "ltr";
}

/**
 * BCP-47 tag written to `<html lang>`. zh is advertised as zh-CN (the SSG shell
 * uses the same mapping); `:lang(zh)` still matches by prefix per RFC 4647.
 */
export function localeHtmlLang(locale: Locale): string {
  const norm = normalizeLocale(locale);
  return norm === "zh" ? "zh-CN" : norm;
}

export function getLocaleFromPath(pathname: string): SupportedLocale {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length > 0) {
    const first = segments[0].toLowerCase();
    if (first === "zh" || first === "zh-cn") return "zh";
    if (first === "ja") return "ja";
    if (first === "fr") return "fr";
    if (first === "es") return "es";
    if (first === "ko") return "ko";
    if (first === "ru") return "ru";
    if (first === "ar") return "ar";
    if (first === "en") return "en";
  }
  return "en";
}

export function getPathWithoutLocale(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  for (const prefix of [
    "/zh-CN",
    "/en",
    "/zh",
    "/ja",
    "/fr",
    "/es",
    "/ko",
    "/ru",
    "/ar",
  ]) {
    if (clean === prefix) return "/";
    if (clean.startsWith(`${prefix}/`)) {
      return clean.slice(prefix.length) || "/";
    }
  }
  return clean;
}

export function getLocalizedPath(path: string, locale: Locale): string {
  const norm = normalizeLocale(locale);
  const clean = getPathWithoutLocale(path);
  const prefix = LOCALE_PREFIX[norm];
  if (clean === "/") {
    return prefix || "/";
  }
  return `${prefix}${clean}`;
}

export function localeHref(path: string, locale: Locale): string {
  const norm = normalizeLocale(locale);
  const cleanPath = getPathWithoutLocale(path);
  const targetPrefix = LOCALE_PREFIX[norm];
  if (cleanPath === "/") {
    return targetPrefix ? `${SITE_URL}${targetPrefix}/` : `${SITE_URL}/`;
  }
  return `${SITE_URL}${targetPrefix}${cleanPath}`;
}

function fullTitle(title: string, _locale: Locale): string {
  if (title === SITE_NAME) return title;
  // Home titles already lead with "FlareMo - …"; appending " · FlareMo" again
  // produced "… · FlareMo · FlareMo" in tabs and share cards.
  if (title.startsWith(SITE_NAME)) return title;
  return `${title} · ${SITE_NAME}`;
}

const OG_LOCALES: Record<SupportedLocale, string> = {
  en: "en_US",
  zh: "zh_CN",
  ja: "ja_JP",
  fr: "fr_FR",
  es: "es_ES",
  ko: "ko_KR",
  ru: "ru_RU",
  ar: "ar_AR",
};

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

  const normLocale = normalizeLocale(locale);
  const canonical = localeHref(path, normLocale);

  const meta: SeoHead["meta"] = [
    { name: "description", content: description },
    { property: "og:type", content: ogType },
    { property: "og:title", content: fullTitle(title, normLocale) },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
    // Explicit dimensions keep the large card from collapsing on X/Slack, and
    // PNG (not SVG) means every scraped preview actually renders.
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: `${SITE_NAME} — ${title}` },
    { property: "og:url", content: canonical },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:locale", content: OG_LOCALES[normLocale] || "en_US" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: fullTitle(title, normLocale) },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
    { name: "twitter:image:alt", content: `${SITE_NAME} — ${title}` },
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
    { rel: "alternate", hreflang: "en", href: localeHref(path, "en") },
    { rel: "alternate", hreflang: "zh-CN", href: localeHref(path, "zh") },
    { rel: "alternate", hreflang: "ja", href: localeHref(path, "ja") },
    { rel: "alternate", hreflang: "fr", href: localeHref(path, "fr") },
    { rel: "alternate", hreflang: "es", href: localeHref(path, "es") },
    { rel: "alternate", hreflang: "ko", href: localeHref(path, "ko") },
    { rel: "alternate", hreflang: "ru", href: localeHref(path, "ru") },
    { rel: "alternate", hreflang: "ar", href: localeHref(path, "ar") },
    { rel: "alternate", hreflang: "x-default", href: localeHref(path, "en") },
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
    title: fullTitle(title, normLocale),
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
