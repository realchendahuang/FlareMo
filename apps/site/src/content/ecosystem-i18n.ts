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
    heading: "三种方式，接进你的日常",
    subtitle: "CLI、MCP 与开放 API，把同一份知识库接到你已经在用的工作流里。",
    clients: [
      {
        title: "AI Agents",
        tag: "Model Context Protocol",
        desc: "Claude、Cursor、Codex 通过 MCP 或 Skill 读写同一份长期记忆。",
      },
      {
        title: "flaremo CLI",
        tag: "终端",
        desc: "在任意终端里检索、写入、做检查点；脚本与 Agent 共用一套命令。",
      },
      {
        title: "Telegram Bot",
        tag: "即时捕捉",
        desc: "把文字、图片与语音发给专属 Bot，几秒内完成入库。",
      },
      {
        title: "Open API & PAT",
        tag: "自动化",
        desc: "可撤销的个人访问令牌，接你自己的脚本与定时任务。",
      },
    ],
  },
  en: {
    badge: "Bring Your Own Tools",
    heading: "Three Ways Into Your Daily Flow",
    subtitle:
      "CLI, MCP and an open API — one knowledge base, wired into the tools you already use.",
    clients: [
      {
        title: "AI Agents",
        tag: "Model Context Protocol",
        desc: "Claude, Cursor and Codex read and write the same long-term memory over MCP or a skill.",
      },
      {
        title: "flaremo CLI",
        tag: "Terminal",
        desc: "Search, write and checkpoint from any shell; scripts and agents share one command set.",
      },
      {
        title: "Telegram Bot",
        tag: "Instant Capture",
        desc: "Send text, photos or voice to your own bot and land them in seconds.",
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
    heading: "日常に組み込む、3 つの入口",
    subtitle:
      "CLI、MCP、オープン API。同じナレッジベースを、使い慣れたワークフローへ。",
    clients: [
      {
        title: "AI Agents",
        tag: "Model Context Protocol",
        desc: "Claude、Cursor、Codex が MCP または Skill 経由で同じ長期記憶を読み書きします。",
      },
      {
        title: "flaremo CLI",
        tag: "ターミナル",
        desc: "どのシェルからでも検索・記録・チェックポイント。スクリプトと Agent が同じコマンドを共有します。",
      },
      {
        title: "Telegram Bot",
        tag: "即時キャプチャ",
        desc: "テキストも写真も音声も、専用 Bot に送れば数秒で記録できます。",
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
    heading: "Trois façons d'entrer dans votre quotidien",
    subtitle:
      "CLI, MCP et API ouverte : une seule base de connaissances, branchée sur vos outils.",
    clients: [
      {
        title: "Agents IA",
        tag: "Model Context Protocol",
        desc: "Claude, Cursor et Codex lisent et écrivent la même mémoire à long terme via MCP ou un skill.",
      },
      {
        title: "CLI flaremo",
        tag: "Terminal",
        desc: "Cherchez, écrivez et créez des points de contrôle depuis n'importe quel shell.",
      },
      {
        title: "Bot Telegram",
        tag: "Capture instantanée",
        desc: "Envoyez texte, photos ou voix à votre bot : les notes arrivent en quelques secondes.",
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
    heading: "Tres formas de entrar en tu día a día",
    subtitle:
      "CLI, MCP y API abierta: una sola base de conocimiento, conectada a tus herramientas.",
    clients: [
      {
        title: "Agentes de IA",
        tag: "Model Context Protocol",
        desc: "Claude, Cursor y Codex leen y escriben la misma memoria a largo plazo mediante MCP o un skill.",
      },
      {
        title: "CLI de flaremo",
        tag: "Terminal",
        desc: "Busca, escribe y crea puntos de control desde cualquier shell.",
      },
      {
        title: "Bot de Telegram",
        tag: "Captura instantánea",
        desc: "Envía texto, fotos o voz a tu bot y las notas llegan en segundos.",
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
    heading: "일상으로 들어가는 세 가지 길",
    subtitle:
      "CLI, MCP, 오픈 API. 하나의 지식 베이스를 이미 쓰는 워크플로에 연결하세요.",
    clients: [
      {
        title: "AI Agents",
        tag: "Model Context Protocol",
        desc: "Claude, Cursor, Codex가 MCP 또는 스킬로 같은 장기 기억을 읽고 씁니다.",
      },
      {
        title: "flaremo CLI",
        tag: "터미널",
        desc: "어떤 셸에서든 검색하고 기록하고 체크포인트를 남깁니다.",
      },
      {
        title: "Telegram Bot",
        tag: "즉각 기록",
        desc: "텍스트, 사진, 음성을 전용 봇에 보내면 몇 초 만에 저장됩니다.",
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
    heading: "Три способа встроиться в ваш день",
    subtitle:
      "CLI, MCP и открытый API: одна база знаний — в привычных инструментах.",
    clients: [
      {
        title: "ИИ-агенты",
        tag: "Model Context Protocol",
        desc: "Claude, Cursor и Codex читают и пишут одну и ту же долговременную память через MCP или skill.",
      },
      {
        title: "flaremo CLI",
        tag: "Терминал",
        desc: "Поиск, запись и контрольные точки из любой оболочки.",
      },
      {
        title: "Telegram Bot",
        tag: "Быстрый сбор",
        desc: "Отправьте текст, фото или голос своему боту — заметка появится за секунды.",
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
    heading: "ثلاث طرق إلى يومك",
    subtitle:
      "CLI وMCP وواجهة برمجية مفتوحة: قاعدة معرفة واحدة داخل أدواتك المعتادة.",
    clients: [
      {
        title: "AI Agents",
        tag: "Model Context Protocol",
        desc: "يقرأ Claude وCursor وCodex ويكتبون الذاكرة طويلة المدى نفسها عبر MCP أو مهارة.",
      },
      {
        title: "flaremo CLI",
        tag: "الطرفية",
        desc: "ابحث واكتب وأنشئ نقاط حفظ من أي طرفية.",
      },
      {
        title: "Telegram Bot",
        tag: "التقاط فوري",
        desc: "أرسل النص أو الصور أو الصوت إلى روبوتك لتصل في ثوانٍ.",
      },
      {
        title: "API مفتوح وPAT",
        tag: "الأتمتة",
        desc: "رموز وصول شخصية قابلة للإلغاء لسكربتك ومهامك المجدولة.",
      },
    ],
  },
};
