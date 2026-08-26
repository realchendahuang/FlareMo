import type { Locale } from "@/lib/seo";

export type HomeContent = {
  heroEyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  primaryCta: string;
  secondaryCta: string;
  featuresHeading: string;
  features: Array<{
    title: string;
    description: string;
  }>;
  comparisonHeading: string;
  comparisonIntro: string;
  comparisonRows: Array<{
    label: string;
    cloudflare: string;
    nas: string;
    vps: string;
  }>;
  screenshotsHeading: string;
  screenshotsCaption: string;
  pricingHeading: string;
  pricingSubtitle: string;
  faqHeading: string;
  faqItems: Array<{
    q: string;
    a: string;
  }>;
};

const ZH_HOME: HomeContent = {
  heroEyebrow: "永远在线的个人笔记",
  heroTitle: "搭一个你自己的私人笔记,永远在线、永远不丢",
  heroSubtitle: "不用买服务器,不用装数据库。手机电脑随时写、随时搜、随时找回。",
  primaryCta: "一键部署",
  secondaryCta: "Hosted 试用",
  featuresHeading: "为什么用 FlareMo",
  features: [
    {
      title: "永远不会丢",
      description:
        "笔记存在云端企业级存储。硬盘坏了、停电、被偷、搬家,都跟你没关系。",
    },
    {
      title: "免费就够用",
      description: "免费版能装 250 万条文字 + 一万张图片,普通人一辈子写不完。",
    },
    {
      title: "离线也能写",
      description: "地铁、飞机上没信号照常写,连上网自动按顺序同步,不漏一条。",
    },
    {
      title: "AI 也能读",
      description:
        "AI 助手可以把你的笔记当长期记忆用,你的纠正会覆盖它,数据还是你的。",
    },
    {
      title: "兼容 Memos",
      description:
        "Memos、flomo 的笔记一键搬过来;老的第三方 App 不用换,接着用。",
    },
    {
      title: "数据归你",
      description: "随时一键导出备份,或关掉账号带走所有数据,不留尾巴。",
    },
  ],
  comparisonHeading: "为什么云端比家里的硬盘靠谱",
  comparisonIntro: "",
  comparisonRows: [
    {
      label: "数据存在哪",
      cloudflare: "云端,多地冗余",
      nas: "家里的硬盘",
      vps: "云厂商的虚拟机",
    },
    {
      label: "硬盘坏了",
      cloudflare: "自动换,你没感觉",
      nas: "可能全丢",
      vps: "看厂商,可能全丢",
    },
    {
      label: "停电、断网",
      cloudflare: "完全不受影响",
      nas: "整台停",
      vps: "可能跟着停",
    },
    {
      label: "异地备份",
      cloudflare: "开箱就有",
      nas: "得自己折腾",
      vps: "看厂商",
    },
    {
      label: "全球访问",
      cloudflare: "就近打开,秒开",
      nas: "得自己折腾穿透",
      vps: "看机房位置",
    },
    {
      label: "日常维护",
      cloudflare: "零",
      nas: "打补丁、升级、看监控",
      vps: "打补丁、升级",
    },
  ],
  screenshotsHeading: "长这样",
  screenshotsCaption: "",
  pricingHeading: "价格",
  pricingSubtitle: "免费档够大部分人用。要省心可以选 Hosted,我们帮你管。",
  faqHeading: "常见问题",
  faqItems: [
    {
      q: "免费真的够用吗?",
      a: "够。免费档能装 250 万条文字 + 一万张图片,普通人一辈子写不完。",
    },
    {
      q: "数据会不会丢?",
      a: "不会轻易丢。建议偶尔一键导出备份到自己硬盘,双保险。",
    },
    {
      q: "能从 Memos 或 flomo 搬过来吗?",
      a: "能。一键导入,冲突怎么处理你说了算。",
    },
    {
      q: "老的第三方 App 还能用吗?",
      a: "能。常见客户端都验证过,直接连就行。",
    },
  ],
};

const EN_HOME: HomeContent = {
  heroEyebrow: "Personal notes that stay online",
  heroTitle: "Your private notes. Always online. Always yours.",
  heroSubtitle:
    "No server to buy. No database to set up. Write, search, and find anything from any device.",
  primaryCta: "Deploy now",
  secondaryCta: "Hosted trial",
  featuresHeading: "Why FlareMo",
  features: [
    {
      title: "Never lose a note",
      description:
        "Stored on enterprise cloud storage. Drive failures, power cuts, theft, moves — none of it touches your data.",
    },
    {
      title: "Free is enough",
      description:
        "The free tier fits 2.5M text notes plus 10k photos. Most people never come close.",
    },
    {
      title: "Works offline",
      description:
        "Write on the subway, on a plane, with no signal. Everything syncs in order when you're back online.",
    },
    {
      title: "Your AI can read it",
      description:
        "AI assistants can use your notes as long-term memory. Your edits always win.",
    },
    {
      title: "Memos compatible",
      description:
        "Import from Memos or flomo in one click. Keep using the third-party apps you already use.",
    },
    {
      title: "Your data, your call",
      description:
        "Export everything anytime. Or close the account and walk away with all of it.",
    },
  ],
  comparisonHeading: "Why cloud beats the hard drive at home",
  comparisonIntro: "",
  comparisonRows: [
    {
      label: "Where your data lives",
      cloudflare: "Cloud, replicated across regions",
      nas: "The drive in your home",
      vps: "A VM disk at a cloud vendor",
    },
    {
      label: "Disk failure",
      cloudflare: "Auto-replaced, you don't notice",
      nas: "You may lose everything",
      vps: "Vendor-dependent, may lose everything",
    },
    {
      label: "Power or network outage",
      cloudflare: "Completely unaffected",
      nas: "Whole thing goes down",
      vps: "May go down too",
    },
    {
      label: "Off-site backup",
      cloudflare: "Included",
      nas: "You build it yourself",
      vps: "Vendor-dependent",
    },
    {
      label: "Global access",
      cloudflare: "Nearby edge, opens in a second",
      nas: "You set up tunneling yourself",
      vps: "Tied to the data center region",
    },
    {
      label: "Day-to-day upkeep",
      cloudflare: "None",
      nas: "Patches, upgrades, monitoring",
      vps: "Patches, upgrades",
    },
  ],
  screenshotsHeading: "What it looks like",
  screenshotsCaption: "",
  pricingHeading: "Pricing",
  pricingSubtitle:
    "Free covers most people. Want zero upkeep? Pick Hosted and we run it for you.",
  faqHeading: "Common questions",
  faqItems: [
    {
      q: "Is the free tier really enough?",
      a: "Yes. It fits 2.5M text notes plus 10k photos. Most people never come close.",
    },
    {
      q: "Will I lose my data?",
      a: "Very unlikely. We still recommend an occasional one-click export to your own drive.",
    },
    {
      q: "Can I move from Memos or flomo?",
      a: "Yes. One-click import; you decide how to handle conflicts.",
    },
    {
      q: "Do my old third-party apps still work?",
      a: "Yes. Common clients have been verified to connect directly.",
    },
  ],
};

export function getHomeContent(locale: Locale): HomeContent {
  return locale === "zh-CN" ? ZH_HOME : EN_HOME;
}
