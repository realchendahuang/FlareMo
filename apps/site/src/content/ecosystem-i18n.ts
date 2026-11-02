import type { SupportedLocale } from "@/lib/seo";

export const ECOSYSTEM_CONTENT: Record<
  SupportedLocale,
  {
    badge: string;
    heading: string;
    subtitle: string;
    clients: Array<{
      title: string;
      tag: string;
      desc: string;
    }>;
  }
> = {
  zh: {
    badge: "接入你的工具链",
    heading: "把 FlareMo 接进你的日常",
    subtitle: "把同一份知识库，接到你已经在用的工作流里。",
    clients: [
      {
        title: "AI Agents",
        tag: "Model Context Protocol",
        desc: "Claude、Cursor、Codex 通过 MCP 或 Skill 搜索、读取和写入你的笔记。",
      },
      {
        title: "Notes Skill",
        tag: "Skill",
        desc: "教 Agent 先搜索再写入、保留你的原文，并回报它改动的笔记 ID。",
      },
      {
        title: "Telegram Bot",
        tag: "即时捕捉",
        desc: "仓库自带示例机器人：把想法发给 Bot，直接收进知识库。",
      },
      {
        title: "Open API & PAT",
        tag: "自动化",
        desc: "可撤销的个人访问令牌，接进你自己的脚本与定时任务。",
      },
    ],
  },
  en: {
    badge: "Bring Your Own Tools",
    heading: "Wire FlareMo Into Your Daily Flow",
    subtitle: "One knowledge base, wired into the workflows you already use.",
    clients: [
      {
        title: "AI Agents",
        tag: "Model Context Protocol",
        desc: "Claude, Cursor and Codex search, read and write your notes over MCP or a skill.",
      },
      {
        title: "Notes Skill",
        tag: "Skill",
        desc: "Teaches an agent to search before writing, keep your wording, and report the note ID it changed.",
      },
      {
        title: "Telegram Bot",
        tag: "Instant Capture",
        desc: "A bundled example bot that files what you send straight into your knowledge base.",
      },
      {
        title: "Open API & PAT",
        tag: "Automation",
        desc: "Revocable personal access tokens for your own scripts and scheduled jobs.",
      },
    ],
  },
  ja: {
    badge: "既存ツールとつながる",
    heading: "日常のワークフローに組み込む",
    subtitle: "同じナレッジベースを、使い慣れたワークフローへ。",
    clients: [
      {
        title: "AI Agents",
        tag: "Model Context Protocol",
        desc: "Claude、Cursor、Codex が MCP または Skill 経由でノートを検索・読み取り・書き込みします。",
      },
      {
        title: "Notes Skill",
        tag: "Skill",
        desc: "書く前に検索し、原文を保ち、変更したノートIDを返す規約を Agent に教えます。",
      },
      {
        title: "Telegram Bot",
        tag: "即時キャプチャ",
        desc: "同梱のサンプル Bot に送るだけで、そのままナレッジベースに記録されます。",
      },
      {
        title: "Open API & PAT",
        tag: "自動化",
        desc: "失効可能な個人アクセストークンで、自分のスクリプトや定期実行につなげます。",
      },
    ],
  },
  fr: {
    badge: "Vos outils, connectés",
    heading: "Branchez FlareMo sur votre quotidien",
    subtitle: "Une seule base de connaissances, branchée sur vos outils.",
    clients: [
      {
        title: "Agents IA",
        tag: "Model Context Protocol",
        desc: "Claude, Cursor et Codex cherchent, lisent et écrivent vos notes via MCP ou un skill.",
      },
      {
        title: "Skill Notes",
        tag: "Skill",
        desc: "Apprend à l'agent à chercher avant d'écrire, à respecter votre formulation et à renvoyer l'ID modifié.",
      },
      {
        title: "Bot Telegram",
        tag: "Capture instantanée",
        desc: "Un bot d'exemple fourni : ce que vous lui envoyez arrive directement dans votre base de connaissances.",
      },
      {
        title: "API ouverte et PAT",
        tag: "Automatisation",
        desc: "Des jetons personnels révocables pour vos scripts et vos tâches planifiées.",
      },
    ],
  },
  es: {
    badge: "Tus herramientas, conectadas",
    heading: "Conecta FlareMo con tu día a día",
    subtitle: "Una sola base de conocimiento, conectada a tus herramientas.",
    clients: [
      {
        title: "Agentes de IA",
        tag: "Model Context Protocol",
        desc: "Claude, Cursor y Codex buscan, leen y escriben tus notas mediante MCP o un skill.",
      },
      {
        title: "Skill de notas",
        tag: "Skill",
        desc: "Enseña al agente a buscar antes de escribir, respetar tu redacción y devolver el ID modificado.",
      },
      {
        title: "Bot de Telegram",
        tag: "Captura instantánea",
        desc: "Un bot de ejemplo incluido: lo que le envíes llega directo a tu base de conocimiento.",
      },
      {
        title: "API abierta y PAT",
        tag: "Automatización",
        desc: "Tokens personales revocables para tus scripts y tareas programadas.",
      },
    ],
  },
  ko: {
    badge: "쓰던 도구와 연결",
    heading: "일상 워크플로에 연결하세요",
    subtitle: "하나의 지식 베이스를 이미 쓰는 워크플로에 연결하세요.",
    clients: [
      {
        title: "AI Agents",
        tag: "Model Context Protocol",
        desc: "Claude, Cursor, Codex가 MCP 또는 스킬로 노트를 검색·읽기·쓰기합니다.",
      },
      {
        title: "Notes Skill",
        tag: "Skill",
        desc: "쓰기 전 검색, 원문 유지, 변경한 노트 ID 반환을 Agent에 가르칩니다.",
      },
      {
        title: "Telegram Bot",
        tag: "즉각 기록",
        desc: "함께 제공되는 예제 봇에 보내면 바로 지식 베이스에 저장됩니다.",
      },
      {
        title: "Open API & PAT",
        tag: "자동화",
        desc: "폐기 가능한 개인 액세스 토큰으로 내 스크립트와 예약 작업에 연결합니다.",
      },
    ],
  },
  ru: {
    badge: "Ваши инструменты",
    heading: "Встройте FlareMo в свой день",
    subtitle: "Одна база знаний — в привычных вам инструментах.",
    clients: [
      {
        title: "ИИ-агенты",
        tag: "Model Context Protocol",
        desc: "Claude, Cursor и Codex ищут, читают и записывают ваши заметки через MCP или skill.",
      },
      {
        title: "Навык заметок",
        tag: "Skill",
        desc: "Учит агента сначала искать, сохранять вашу формулировку и возвращать ID изменённой заметки.",
      },
      {
        title: "Telegram Bot",
        tag: "Быстрый сбор",
        desc: "Пример бота в комплекте: отправленное сразу попадает в базу знаний.",
      },
      {
        title: "Открытый API и PAT",
        tag: "Автоматизация",
        desc: "Отзываемые персональные токены для ваших скриптов и задач по расписанию.",
      },
    ],
  },
  ar: {
    badge: "أدواتك، متصلة",
    heading: "اربط FlareMo بيومك",
    subtitle: "قاعدة معرفة واحدة داخل أدواتك المعتادة.",
    clients: [
      {
        title: "AI Agents",
        tag: "Model Context Protocol",
        desc: "يبحث Claude وCursor وCodex في ملاحظاتك ويقرؤونها ويكتبونها عبر MCP أو مهارة.",
      },
      {
        title: "مهارة الملاحظات",
        tag: "Skill",
        desc: "تعلّم الوكيل البحث قبل الكتابة، والحفاظ على صياغتك، وإرجاع معرّف الملاحظة المعدّلة.",
      },
      {
        title: "Telegram Bot",
        tag: "التقاط فوري",
        desc: "روبوت تجريبي مرفق: ما ترسله يصل مباشرة إلى قاعدة معرفتك.",
      },
      {
        title: "API مفتوح وPAT",
        tag: "الأتمتة",
        desc: "رموز وصول شخصية قابلة للإلغاء لسكربتك ومهامك المجدولة.",
      },
    ],
  },
};
