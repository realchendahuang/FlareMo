import type { HomeContent } from "../copy";

export const ZH_HOME: HomeContent = {
  heroEyebrow: "开源免费 · Cloudflare 原生 · 知识管理",
  heroTitleLine1: "不用一台服务器",
  heroTitleLine2: "会生长的 AI 第二大脑",
  heroSubtitle:
    "在 Cloudflare 边缘打开即写：记录自然长成任务、文章与可检索的知识库，也是你的 AI Agent 能通过 MCP 直接读写的记录库。",
  primaryCta: "快速开始部署",
  secondaryCta: "GitHub 源码",
  heroFacts: [
    { label: "D1 数据库", value: "5 GB", detail: "约 250 万条纯文本记录" },
    {
      label: "R2 存储",
      value: "10 GB",
      detail: "约 1 万张压缩图片 · 0 出口流量费",
    },
    { label: "全球边缘", value: "300+", detail: "个节点，就近响应" },
    { label: "部署耗时", value: "5 分钟", detail: "从克隆到上线" },
  ],
  featuresBadge: "为什么选 FlareMo",
  featuresHeading: "为专注记录与长期沉淀而生",
  featuresSubtitle: "把运维交给 Cloudflare，把注意力留给记录本身",
  features: [
    {
      title: "多区域持久化，数据稳稳落地",
      description:
        "记录存进 Cloudflare D1 与 R2，自带多地域复制。换电脑、迁移部署，记录都还在。",
    },
    {
      title: "免费额度，边界清晰",
      description:
        "Cloudflare 免费层自带 5GB D1 数据库（约 250 万条文本记录）与 10GB R2 存储（约 1 万张压缩图）。用量留在配额内时，R2 不收出口流量费。",
    },
    {
      title: "离线优先，全平台 PWA",
      description:
        "可安装为本地应用。断网或在地铁里照常写，草稿先存本地，联网后按顺序补交，一条不漏。",
    },
    {
      title: "AI 原生，直接读写你的记录",
      description:
        "内置标准 MCP 端点，Claude Desktop、Cursor、Codex 等 AI 助手可以搜索、读取和写入你的记录；不另建独立的 AI 记忆账本。",
    },
    {
      title: "团队空间，只做分享",
      description:
        "把记录发到团队，在原帖下评论、@ 彼此——用来分享，不做项目协作。Owner / Admin / Member / Reader 四种角色，私密、团队可见、公开三档可见性，成员离开时私密数据彻底清理。",
    },
    {
      title: "数据随时带走",
      description:
        "记录、任务、文章和附件，一键全量导出。导入遇到冲突可自选策略；中途出错整批撤回，不留半截数据。",
    },
    {
      title: "记录、长文与待办",
      description:
        "随手记录，长文进全屏画布。给记录定个日子，里面的待办就转成任务，两头一起变；按今天、未来 7 天或项目看板翻看，到期当天提醒，还能开启浏览器推送。",
    },
  ],
  comparisonBadge: "横向对比",
  comparisonHeading: "三种自托管方式，一张表看清",
  comparisonSubtitle:
    "对比传统家用 NAS 与 VPS，看清 Cloudflare 原生架构的实际差别",
  comparisonRows: [
    {
      label: "数据存储位置",
      cloudflare: "Cloudflare 多地域持久化存储",
      nas: "家中的单块或多块物理硬盘",
      vps: "单一云厂商机房虚拟机磁盘",
    },
    {
      label: "硬件/灾难风险",
      cloudflare: "跨地域复制，无需自己换硬盘",
      nas: "硬盘损坏、断电漏水可能全丢",
      vps: "机房网络故障或误操作可能丢失",
    },
    {
      label: "全球访问延迟",
      cloudflare: "全球 300+ 边缘 CDN 毫秒就近响应",
      nas: "依赖家庭上行，需折腾内网穿透",
      vps: "取决于单一机房物理距离，延迟高",
    },
    {
      label: "日常运维开销",
      cloudflare: "无需打系统补丁，也不跑 Docker 容器",
      nas: "需维护系统升级、监控硬盘 SMART",
      vps: "需维护操作系统安全补丁与看门狗",
    },
    {
      label: "证书与域名",
      cloudflare: "自带免费 HTTPS，自动配置与续期",
      nas: "需自行申请证书、配置 DDNS 与穿透",
      vps: "需配置 Nginx/Caddy 及证书轮换",
    },
    {
      label: "长期费用成本",
      cloudflare: "免费额度内 0 元（有明确配额）",
      nas: "数千元硬件采购费用 + 持续电费",
      vps: "按月/年持续支付服务器与带宽续费",
    },
  ],
  screenshotsHeading: "打开看看",
  screenshotsSubtitle:
    "浅色、深色与手机端，全部是上线版本的真实截图，不是效果图。",
  faqHeading: "常见问题",
  faqItems: [
    {
      q: "免费配额真的够用吗？",
      a: "按每条约 2KB 估算，5GB 大约能存 250 万条记录；具体上限取决于内容大小，日常记录很少碰到。",
    },
    {
      q: "我的数据存在哪里，安全吗？",
      a: "记录落在 Cloudflare 的全球网络里，自带多地域复制。你还能把记录、任务、文章与附件一键打包导出，随时在本地留一份完整副本。",
    },
    {
      q: "能把以前的记录搬过来吗？",
      a: "可以。仓库自带转换脚本，把旧工具的导出包转成 FlareMo 导入包，时间戳、标签、置顶与可见性都会保留。已知限制：评论会转成独立记录，外部链接附件不迁移。",
    },
    {
      q: "能接我自己的脚本和工具吗？",
      a: "可以。开放 API 配可撤销的 Personal Access Token，自动化脚本能直接接；AI 工作流走内置 `/mcp` 记录工具与 `flaremo-notes` Skill，直接读写你的 memo。具体支持范围以文档中的兼容矩阵为准。",
    },
    {
      q: "单人使用和团队使用有什么区别？",
      a: "默认是一套安静专注的单人记录系统；如果需要协同，管理员在后台发一条邀请链接就能加人。记录支持设为私密（仅自己可见）、团队可见（团队成员可阅读并评论）或全网公开，数据归谁，清清楚楚。",
    },
  ],
  ctaHeading: "灵感已就位，只差一次部署",
  ctaSubtitle:
    "无需服务器，无需信用卡，用免费 Cloudflare 账号 5 分钟即可跑起来。",
  ctaButton: "查看部署指南",
};
