/*
 * Docs source registry. Imports every docs/*.md and docs/en/*.md file at build
 * time so prerender can statically render /docs/<slug> for every locale.
 *
 * Adding a new doc: drop the .md file under docs/ (or docs/en/) and add an
 * entry below. The slug is the locale-prefixed filename without extension.
 */

import agentDeploy from "../../../../docs/agent-deploy.md?raw";
import agentIngestion from "../../../../docs/agent-ingestion.md?raw";
import agentMemory from "../../../../docs/agent-memory.md?raw";
import architectureNotes from "../../../../docs/architecture-notes.md?raw";
import deploy from "../../../../docs/deploy.md?raw";
import deployButtonTest from "../../../../docs/deploy-button-test.md?raw";
import designSystem from "../../../../docs/design-system.md?raw";
import enAgentDeploy from "../../../../docs/en/agent-deploy.md?raw";
import enDeploy from "../../../../docs/en/deploy.md?raw";
import enMemosCompatibility from "../../../../docs/en/memos-compatibility.md?raw";
import enUpdate from "../../../../docs/en/update.md?raw";
import maintenance from "../../../../docs/maintenance.md?raw";
import memosCompatibility from "../../../../docs/memos-compatibility.md?raw";
import memosEcosystem from "../../../../docs/memos-ecosystem.md?raw";
import productRequirements from "../../../../docs/product-requirements.md?raw";
import release from "../../../../docs/release.md?raw";
import semanticSearch from "../../../../docs/semantic-search.md?raw";
import techStack from "../../../../docs/tech-stack.md?raw";
import update from "../../../../docs/update.md?raw";

export type DocLocale = "zh-CN" | "en-US";

export type DocEntry = {
  slug: string;
  locale: DocLocale;
  title: string;
  /** Group used to render the sidebar. */
  group: DocGroup;
  /** Short one-line description (used for SEO and the directory page). */
  description: string;
  /** Raw markdown body. */
  body: string;
  /** When true, body is the Chinese source (for fallback when EN is missing). */
  fallbackFromZh?: boolean;
};

export type DocGroup =
  | "start"
  | "concept"
  | "compatibility"
  | "agent"
  | "reference";

export type DocMeta = Omit<DocEntry, "body">;

const ZH_DOCS: Record<
  string,
  { title: string; group: DocGroup; body: string; fallbackFromZh?: boolean }
> = {
  "agent-deploy": {
    title: "Agent 部署 Runbook",
    group: "agent",
    body: agentDeploy,
  },
  "agent-ingestion": {
    title: "Agent 与 IM 渠道写入",
    group: "agent",
    body: agentIngestion,
  },
  "agent-memory": {
    title: "Agent Memory：AI 长期记忆中枢",
    group: "agent",
    body: agentMemory,
  },
  "architecture-notes": {
    title: "FlareMo 架构设计",
    group: "concept",
    body: architectureNotes,
  },
  "deploy-button-test": {
    title: "Deploy Button 实测记录",
    group: "reference",
    body: deployButtonTest,
  },
  deploy: {
    title: "部署 FlareMo",
    group: "start",
    body: deploy,
  },
  "design-system": {
    title: "FlareMo 设计系统（Ember）",
    group: "concept",
    body: designSystem,
  },
  maintenance: {
    title: "维护手册",
    group: "start",
    body: maintenance,
  },
  "memos-compatibility": {
    title: "Memos 兼容矩阵",
    group: "compatibility",
    body: memosCompatibility,
  },
  "memos-ecosystem": {
    title: "Memos 生态兼容记录",
    group: "compatibility",
    body: memosEcosystem,
  },
  "product-requirements": {
    title: "产品需求梳理（对标 flomo）",
    group: "reference",
    body: productRequirements,
  },
  release: {
    title: "发版规则",
    group: "reference",
    body: release,
  },
  "semantic-search": {
    title: "语义搜索架构",
    group: "concept",
    body: semanticSearch,
  },
  "tech-stack": {
    title: "FlareMo 技术栈",
    group: "concept",
    body: techStack,
  },
  update: {
    title: "更新 FlareMo",
    group: "start",
    body: update,
  },
};

const EN_DOCS: Record<
  string,
  { title: string; group: DocGroup; body: string; fallbackFromZh?: boolean }
> = {
  deploy: {
    title: "Deploying FlareMo",
    group: "start",
    body: enDeploy,
  },
  "agent-deploy": {
    title: "Agent Deployment Runbook",
    group: "agent",
    body: enAgentDeploy,
  },
  "memos-compatibility": {
    title: "Memos Compatibility Matrix",
    group: "compatibility",
    body: enMemosCompatibility,
  },
  update: {
    title: "Updating FlareMo",
    group: "start",
    body: enUpdate,
  },
  // English fallbacks for docs that exist only in Chinese; surface a banner on
  // the page explaining the translation is pending. They are NOT exposed in
  // the English sidebar — only the 4 explicitly translated docs are.
  "agent-ingestion": {
    title: "Agent and IM Capture",
    group: "agent",
    body: agentIngestion,
    fallbackFromZh: true,
  },
  "agent-memory": {
    title: "Agent Memory",
    group: "agent",
    body: agentMemory,
    fallbackFromZh: true,
  },
  "architecture-notes": {
    title: "FlareMo Architecture",
    group: "concept",
    body: architectureNotes,
    fallbackFromZh: true,
  },
  "deploy-button-test": {
    title: "Deploy Button Smoke Test",
    group: "reference",
    body: deployButtonTest,
    fallbackFromZh: true,
  },
  "design-system": {
    title: "FlareMo Design System (Ember)",
    group: "concept",
    body: designSystem,
    fallbackFromZh: true,
  },
  maintenance: {
    title: "Maintenance",
    group: "start",
    body: maintenance,
    fallbackFromZh: true,
  },
  "memos-ecosystem": {
    title: "Memos Ecosystem Compatibility",
    group: "compatibility",
    body: memosEcosystem,
    fallbackFromZh: true,
  },
  "product-requirements": {
    title: "Product Requirements",
    group: "reference",
    body: productRequirements,
    fallbackFromZh: true,
  },
  release: {
    title: "Release Process",
    group: "reference",
    body: release,
    fallbackFromZh: true,
  },
  "semantic-search": {
    title: "Semantic Search Architecture",
    group: "concept",
    body: semanticSearch,
    fallbackFromZh: true,
  },
  "tech-stack": {
    title: "FlareMo Tech Stack",
    group: "concept",
    body: techStack,
    fallbackFromZh: true,
  },
};

