import type { HomeContent } from "../copy";

export const ZH_HOME: HomeContent = {
  heroEyebrow: "开源免费 · Cloudflare 原生 · 知识管理",
  heroTitleLine1: "零服务器，永久拥有",
  heroTitleLine2: "会生长的 AI 第二大脑",
  heroSubtitle:
    "简约，不简单；克制，不放肆。打开即写，记录在 Cloudflare 边缘自然长成任务、文章与知识库，也是你所有 AI Agent 共享的长期记忆。",
  primaryCta: "快速开始部署",
  secondaryCta: "GitHub 源码",
  statMemos: "约 250 万条纯文本记录",
  statPhotos: "约 1 万张压缩图片 · 0 出口流量费",
  statServers: "全球 300+ 边缘近场直连",
  statUptime: "企业级多副本 · 本地自由归档",
  featuresBadge: "为什么选 FlareMo",
  featuresHeading: "为专注记录与长期沉淀而生",
  featuresSubtitle: "把运维交给 Cloudflare，把注意力留给记录本身",
  features: [
    {
      title: "多区域持久化，数据稳稳落地",
      description:
        "记录存进 Cloudflare D1 与 R2，自带多地域容灾。不怕硬盘坏道，不怕机房断电，也没有单点故障。",
    },
    {
      title: "免费额度，明码实价",
      description:
        "Cloudflare 免费层自带 5GB D1 数据库与 10GB R2 存储，且 R2 不收出口流量费——记得再多，也没有一张账单。",
    },
    {
      title: "离线优先，全平台 PWA",
      description:
        "可安装为本地应用。断网或在地铁里照常写，草稿先存本地，联网后按顺序补交，一条不漏。",
    },
    {
      title: "AI 原生，跨会话长期记忆",
      description:
        "内置标准 MCP 端点，Claude Desktop、Cursor、Codex 等 AI 助手可把这套知识库当作长期记忆，随时读写。",
    },
    {
      title: "团队空间，只做分享",
      description:
        "把便签发到团队，在原帖下评论、@ 彼此——用来分享，不做项目协作。Owner / Admin / Member / Reader 四种角色，私密、团队可见、公开三档可见性，成员离开时私密数据彻底清理。",
    },
    {
      title: "数据随时带走",
      description:
        "记录、任务、文章和附件，一键全量导出。导入遇到冲突可自选策略；中途出错整批撤回，不留半截数据。",
    },
    {
      title: "便签、长文与待办",
      description:
        "便签随手记，长文进全屏画布。给便签定个日子，里面的待办就转成任务，两头一起变；按今天、未来 7 天或项目看板翻看，到期当天提醒，还能开启浏览器推送。",
    },
  ],
  comparisonBadge: "横向对比",
  comparisonHeading: "三种自托管方式，一张表看清",
  comparisonSubtitle:
    "对比传统家用 NAS 与 VPS，看清 Cloudflare 原生架构的实际差别",
  comparisonRows: [
    {
      label: "数据存储位置",
      cloudflare: "Cloudflare 企业级多地域持久化",
      nas: "家中的单块或多块物理硬盘",
      vps: "单一云厂商机房虚拟机磁盘",
    },
    {
      label: "硬件/灾难风险",
      cloudflare: "自动故障转移，零硬件焦虑",
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
      cloudflare: "零运维：无系统补丁、无 Docker 容器",
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
      cloudflare: "0 元 / 永久利用官方免费配额",
      nas: "数千元硬件采购费用 + 持续电费",
      vps: "按月/年持续支付服务器与带宽续费",
    },
  ],
  screenshotsHeading: "精致视觉，开箱即用",
  screenshotsSubtitle:
    "浅色明亮、深色沉浸与全功能移动端自适应，所有功能真实可用",
  faqBadge: "你可能想问",
  faqHeading: "常见问题",
  faqItems: [
    {
      q: "免费配额真的够用吗？",
      a: "完全够用。Cloudflare 免费层给足 5GB D1 数据库（约 250 万条文本）与 10GB R2 存储（约 1 万张压缩图）。哪怕每天写 100 条，也能写 68 年，大多数人一辈子都碰不到上限。",
    },
    {
      q: "我的数据存在哪里，安全吗？",
      a: "记录落在 Cloudflare 的全球网络里，自带跨地域备份。你还能把记录、任务、文章与附件一键打包导出，随时在本地留一份完整副本。",
    },
    {
      q: "能把以前的笔记搬过来吗？",
      a: "可以。仓库自带转换脚本，把旧工具的导出包转成 FlareMo 导入包，时间戳、标签、置顶与可见性都会保留。已知限制：评论会转成独立记录，外部链接附件不迁移。",
    },
    {
      q: "能接我自己的脚本和工具吗？",
      a: "可以。开放 API 配可撤销的 Personal Access Token，自动化脚本能直接接；AI 工作流走内置 CLI 与 MCP 端点，读写同一份 Agent Memory。具体支持范围以文档中的兼容矩阵为准。",
    },
    {
      q: "单人使用和团队使用有什么区别？",
      a: "默认是一套安静专注的单人记录系统；如果需要协同，管理员在后台发一条邀请链接就能加人。记录支持设为私密（仅自己可见）、团队可见（团队成员可阅读并评论）或全网公开，数据归谁，清清楚楚。",
    },
  ],
  ctaBadge: "开始上手",
  ctaHeading: "灵感已就位，只差一次部署",
  ctaSubtitle:
    "无需服务器，无需信用卡，用免费 Cloudflare 账号 5 分钟即可跑起来。",
  ctaButton: "查看部署指南",
};
