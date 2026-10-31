import type { HomeContent } from "../copy";

export const ZH_HOME: HomeContent = {
  heroEyebrow: "开源免费 · Cloudflare 边缘原生 · Memos 生态兼容",
  heroTitleLine1: "零服务器，永久拥有",
  heroTitleLine2: "跑在边缘网络的第二大脑",
  heroSubtitle:
    "简约，不简单；克制，不放肆。基于 Cloudflare 边缘网络（Workers + D1 + R2）原生构建的知识库：无需 VPS、免运维，完整兼容 Memos 生态，还能作为 AI Agent 的长期记忆。灵感随手记下，永久沉淀。",
  primaryCta: "快速开始部署",
  secondaryCta: "GitHub 源码",
  statMemos: "约 250 万条纯文本记录",
  statPhotos: "1 万张图片 · 0 出口流量费",
  statServers: "全球 300+ 边缘近场直连",
  statUptime: "企业级多副本 · 本地自由归档",
  featuresBadge: "为什么是 FlareMo",
  featuresHeading: "为专注记录与长期沉淀而生",
  featuresSubtitle: "把运维交给 Cloudflare，把注意力留给记录本身",
  features: [
    {
      title: "多区域持久化，数据稳稳落地",
      description:
        "记录存储于 Cloudflare D1 分布式数据库与 R2 存储桶，自带跨地域冗余容灾。无需担心硬盘坏道、停电或单点损坏。",
    },
    {
      title: "免费额度，明码实价",
      description:
        "Cloudflare 免费层自带 5GB D1 数据库与 10GB R2 存储，且 R2 不收出口流量费——记得再多，也没有一张账单。",
    },
    {
      title: "离线优先，全平台 PWA",
      description:
        "深度支持 PWA 原生安装。在飞行模式或地铁弱网下照常书写，草稿本地秒级暂存，重新联网后自动按序安全提交。",
    },
    {
      title: "AI 原生，跨会话长期记忆",
      description:
        "内置标准化 MCP（Model Context Protocol）端点，Claude Desktop、Cursor、Codex 等 AI 助手可将知识库作为长期记忆安全读写。",
    },
    {
      title: "团队空间，只做分享",
      description:
        "把便签发到团队，在原帖下评论、@ 彼此——用来分享，不做项目协作。Owner / Admin / Member 三种角色，私密、团队可见、公开三档可见性，成员离开时私密数据彻底清理。",
    },
    {
      title: "全面兼容 Memos",
      description:
        "完整实现 Memos /api/v1 核心接口与 OpenAPI 规范，支持第三方客户端直接连接，Memos 数据一键无损导入导出。",
    },
    {
      title: "便签、长文与待办",
      description:
        "便签随手记，长文进全屏画布。给便签安排一个日子，其中的待办自动成为任务并双向同步；按「今天 / 接下来 7 天」或项目看板查看，到期当天提醒，支持可选的浏览器推送。",
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
      a: "完全够用。Cloudflare 免费层提供 5GB D1 数据库（可存约 250 万条普通文本记录）与 10GB R2 存储（约 1 万张压缩图片）。即使每天写 100 条记录，也能写 68 年，对绝大部分用户而言终生都难以触及上限。",
    },
    {
      q: "如何确保我的数据绝对安全？",
      a: "记录保存在 Cloudflare 企业级分布式基础设施中，自带跨地域冗余持久化，不会因单点硬件故障丢失。同时 FlareMo 支持一键导出标准 Memos 格式备份包，随时可本地离线归档形成双重保障。",
    },
    {
      q: "能从 Memos 搬家过来吗？",
      a: "可以。FlareMo 支持导入 Memos 导出的 ZIP 或 JSON 格式数据包，导入时可自由配置冲突策略，时间戳、标签与正文完整保留。",
    },
    {
      q: "现有的第三方 App 和自动化脚本还能用吗？",
      a: "完全兼容。FlareMo 实现了 Memos 核心的 /api/v1 接口子集与可撤销的 Personal Access Token（PAT），市面上主流的 Memos 客户端（如 Moe Memos）及快捷指令脚本均可无缝连接使用。",
    },
    {
      q: "单人使用和团队使用有什么区别？",
      a: "默认是一套安静专注的单人记录系统；如果需要协同，管理员可在后台一键生成邀请激活链接添加成员。记录支持设为私密（仅自己可见）、团队可见（成员只读）或全网公开，数据权属清晰明确。",
    },
  ],
  ctaBadge: "开始上手",
  ctaHeading: "灵感已就位，只差一次部署",
  ctaSubtitle:
    "无需服务器，无需信用卡，用免费 Cloudflare 账号 5 分钟即可跑起来。",
  ctaButton: "查看部署指南",
};
