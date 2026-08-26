import type { Locale } from "@/lib/seo";

export type PricingTier = {
  id: "free" | "pro" | "team";
  name: string;
  price: string;
  period?: string;
  highlight?: boolean;
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
    tagline: "完全免费，基于 Cloudflare 免费层",
    features: [
      "Deploy Button 一键部署到自己 Cloudflare 账号",
      "D1 数据库 5 GB / R2 对象存储 10 GB",
      "Better Auth 登录 + memos_pat_ PAT",
      "Memos 兼容 API 子集",
      "PWA 离线队列",
      "社区支持",
    ],
    cta: "Deploy 自己的实例",
    ctaHref:
      "https://deploy.workers.cloudflare.com/?url=https://github.com/realchendahuang/FlareMo",
    ctaVariant: "secondary",
  },
  {
    id: "pro",
    name: "Pro",
    price: "$4",
    period: "/ 月",
    highlight: true,
    tagline: "面向不想部署的个人",
    features: [
      "Hosted SaaS，零运维",
      "Free 全部能力",
      "语义搜索（Vectorize 启用）",
      "memo 50,000 条 / 附件 25 GB",
      "自定义域名（*.hosted.flaremo.app）",
      "5 设备同步",
    ],
    cta: "Hosted 试用（Phase 2）",
    ctaHref: "/hosted",
    ctaVariant: "primary",
  },
  {
    id: "team",
    name: "Team",
    price: "$9",
    period: "/ 席位 / 月",
    tagline: "面向小团队与共享 workspace",
    features: [
      "Pro 全部能力",
      "共享 workspace",
      "成员管理与邀请",
      "审计日志",
      "优先支持",
    ],
    cta: "联系我们",
    ctaHref: "mailto:hello@flaremo.app",
    ctaVariant: "secondary",
  },
];

const TIERS_EN: PricingTier[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "/ forever",
    tagline: "Completely free, on the Cloudflare free tier",
    features: [
      "Deploy Button to your own Cloudflare account",
      "D1 5 GB / R2 10 GB",
      "Better Auth login + memos_pat_ PAT",
      "Memos-compatible API subset",
      "PWA offline queue",
      "Community support",
    ],
    cta: "Deploy your own",
    ctaHref:
      "https://deploy.workers.cloudflare.com/?url=https://github.com/realchendahuang/FlareMo",
    ctaVariant: "secondary",
  },
  {
    id: "pro",
    name: "Pro",
    price: "$4",
    period: "/ month",
    highlight: true,
    tagline: "For people who don't want to deploy",
    features: [
      "Hosted SaaS, zero ops",
      "Everything in Free",
      "Semantic search (Vectorize enabled)",
      "50,000 notes / 25 GB attachments",
      "Custom domain (*.hosted.flaremo.app)",
      "5 synced devices",
    ],
    cta: "Hosted trial (Phase 2)",
    ctaHref: "/en/hosted",
    ctaVariant: "primary",
  },
  {
    id: "team",
    name: "Team",
    price: "$9",
    period: "/ seat / month",
    tagline: "For small teams and shared workspaces",
    features: [
      "Everything in Pro",
      "Shared workspace",
      "Member management and invites",
      "Audit log",
      "Priority support",
    ],
    cta: "Contact us",
    ctaHref: "mailto:hello@flaremo.app",
    ctaVariant: "secondary",
  },
];

const ZH_PRICING_PAGE: PricingPage = {
  title: "定价",
  subtitle: "Free 永久免费；Pro / Team 由 Stripe 结算，Phase 2 上线。",
  intro:
    "我们刻意把 Free 档做成「真的够用」。Hosted 套餐的边际成本由 Cloudflare 免费层覆盖，Pro / Team 才是真正烧钱的档位（语义搜索的 embedding 推理与边缘节点算力）。",
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
      q: "Hosted 什么时候上线？",
      a: "Phase 0 发布官网与文档；Phase 1 解锁自部署多用户；Phase 2 推出 Hosted 试用。路线图见 docs/saas-roadmap.md。",
    },
    {
      q: "可以从 Free 升级 Pro 吗？",
      a: "可以，Phase 2 时通过 Stripe Customer Portal 自助升降级。数据通过导出/导入迁移。",
    },
    {
      q: "Pro 的语义搜索会增加多少成本？",
      a: "Vectorize 免费层 5M 存 / 30M 查 / 月；按一条 1024 维 embedding 算，单租户 50,000 条 memo 仍在线性范围内。",
    },
    {
      q: "可以退款吗？",
      a: "Stripe 30 天内可申请全额退款，无附加条款。",
    },
  ],
  legalHeading: "使用条款与隐私",
  legal: [
    "FlareMo 是 Apache-2.0 开源软件；Hosted 服务条款在 Phase 2 上线时单独发布。",
    "Hosted 默认收集最少必要数据（账号、邮箱、笔记元数据）。笔记正文加密备份可选。",
    "FlareMo 不会读取或索引用户的笔记内容用于训练或商业分析。",
  ],
};

const EN_PRICING_PAGE: PricingPage = {
  title: "Pricing",
  subtitle:
    "Free is forever; Pro and Team are billed through Stripe (Phase 2).",
  intro:
    "We deliberately made the Free tier actually useful. The marginal cost of the Hosted SaaS is covered by the Cloudflare free tier. Pro and Team are where the real cost (semantic-search embedding inference and edge compute) lives.",
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
      q: "When does Hosted launch?",
      a: "Phase 0 ships this site and docs. Phase 1 unlocks multi-user self-host. Phase 2 opens the Hosted trial. See docs/saas-roadmap.md.",
    },
    {
      q: "Can I upgrade from Free to Pro?",
      a: "Yes — Phase 2 will use the Stripe Customer Portal for self-serve changes. Data moves via export/import.",
    },
    {
      q: "How much does semantic search cost on Pro?",
      a: "Vectorize gives 5M stored / 30M queried dims per month for free; a single-tenant 50k-memo workspace stays well within that at 1024-dim embeddings.",
    },
    {
      q: "Refunds?",
      a: "Full refund available within 30 days via Stripe, no conditions.",
    },
  ],
  legalHeading: "Terms and privacy",
  legal: [
    "FlareMo is Apache-2.0 open source; Hosted terms of service will be published separately when Phase 2 ships.",
    "Hosted collects only the minimum data needed (account, email, memo metadata). Encrypted backups of note bodies are optional.",
    "FlareMo will not read or index your notes for training or analytics.",
  ],
};

export function getPricingTiers(locale: Locale): PricingTier[] {
  return locale === "zh-CN" ? TIERS_ZH : TIERS_EN;
}

export function getPricingPage(locale: Locale): PricingPage {
  return locale === "zh-CN" ? ZH_PRICING_PAGE : EN_PRICING_PAGE;
}
