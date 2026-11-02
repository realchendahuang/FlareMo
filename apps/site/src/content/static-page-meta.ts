import type { SupportedLocale } from "@/lib/seo";

export type RouteMeta = {
  /** Route path with :param placeholders resolved, e.g. /docs/deploy */
  path: string;
  locale: SupportedLocale;
  title: string;
  description: string;
  ogType?: "website" | "article";
  jsonLd?: unknown;
};

export const STATIC_PAGE_META: Record<
  SupportedLocale,
  {
    homeTitle: string;
    homeDesc: string;
    docsTitle: string;
    docsDesc: string;
  }
> = {
  en: {
    homeTitle: "FlareMo - AI-Native Second Brain on Cloudflare",
    homeDesc:
      "An AI-native second brain that runs on a free Cloudflare account: capture, tasks, articles and team sharing — plus MCP access for your AI agents.",
    docsTitle: "Documentation",
    docsDesc:
      "FlareMo documentation overview: deployment, architecture, open API, agent integrations, and reference.",
  },
  zh: {
    homeTitle: "FlareMo - Cloudflare 原生的 AI 第二大脑",
    homeDesc:
      "一个免费 Cloudflare 账号就能跑起来的 AI 原生第二大脑：速记、任务、文章与团队共享，AI Agent 可以通过 MCP 直接读写你的笔记。",
    docsTitle: "文档总览",
    docsDesc: "FlareMo 文档总览：部署、架构、开放 API、Agent 集成与参考。",
  },
  ja: {
    homeTitle: "FlareMo - Cloudflare ネイティブの AI セカンドブレイン",
    homeDesc:
      "無料の Cloudflare アカウントで動く AI ネイティブなセカンドブレイン。素早い記録、タスク、記事、チーム共有、そして AI エージェントが MCP でノートを読み書きできる環境を一つに。",
    docsTitle: "ドキュメント総覧",
    docsDesc:
      "FlareMo ドキュメント総覧：デプロイ、アーキテクチャ、オープン API、Agent 統合、リファレンス。",
  },
  fr: {
    homeTitle: "FlareMo - Second cerveau natif IA sur Cloudflare",
    homeDesc:
      "Un second cerveau natif IA qui tourne sur un compte Cloudflare gratuit : capture, tâches, articles et partage d'équipe, avec un accès MCP pour vos agents IA.",
    docsTitle: "Documentation",
    docsDesc:
      "Vue d'ensemble de la documentation FlareMo : déploiement, architecture, API ouverte, intégration d'agents et référence.",
  },
  es: {
    homeTitle: "FlareMo - Segundo cerebro nativo de IA en Cloudflare",
    homeDesc:
      "Un segundo cerebro nativo de IA que funciona con una cuenta gratuita de Cloudflare: captura, tareas, artículos y espacio de equipo, con acceso MCP para tus agentes de IA.",
    docsTitle: "Documentación",
    docsDesc:
      "Resumen de la documentación de FlareMo: despliegue, arquitectura, API abierta, integración de agentes y referencia.",
  },
  ko: {
    homeTitle: "FlareMo - Cloudflare 기반 AI 세컨드 브레인",
    homeDesc:
      "무료 Cloudflare 계정으로 돌아가는 AI 네이티브 세컨드 브레인. 빠른 기록, 할 일, 아티클, 팀 공유에 더해 AI 에이전트가 MCP로 노트를 읽고 쓸 수 있습니다.",
    docsTitle: "문서 개요",
    docsDesc:
      "FlareMo 문서 개요: 배포, 아키텍처, 오픈 API, 에이전트 연동 및 레퍼런스.",
  },
  ru: {
    homeTitle: "FlareMo - AI-«второй мозг» на Cloudflare",
    homeDesc:
      "Второй мозг на базе ИИ, работающий на бесплатном аккаунте Cloudflare: заметки, задачи, статьи и общее пространство команды, а также доступ по MCP для ваших ИИ-агентов.",
    docsTitle: "Обзор документации",
    docsDesc:
      "Обзор документации FlareMo: развертывание, архитектура, открытый API, интеграция агентов и справочник.",
  },
  ar: {
    homeTitle: "FlareMo - دماغ ثانٍ بالذكاء الاصطناعي على Cloudflare",
    homeDesc:
      "دماغ ثانٍ يعمل بالذكاء الاصطناعي على حساب Cloudflare مجاني: تدوين سريع، مهام، مقالات، مساحة مشتركة للفريق، ووصول MCP لوكلاء الذكاء الاصطناعي.",
    docsTitle: "نظرة عامة على المستندات",
    docsDesc:
      "نظرة عامة على مستندات FlareMo: النشر، الهندسة المعمارية، واجهة برمجية مفتوحة، تكاملات الوكلاء والمراجع.",
  },
};
