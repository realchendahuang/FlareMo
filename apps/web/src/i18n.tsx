import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TranslationKey } from "./i18n/key";
import { enUS } from "./i18n/messages/en-US";

export type { TranslationKey } from "./i18n/key";

/** Interpolation values for translated messages ({count}, {date}, …). */
export type TranslationParams = Record<string, string | number>;

/** App locales mirror the marketing site: en/zh/ja/fr/es/ko/ru/ar. */
export type Locale =
  | "zh-CN"
  | "en-US"
  | "ja"
  | "fr"
  | "es"
  | "ko"
  | "ru"
  | "ar";

const LOCALE_STORAGE_KEY = "flaremo.locale";

type Messages = Record<TranslationKey, string>;

// en-US is the fallback every `t` lookup ends at, so it stays in the entry
// chunk. The other seven catalogs download on first use through
// `loadLocaleMessages` and register here so `t` keeps reading synchronously.
const messages: Partial<Record<Locale, Messages>> = {
  "en-US": enUS,
};

const localeLoaders: Record<
  Exclude<Locale, "en-US">,
  () => Promise<Messages>
> = {
  "zh-CN": () => import("./i18n/messages/zh-CN").then((module) => module.zhCN),
  ja: () => import("./i18n/messages/ja").then((module) => module.ja),
  fr: () => import("./i18n/messages/fr").then((module) => module.fr),
  es: () => import("./i18n/messages/es").then((module) => module.es),
  ko: () => import("./i18n/messages/ko").then((module) => module.ko),
  ru: () => import("./i18n/messages/ru").then((module) => module.ru),
  ar: () => import("./i18n/messages/ar").then((module) => module.ar),
};

const pendingPacks = new Map<Locale, Promise<Messages>>();

/**
 * Fetches a locale's catalog once and registers it into `messages`. Never
 * rejects: a failed download leaves the pack unloaded (the per-key English
 * fallback covers the gap) and clears the pending entry so the next request
 * retries the fetch.
 */
export function loadLocaleMessages(locale: Locale): Promise<Messages> {
  const loaded = messages[locale];
  if (loaded) return Promise.resolve(loaded);
  let pending = pendingPacks.get(locale);
  if (!pending) {
    pending = localeLoaders[locale as Exclude<Locale, "en-US">]()
      .then((pack) => {
        messages[locale] = pack;
        return pack;
      })
      .catch(() => {
        pendingPacks.delete(locale);
        return enUS;
      });
    pendingPacks.set(locale, pending);
  }
  return pending;
}

/** Native names shown in the language switcher (never translated). */
export const LOCALE_LABELS: Record<Locale, string> = {
  "zh-CN": "简体中文",
  "en-US": "English",
  ja: "日本語",
  fr: "Français",
  es: "Español",
  ko: "한국어",
  ru: "Русский",
  ar: "العربية",
};

export const SUPPORTED_LOCALES = Object.keys(LOCALE_LABELS) as Locale[];

/** RTL only for Arabic; every other locale is LTR. */
export function isRtlLocale(locale: Locale): boolean {
  return locale === "ar";
}

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => getInitialLocale());
  // The first paint may beat the locale catalog (main.tsx caps the gate at
  // 1.5s and then renders with the English fallback). Bumping this counter
  // when a late pack lands makes `t` switch to the real language instead of
  // leaving the page English until an unrelated state change re-renders it.
  const [packVersion, setPackVersion] = useState(0);
  // Monotonic request id: when several switches race, only the newest one may
  // commit — a slow pack can never resurrect an older language.
  const requestRef = useRef(0);

  useEffect(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtlLocale(locale) ? "rtl" : "ltr";
  }, [locale]);

  useEffect(() => {
    const alreadyLoaded = Boolean(messages[locale]);
    const requestId = ++requestRef.current;
    let cancelled = false;
    void loadLocaleMessages(locale).then(() => {
      if (cancelled || requestRef.current !== requestId) return;
      if (!alreadyLoaded) setPackVersion((version) => version + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => {
    // Referenced so a late-arriving catalog busts this memo; `t` itself reads
    // the module-level registry directly.
    void packVersion;
    const setLocale = (next: Locale) => {
      const requestId = ++requestRef.current;
      void loadLocaleMessages(next).then(() => {
        if (requestRef.current === requestId) {
          setLocaleState(next);
        }
      });
    };
    const t = (key: TranslationKey, params?: TranslationParams) => {
      const template =
        messages[locale]?.[key] ??
        messages["en-US"]?.[key] ??
        // Dynamic keys built from server enums (e.g. task.status.*) can point
        // at values added server-side after this client shipped. A readable
        // fallback keeps the page alive; a throw would crash the route.
        key.split(".").at(-1) ??
        key;
      return interpolate(template, params);
    };
    return { locale, setLocale, t };
  }, [locale, packVersion]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider.");
  }
  return context;
}

/**
 * Resolves the locale the provider would pick (stored preference, else
 * navigator). Exposed for non-React callers — route loaders warm caches that
 * are keyed by locale-dependent values (e.g. the calendar's week start).
 */
export function getInitialLocale(): Locale {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (isLocale(stored)) {
    return stored;
  }
  return matchNavigatorLocale() ?? "en-US";
}

/** Best-match navigator.languages against our catalog (zh→zh-CN etc.). */
function matchNavigatorLocale(): Locale | null {
  for (const candidate of navigator.languages ?? []) {
    const base = candidate.toLowerCase().split("-")[0];
    const match = SUPPORTED_LOCALES.find(
      (locale) => locale.toLowerCase().split("-")[0] === base,
    );
    if (match) return match;
  }
  return null;
}

function isLocale(value: string | null): value is Locale {
  return (
    value === "zh-CN" ||
    value === "en-US" ||
    value === "ja" ||
    value === "fr" ||
    value === "es" ||
    value === "ko" ||
    value === "ru" ||
    value === "ar"
  );
}

function interpolate(template: string, params?: TranslationParams) {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    String(params[key] ?? match),
  );
}
