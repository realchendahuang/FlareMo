# FlareMo 文档索引

按用途分组。标「历史」的是一次性设计稿/审查报告：它们记录了当时的决策过程，**不代表当前实现**；当前行为以代码、`AGENTS.md` 和最新 CHANGELOG 为准。

## 入门与产品

- [concept-model.md](./concept-model.md)：产品概念模型（记录 / 任务 / 文章 / 空间 / 团队）。
- [product-requirements.md](./product-requirements.md)：产品需求梳理（对标 flomo 的需求底稿，历史）。
- [ux-differentiation.md](./ux-differentiation.md)：UX 差异化决策稿（历史）。
- [team-mode.md](./team-mode.md)：团队模式（内容分享，不做协作）。
- [capture-note-longform-schedule.md](./capture-note-longform-schedule.md)：记录体裁：便签、长文与「安排」。

## 架构与技术

- [architecture-notes.md](./architecture-notes.md)：架构、边界与兼容约束。
- [tech-stack.md](./tech-stack.md)：确定的技术栈。
- [semantic-search.md](./semantic-search.md)：语义搜索、Vectorize 与 Workers AI 的边界。
- [vector-namespace-design.md](./vector-namespace-design.md)：向量分区（个人 / 团队）。
- [plugin-platform-standard.md](./plugin-platform-standard.md)：插件平台规范（分享卡片模板）。
- [plugins.md](./plugins.md)：插件目录结构、构建与发布。
- [agent-ingestion.md](./agent-ingestion.md)：Agent 与 IM 渠道写入。
- [seo-share-pages-best-practices.md](./seo-share-pages-best-practices.md)：公开分享页/文章页 SEO 与 SSR。

## 部署与运维

- [deploy.md](./deploy.md)：人类部署指南（含一键部署与 Workers Builds）。
- [agent-deploy.md](./agent-deploy.md)：Agent 部署 runbook。
- [github-action-deploy.md](./github-action-deploy.md)：自托管部署仓库的 GitHub Action 部署。
- [update.md](./update.md)：升级已有实例。
- [release.md](./release.md)：发版规则与本地门禁。
- [maintenance.md](./maintenance.md)：维护、备份与恢复演练。
- [templates/workflows/](./templates/workflows/)：自托管部署/更新 workflow 模板（复制到部署仓库的 `.github/workflows/`）。

## 兼容与迁移

- [memos-compatibility.md](./memos-compatibility.md)：Memos 兼容矩阵。
- [memos-ecosystem.md](./memos-ecosystem.md)：第三方客户端与真实兼容记录。
- [import-from-memos.md](./import-from-memos.md)：从 Memos 0.31 导出包迁移。

## 界面与设计

- [design-system.md](./design-system.md)：Ember 设计系统（色彩、字体、动效、组件、文案）。
- [brand-color-theming.md](./brand-color-theming.md)：实例主题色定制。
- [liquid-glass-design.md](./liquid-glass-design.md)：Liquid Glass 材质方案。
- [assets/screenshots/v0.29.0/](./assets/screenshots/v0.29.0/)：v0.29.0 发版前目检截图（桌面 / 暗色 / RTL / 手机 / 设置）。

## 功能专项

- [voice-settings.md](./voice-settings.md)：Owner 托管的语音识别配置。
- [asr-admin-settings.md](./asr-admin-settings.md)：ASR 配置管理（历史需求与实施记录）。
- [asr-minimax.md](./asr-minimax.md)：MiniMax ASR provider 接入。
- [voice-capture.md](./voice-capture.md)：输入框语音输入（当前实现）。
- [quality-backlog.md](./quality-backlog.md)：稳健性修复台账与审计记录（新审计沿用其格式）。

## 历史设计稿与审查报告

这些文档保留决策过程，不再维护为当前状态：

- [article-publishing-design.md](./article-publishing-design.md)
- [audio-compression-research.md](./audio-compression-research.md)
- [base-ui-migration.md](./base-ui-migration.md)
- [cf-usage-ui-config.md](./cf-usage-ui-config.md)
- [composer-editor-wysiwyg.md](./composer-editor-wysiwyg.md)
- [composer-wysiwyg-closing.md](./composer-wysiwyg-closing.md)
- [composer-fullscreen-article-design.md](./composer-fullscreen-article-design.md)
- [content-authority.md](./content-authority.md)
- [design-principle-rollout.md](./design-principle-rollout.md)
- [flomo-alignment-ux-refinement.md](./flomo-alignment-ux-refinement.md)
- [image-compression-design.md](./image-compression-design.md)
- [projects-tasks-audit.md](./projects-tasks-audit.md)
- [tag-system-audit.md](./tag-system-audit.md)
- [time-task-mental-model-audit.md](./time-task-mental-model-audit.md)
- [team-space-ux.md](./team-space-ux.md)
- [voice-capture-design.md](./voice-capture-design.md)
- [voice-capture-rollout.md](./voice-capture-rollout.md)

## 其他

- `docs/en/`：上述文档的英文子集（部署、更新、兼容、迁移等）。
- `AGENTS.md`（仓库根）：Agent 修改规则、验证口径与部署约定。
- `CHANGELOG.md`：每个 release 的升级影响与行为变化。
- [ROADMAP.md](../ROADMAP.md)：稳定方向与公开任务池。
