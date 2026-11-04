import type { SupportedLocale } from "@/lib/seo";

export const COMP_HEADERS: Record<
  SupportedLocale,
  { flaremo: string; nas: string; vps: string }
> = {
  en: {
    flaremo: "Cloudflare (FlareMo)",
    nas: "Home NAS / Homelab",
    vps: "Traditional VPS Cloud",
  },
  zh: {
    flaremo: "Cloudflare（FlareMo）",
    nas: "家用 NAS / 软路由",
    vps: "传统 VPS 云主机",
  },
  ja: {
    flaremo: "Cloudflare（FlareMo）",
    nas: "自宅 NAS / ルーター",
    vps: "従来の VPS",
  },
  fr: {
    flaremo: "Cloudflare (FlareMo)",
    nas: "NAS domestique",
    vps: "VPS traditionnel",
  },
  es: {
    flaremo: "Cloudflare (FlareMo)",
    nas: "NAS doméstico",
    vps: "VPS tradicional",
  },
  ko: {
    flaremo: "Cloudflare(FlareMo)",
    nas: "홈 NAS",
    vps: "기존 VPS",
  },
  ru: {
    flaremo: "Cloudflare (FlareMo)",
    nas: "Домашний NAS",
    vps: "Обычный VPS",
  },
  ar: {
    flaremo: "Cloudflare (FlareMo)",
    nas: "وحدة NAS منزلية",
    vps: "خوادم VPS التقليدية",
  },
};

export const COMP_DIMENSIONS: Record<SupportedLocale, string> = {
  en: "Dimension",
  zh: "对比维度",
  ja: "比較項目",
  fr: "Dimension",
  es: "Dimensión",
  ko: "비교 기준",
  ru: "Критерий",
  ar: "معيار المقارنة",
};
