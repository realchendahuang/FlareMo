import type { SupportedLocale } from "@/lib/seo";

/**
 * Copy for the static 404 shell (`dist/site/404.html`) and the client-side
 * not-found route. Kept out of HomeContent because the page must render
 * without any route loader.
 */
export type NotFoundContent = {
  eyebrow: string;
  title: string;
  description: string;
  homeCta: string;
  docsCta: string;
};

export const NOT_FOUND_COPY: Record<SupportedLocale, NotFoundContent> = {
  en: {
    eyebrow: "404",
    title: "This page went quiet.",
    description:
      "The link is broken, or the page moved. Nothing was lost — head back and pick up where you were.",
    homeCta: "Back to home",
    docsCta: "Browse the docs",
  },
  zh: {
    eyebrow: "404",
    title: "这一页静下来了。",
    description:
      "链接可能坏了，或者页面已经搬走。数据没有丢，回到首页继续就好。",
    homeCta: "回到首页",
    docsCta: "浏览文档",
  },
  ja: {
    eyebrow: "404",
    title: "このページは静かになりました。",
    description:
      "リンクが切れているか、ページが移動しました。データは失われていません。ホームから続けてください。",
    homeCta: "ホームへ戻る",
    docsCta: "ドキュメントを見る",
  },
  fr: {
    eyebrow: "404",
    title: "Cette page s'est tue.",
    description:
      "Le lien est cassé ou la page a été déplacée. Rien n'est perdu : revenez à l'accueil et reprenez.",
    homeCta: "Retour à l'accueil",
    docsCta: "Parcourir la documentation",
  },
  es: {
    eyebrow: "404",
    title: "Esta página se quedó en silencio.",
    description:
      "El enlace está roto o la página se movió. No se perdió nada: vuelve al inicio y sigue donde estabas.",
    homeCta: "Volver al inicio",
    docsCta: "Ver la documentación",
  },
  ko: {
    eyebrow: "404",
    title: "이 페이지는 조용해졌습니다.",
    description:
      "링크가 깨졌거나 페이지가 이동했습니다. 데이터는 그대로이니 홈에서 이어가세요.",
    homeCta: "홈으로",
    docsCta: "문서 보기",
  },
  ru: {
    eyebrow: "404",
    title: "Эта страница затихла.",
    description:
      "Ссылка сломана или страница переехала. Данные не потеряны — вернитесь на главную и продолжайте.",
    homeCta: "На главную",
    docsCta: "Открыть документацию",
  },
  ar: {
    eyebrow: "404",
    title: "هذه الصفحة هدأت.",
    description:
      "الرابط معطوب أو أن الصفحة نُقلت. لم يضع شيء — عُد إلى الرئيسية وأكمل من حيث توقفت.",
    homeCta: "العودة إلى الرئيسية",
    docsCta: "تصفح المستندات",
  },
};
