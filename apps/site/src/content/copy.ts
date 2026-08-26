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
  heroEyebrow: "Cloudflare 原生 · 个人知识管理",
  heroTitle: "一个免费 Cloudflare 账号，就能 24 小时在线的个人笔记系统",
  heroSubtitle:
    "自带数据库、对象存储、全球边缘节点。不用买服务器、不用装数据库、不用写备份脚本。",
  primaryCta: "一键部署到 Cloudflare",
  secondaryCta: "Hosted 试用（即将开放）",
  featuresHeading: "为什么 FlareMo",
  features: [
    {
      title: "D1 + R2 免费额度",
      description:
        "5 GB D1 数据库可存约 250 万条笔记，10 GB R2 对象存储可存 5,000–10,000 张图片。出口流量免费。",
    },
    {
      title: "Better Auth + Memos 兼容",
      description:
        "浏览器使用 cookie session，脚本和 Memos 客户端使用可撤销的 memos_pat_ PAT，Cloudflare Access 可作外层防线。",
    },
    {
      title: "PWA + 离线队列",
      description:
        "可安装的 PWA；草稿自动保存在本机，离线提交（含附件）排队，重新联网后按顺序提交。",
    },
    {
      title: "Agent Memory",
      description:
        "AI 长期记忆中枢。Agent 通过 /memory/mcp 读写跨 session 的长期记忆，归用户所有，可随时纠正。",
    },
    {
      title: "语义搜索与回顾",
      description:
        "Vectorize 存派生 embedding 索引，D1 仍是事实源；命中后回 D1 校验状态、可见性和分享 ACL。",
    },
    {
      title: "可撤销公开分享",
      description: "Memos 兼容格式导入导出；分享链接带 token、过期时间和状态检查。",
    },
  ],
  comparisonHeading: "为什么放在 Cloudflare 上比 NAS 更稳",
  comparisonIntro:
    "数据物理安全是被低估的成本：硬盘会坏、电源会跳、房间会漏水、被盗、搬家磕碰。云端的分布式冗余替你挡掉这些。",
  comparisonRows: [
    {
      label: "数据位置",
      cloudflare: "Cloudflare 全球企业级基础设施",
      nas: "你家里的硬盘",
      vps: "云厂商的虚拟机磁盘",
    },
    {
      label: "磁盘故障",
      cloudflare: "多副本自动冗余",
      nas: "需要 RAID，且挡不住整机/整屋故障",
      vps: "取决于厂商，多为单盘",
    },
    {
      label: "异地容灾",
      cloudflare: "开箱即用",
      nas: "需要单独搭建",
      vps: "依赖厂商策略",
    },
    {
      label: "停电 / 网络中断",
      cloudflare: "无感知",
      nas: "全停",
      vps: "依赖电源和网络",
    },
    {
      label: "全球访问速度",
      cloudflare: "边缘节点就近响应",
      nas: "需要 frp / Tailscale / 公网 IP",
      vps: "取决于机房位置",
    },
    {
      label: "HTTPS 与证书",
      cloudflare: "免费，自动续",
      nas: "需自己签 / 续",
      vps: "需自己签 / 续",
    },
    {
      label: "日常运维",
      cloudflare: "零",
      nas: "系统补丁 / 数据库升级 / 看门狗",
      vps: "系统补丁 / 数据库升级",
    },
  ],
  screenshotsHeading: "看一眼产品",
  screenshotsCaption:
    "时间线、编辑、标签筛选和移动端导航都已接上后端；未实现的能力不会出现在界面里。",
  pricingHeading: "三档定价",
  pricingSubtitle:
    "基于 Cloudflare 免费层起步。Hosted SaaS 由 Stripe 结算（Phase 2）。",
  faqHeading: "常见问题",
  faqItems: [
    {
      q: "免费额度真的够用吗？",
      a: "5 GB D1 可存约 250 万条普通笔记；10 GB R2 可存 5,000–10,000 张图片。R2 出口免费，分享图片不会产生流量账单。",
    },
    {
      q: "数据会不会丢？",
      a: "Cloudflare D1 / R2 在企业级基础设施上持久化，自带冗余。但仍建议定期用 Memos 兼容导出包备份到本机。",
    },
    {
      q: "能从 Memos / flomo 迁移吗？",
      a: "支持 Memos 格式导入导出，可选择冲突策略（覆盖 / 跳过 / 保留两侧）。",
    },
    {
      q: "Memos 第三方客户端能用吗？",
      a: "已验证若干常见客户端的兼容情况，详见 docs/memos-ecosystem.md。脚本和 MCP 使用 memos_pat_ PAT。",
    },
    {
      q: "支持 AI 回顾 / 语义搜索吗？",
      a: "语义搜索按 docs/semantic-search.md 已设计；AI 每日回顾与随机漫步已上线。Hosted 套餐默认开启语义搜索。",
    },
    {
      q: "怎么贡献 / 反馈？",
      a: "在 GitHub 仓库提 Issue 或 PR；安全相关请按 SECURITY.md 私下报告。",
    },
  ],
};

