import { type Locale, normalizeLocale, type SupportedLocale } from "@/lib/seo";

export type ShowcaseContent = {
  memo1: {
    title: string;
    content: string;
    quote: string;
    tags: string[];
    time: string;
  };
  memo2: {
    title: string;
    content: string;
    tags: string[];
    time: string;
  };
  presets: Array<{
    text: string;
    title: string;
    quote: string;
    tag: string;
  }>;
  ui: {
    statsRecords: string;
    statsTags: string;
    statsDays: string;
    trend: string;
    calendar: string;
    timeline: string;
    archive: string;
    trash: string;
    dailyReview: string;
    randomWalk: string;
    calendarView: string;
    projects: string;
    tagIndex: string;
    searchPlaceholder: string;
    composerPlaceholder: string;
    send: string;
    justNow: string;
    clearFilter: string;
    recordPrefix: string;
    months: [string, string, string, string];
    tags: Array<{ name: string; count: number }>;
  };
};

/** Keep locale modules out of the entry chunk; the homepage route loads one
 *  translation set in parallel with the rest of its copy. */
const SHOWCASE_LOADERS: Record<
  SupportedLocale,
  () => Promise<ShowcaseContent>
> = {
  en: () => import("./showcase/en").then(({ EN_SHOWCASE }) => EN_SHOWCASE),
  zh: () => import("./showcase/zh").then(({ ZH_SHOWCASE }) => ZH_SHOWCASE),
  ja: () => import("./showcase/ja").then(({ JA_SHOWCASE }) => JA_SHOWCASE),
  fr: () => import("./showcase/fr").then(({ FR_SHOWCASE }) => FR_SHOWCASE),
  es: () => import("./showcase/es").then(({ ES_SHOWCASE }) => ES_SHOWCASE),
  ko: () => import("./showcase/ko").then(({ KO_SHOWCASE }) => KO_SHOWCASE),
  ru: () => import("./showcase/ru").then(({ RU_SHOWCASE }) => RU_SHOWCASE),
  ar: () => import("./showcase/ar").then(({ AR_SHOWCASE }) => AR_SHOWCASE),
};

export function loadShowcaseContent(locale: Locale): Promise<ShowcaseContent> {
  return SHOWCASE_LOADERS[normalizeLocale(locale)]();
}