const DESCRIPTIONS_ZH: Record<string, string> = {
  "agent-deploy":
    "写给 Codex / Claude Code / Cursor Agent 等可执行命令的 Agent 用的部署 runbook。",
  "agent-ingestion":
    "让 Agent、Telegram、IM 渠道直接写入 FlareMo 的设计、字段与冲突策略。",
  "agent-memory":
    "AI 跨 session 长期记忆：六工具、权限层级、与 memo 的双向连接。",
  "architecture-notes":
    "事实源、兼容层、认证边界、Worker 与 D1 / R2 / Vectorize 的职责划分。",
  "deploy-button-test": "Deploy Button 真实部署的步骤记录与已知边界。",
  deploy: "一键部署按钮、Agent 部署、手动部署三种路径，以及预部署清单。",
  "design-system":
    "Ember 设计语言：暖调中性 + 火焰品牌色，圆角、阴影与文案规则。",
  maintenance: "运维手册：备份、灾备演练、迁移、回滚。",
  "memos-compatibility": "/api/v1 子集与四类 memo 事件的 webhook outbox 边界。",
  "memos-ecosystem": "已验证的 Memos 第三方客户端与配置示例。",
  "product-requirements": "对标 flomo 的需求池与依赖关系，决策输入而非承诺。",
  release: "发版流程：tag、CHANGELOG、migration notes、升级说明。",
  "semantic-search":
    "Vectorize 存派生 embedding，D1 仍是事实源；命中回 D1 校验 ACL。",
  "tech-stack": "已确定的技术栈与版本约束。",
  update: "升级 FlareMo：上游同步 workflow、PR 流程、回退。",
};

const DESCRIPTIONS_EN: Record<string, string> = {
  deploy:
    "Three deployment paths: Deploy Button, Agent deployment, and manual.",
  "agent-deploy":
    "Runbook for command-capable agents (Codex, Claude Code, Cursor, ...).",
  "memos-compatibility":
    "The /api/v1 subset and the four memo-event webhook outbox boundaries.",
  update: "Upgrading FlareMo: upstream sync workflow, PR flow, and rollbacks.",
  "agent-ingestion":
    "Designing Agent, Telegram, and IM capture paths and conflict policies. (Chinese source; English translation pending.)",
  "agent-memory":
    "Long-term AI memory across sessions: six tools, permission tiers, memo links. (Chinese source; English translation pending.)",
  "architecture-notes":
    "Source of truth, compatibility layer, auth boundary. (Chinese source; English translation pending.)",
  "deploy-button-test":
    "Real-world Deploy Button deployment records and known edges. (Chinese source; English translation pending.)",
  "design-system":
    "Ember design language: warm neutrals plus the flame brand color, radii, shadows, copy rules. (Chinese source; English translation pending.)",
  maintenance:
    "Operations handbook: backup, drill, and migration. (Chinese source; English translation pending.)",
  "memos-ecosystem":
    "Verified Memos third-party clients and configuration examples. (Chinese source; English translation pending.)",
  "product-requirements":
    "Flomo-aligned requirement pool and dependencies. (Chinese source; English translation pending.)",
  release:
    "Release flow: tag, CHANGELOG, migration notes, upgrade instructions. (Chinese source; English translation pending.)",
  "semantic-search":
    "Vectorize holds derived embeddings; D1 is the source of truth. (Chinese source; English translation pending.)",
  "tech-stack":
    "Confirmed tech stack and version constraints. (Chinese source; English translation pending.)",
};

export function listDocs(locale: DocLocale): DocMeta[] {
  const source = locale === "zh-CN" ? ZH_DOCS : EN_DOCS;
  return Object.entries(source)
    .filter(([, doc]) => (locale === "zh-CN" ? true : !doc.fallbackFromZh))
    .map(([slug, doc]) => ({
      slug,
      locale,
      title: doc.title,
      group: doc.group,
      description:
        (locale === "zh-CN" ? DESCRIPTIONS_ZH : DESCRIPTIONS_EN)[slug] ?? "",
    }));
}

export function getDoc(slug: string, locale: DocLocale): DocEntry | null {
  const source = locale === "zh-CN" ? ZH_DOCS : EN_DOCS;
  const doc = source[slug];
  if (!doc) return null;
  return {
    slug,
    locale,
    title: doc.title,
    group: doc.group,
    description:
      (locale === "zh-CN" ? DESCRIPTIONS_ZH : DESCRIPTIONS_EN)[slug] ?? "",
    body: doc.body,
    fallbackFromZh: doc.fallbackFromZh,
  };
}

export function listAllSlugs(): Array<{ slug: string; locale: DocLocale }> {
  return [
    ...Object.keys(ZH_DOCS).map((slug) => ({ slug, locale: "zh-CN" as const })),
    ...Object.keys(EN_DOCS)
      .filter((slug) => !EN_DOCS[slug].fallbackFromZh)
      .map((slug) => ({ slug, locale: "en-US" as const })),
  ];
}
