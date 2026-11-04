import { type Locale, normalizeLocale, type SupportedLocale } from "@/lib/seo";

export type HeroFact = {
  /** Short uppercase label above the value, e.g. "D1 storage". */
  label: string;
  /** The headline number or unit, kept short so the strip stays one line. */
  value: string;
  /** One quiet line of context under the value. */
  detail: string;
};

export type HomeContent = {
  heroEyebrow: string;
  heroTitleLine1: string;
  heroTitleLine2: string;
  heroSubtitle: string;
  primaryCta: string;
  secondaryCta: string;
  heroFacts: HeroFact[];
  featuresBadge: string;
  featuresHeading: string;
  featuresSubtitle: string;
  features: Array<{
    title: string;
    description: string;
  }>;
  comparisonBadge: string;
  comparisonHeading: string;
  comparisonSubtitle: string;
  comparisonRows: Array<{
    label: string;
    cloudflare: string;
    nas: string;
    vps: string;
  }>;
  screenshotsHeading: string;
  screenshotsSubtitle: string;
  faqHeading: string;
  faqItems: Array<{
    q: string;
    a: string;
  }>;
  ctaHeading: string;
  ctaSubtitle: string;
  ctaButton: string;
};

/** Keep locale modules out of the entry chunk; the route loader only fetches
 *  the copy needed by the current statically rendered page. */
const HOME_LOADERS: Record<SupportedLocale, () => Promise<HomeContent>> = {
  en: () => import("./home/en").then(({ EN_HOME }) => EN_HOME),
  zh: () => import("./home/zh").then(({ ZH_HOME }) => ZH_HOME),
  ja: () => import("./home/ja").then(({ JA_HOME }) => JA_HOME),
  fr: () => import("./home/fr").then(({ FR_HOME }) => FR_HOME),
  es: () => import("./home/es").then(({ ES_HOME }) => ES_HOME),
  ko: () => import("./home/ko").then(({ KO_HOME }) => KO_HOME),
  ru: () => import("./home/ru").then(({ RU_HOME }) => RU_HOME),
  ar: () => import("./home/ar").then(({ AR_HOME }) => AR_HOME),
};

export function loadHomeContent(locale: Locale): Promise<HomeContent> {
  return HOME_LOADERS[normalizeLocale(locale)]();
}