const EN_HOME: HomeContent = {
  heroEyebrow: "Cloudflare-native · Personal knowledge",
  heroTitle: "A personal note system that runs 24/7 on a free Cloudflare account",
  heroSubtitle:
    "Built-in database, object storage, and a global edge network. No server to buy, no database to install, no backup scripts to write.",
  primaryCta: "Deploy to Cloudflare",
  secondaryCta: "Hosted trial (coming soon)",
  featuresHeading: "Why FlareMo",
  features: [
    {
      title: "Generous D1 + R2 free tier",
      description:
        "5 GB D1 holds roughly 2.5M notes; 10 GB R2 holds 5,000–10,000 photos. R2 egress is free.",
    },
    {
      title: "Better Auth + Memos compatible",
      description:
        "Browser uses a cookie session; scripts and Memos clients use a revocable memos_pat_ token. Cloudflare Access can sit in front.",
    },
    {
      title: "PWA with offline queue",
      description:
        "Installable PWA; drafts save locally and offline submissions (including attachments) are queued and replayed on reconnect.",
    },
    {
      title: "Agent Memory",
      description:
        "An AI long-term memory hub. Agents read and write cross-session memory through /memory/mcp; the user owns and can correct it.",
    },
    {
      title: "Semantic search and review",
      description:
        "Vectorize stores derived embeddings; D1 remains the source of truth. Hits validate against status, visibility, and share ACL.",
    },
    {
      title: "Revocable public shares",
      description: "Memos-compatible import and export; share links carry a token, expiry, and state check.",
    },
  ],
  comparisonHeading: "Why Cloudflare is more reliable than a home NAS",
  comparisonIntro:
    "Physical safety is an underrated cost. Drives fail, breakers trip, rooms flood, get burgled, or get knocked during a move. Distributed redundancy handles all of that.",
  comparisonRows: [
    {
      label: "Where the data lives",
      cloudflare: "Cloudflare's enterprise infrastructure",
      nas: "The drive in your home",
      vps: "Your VPS provider's VM disk",
    },
    {
      label: "Disk failure",
      cloudflare: "Multi-replica, automatic",
      nas: "Needs RAID; doesn't protect the whole machine/room",
      vps: "Provider-dependent, usually single disk",
    },
    {
      label: "Off-site redundancy",
      cloudflare: "Built-in",
      nas: "You have to build it",
      vps: "Provider policy dependent",
    },
    {
      label: "Power / network outage",
      cloudflare: "Invisible",
      nas: "Total outage",
      vps: "Depends on power and network",
    },
    {
      label: "Global latency",
      cloudflare: "Edge nodes serve nearby",
      nas: "Requires frp / Tailscale / public IP",
      vps: "Tied to provider region",
    },
    {
      label: "HTTPS and certificates",
      cloudflare: "Free, auto-renewed",
      nas: "Sign and renew yourself",
      vps: "Sign and renew yourself",
    },
    {
      label: "Day-to-day ops",
      cloudflare: "None",
      nas: "Patches, DB upgrades, watchdogs",
      vps: "Patches, DB upgrades",
    },
  ],
  screenshotsHeading: "A look at the product",
  screenshotsCaption:
    "Timeline, editor, tag filter, and mobile navigation are wired to the backend. Features that aren't implemented don't show up in the UI.",
  pricingHeading: "Three tiers",
  pricingSubtitle:
    "Starts on the Cloudflare free tier. Hosted SaaS will bill through Stripe (Phase 2).",
  faqHeading: "Frequently asked",
  faqItems: [
    {
      q: "Is the free tier really enough?",
      a: "5 GB D1 stores ~2.5M plain-text notes; 10 GB R2 stores 5,000–10,000 photos. R2 egress is free.",
    },
    {
      q: "Will my data be lost?",
      a: "D1 and R2 persist on enterprise infrastructure with built-in redundancy. We still recommend periodic Memos-compatible exports.",
    },
    {
      q: "Can I migrate from Memos / flomo?",
      a: "Yes — import and export follow the Memos format with conflict strategies (overwrite / skip / keep both).",
    },
    {
      q: "Do third-party Memos clients work?",
      a: "We document verified clients in docs/memos-ecosystem.md. Scripts and MCP use the memos_pat_ token.",
    },
    {
      q: "Is semantic search / AI review supported?",
      a: "Semantic search is designed per docs/semantic-search.md; the daily review and random walk are already live. Hosted plans enable semantic search by default.",
    },
    {
      q: "How do I contribute or report?",
      a: "Open issues or PRs on the GitHub repository. Security issues should follow SECURITY.md.",
    },
  ],
};

export function getHomeContent(locale: Locale): HomeContent {
  return locale === "zh-CN" ? ZH_HOME : EN_HOME;
}