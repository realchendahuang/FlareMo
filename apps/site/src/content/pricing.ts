import type { Locale } from "@/lib/seo";

export type PricingTier = {
  id: "free";
  name: string;
  price: string;
  period?: string;
  tagline: string;
  features: string[];
  cta: string;
  ctaHref: string;
  ctaVariant?: "primary" | "secondary";
};

export type PricingPage = {
  title: string;
  subtitle: string;
  intro: string;
  deploymentHeading: string;
  deploymentRows: Array<{ label: string; value: string }>;
  faqHeading: string;
  faqItems: Array<{ q: string; a: string }>;
  legalHeading: string;
  legal: string[];
};

const TIERS_ZH: PricingTier[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "/ 永久",
    tagline: "完全免费,自己部署",
    features: [
      "一键部署到自己的账号",
      "约 250 万条文字 + 1 万张图片",
      "安全登录,第三方 App 可用",
      "兼容 Memos、flomo",
      "离线也能写,自动同步",
      "社区支持",
    ],
    cta: "一键部署",
    ctaHref:
      "https://deploy.workers.cloudflare.com/?url=https://github.com/realchendahuang/FlareMo",
    ctaVariant: "secondary",
  },
];

const TIERS_EN: PricingTier[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "/ forever",
    tagline: "Free forever, self-host it",
    features: [
      "One-click deploy to your own account",
      "~2.5M text notes + 10k photos",
      "Secure login, third-party apps work",
      "Memos and flomo compatible",
      "Write offline, sync automatically",
      "Community support",
    ],
    cta: "Deploy now",
    ctaHref:
      "https://deploy.workers.cloudflare.com/?url=https://github.com/realchendahuang/FlareMo",
    ctaVariant: "secondary",
  },
];

const ZH_PRICING_PAGE: PricingPage = {
  title: "定价",
  subtitle: "免费,自己部署。一个 Cloudflare 免费账号就够。",
  intro:
    "FlareMo 是开源软件,部署到你自己的 Cloudflare 账号,免费额度对个人笔记完全够用。",
  deploymentHeading: "Cloudflare 免费层对照",
  deploymentRows: [
    { label: "D1 数据库存储", value: "5 GB（约 250 万条笔记）" },
    { label: "R2 对象存储", value: "10 GB（约 5,000–10,000 张图）" },
    { label: "R2 出口流量", value: "免费" },
    { label: "Workers 请求", value: "每日 10 万次免费" },
    { label: "Vectorize 维度", value: "免费 5M 存 / 30M 查 / 月" },
    { label: "Workers AI", value: "按神经元计费，绑定后每日免费额度" },
  ],
  faqHeading: "Pricing 常见问题",
  faqItems: [
    {
      q: "免费真的够用吗?",
      a: "够。免费档能装 250 万条文字 + 一万张图片,普通人一辈子写不完。",
    },
    {
      q: "部署需要什么?",
      a: "一个免费 Cloudflare 账号,点一键部署按钮即可,不需要服务器和数据库。",
    },
    {
      q: "数据会丢吗?",
      a: "数据存在 Cloudflare 的 D1 和 R2,多地冗余。建议偶尔一键导出备份,双保险。",
    },
    {
      q: "能从 Memos 或 flomo 搬过来吗?",
      a: "能。一键导入,冲突怎么处理你说了算。",
    },
  ],
  legalHeading: "使用条款与隐私",
  legal: [
    "FlareMo 是 AGPL-3.0 开源软件,自部署实例的数据完全归你所有。",
    "FlareMo 不会读取或索引你的笔记内容用于训练或商业分析。",
  ],
};

const EN_PRICING_PAGE: PricingPage = {
  title: "Pricing",
  subtitle: "Free, self-hosted. A free Cloudflare account is all you need.",
  intro:
    "FlareMo is open source. Deploy it to your own Cloudflare account — the free tier is more than enough for personal notes.",
  deploymentHeading: "Cloudflare free tier reference",
  deploymentRows: [
    { label: "D1 storage", value: "5 GB (~2.5M notes)" },
    { label: "R2 storage", value: "10 GB (~5,000–10,000 photos)" },
    { label: "R2 egress", value: "Free" },
    { label: "Workers requests", value: "100k / day free" },
    {
      label: "Vectorize dimensions",
      value: "5M stored / 30M queried per month free",
    },
    {
      label: "Workers AI",
      value: "Per-neuron billed, daily free allowance after binding",
    },
  ],
  faqHeading: "Pricing FAQ",
  faqItems: [
    {
      q: "Is the free tier really enough?",
      a: "Yes. It fits 2.5M text notes plus 10k photos. Most people never come close.",
    },
    {
      q: "What do I need to deploy?",
      a: "A free Cloudflare account. Click the one-click deploy button — no server or database required.",
    },
    {
      q: "Will I lose my data?",
      a: "Data lives in Cloudflare D1 and R2 with multi-region redundancy. We still recommend an occasional one-click export to your own drive.",
    },
    {
      q: "Can I move from Memos or flomo?",
      a: "Yes. One-click import; you decide how to handle conflicts.",
    },
  ],
  legalHeading: "Terms and privacy",
  legal: [
    "FlareMo is AGPL-3.0 open source; data in your self-hosted instance is entirely yours.",
    "FlareMo will not read or index your notes for training or analytics.",
  ],
};

export function getPricingTiers(locale: Locale): PricingTier[] {
  return locale === "zh-CN" ? TIERS_ZH : TIERS_EN;
}

export function getPricingPage(locale: Locale): PricingPage {
  return locale === "zh-CN" ? ZH_PRICING_PAGE : EN_PRICING_PAGE;
}
