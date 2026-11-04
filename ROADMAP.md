# Roadmap

这份路线图只记录 FlareMo 的稳定方向，不写过程日志。具体任务放 GitHub Issues。

## 产品主线

- 设计原则：简约不简单，克制不放肆——不为了炫技加装饰，也不为了省事砍掉该有的能力（视觉与交互细节见 `docs/design-system.md`）。
- AI 原生第二大脑：速记 → 任务 → 文章 → 知识库，Agent 通过 MCP 读写同一份笔记。
- 快速记录：打开即写、低干扰输入、可靠草稿。
- 安静时间线：搜索、标签、归档、回收站、活动热力图。
- 兼容层与迁移：`/api/v1` 子集维持现状，不新增 parity；导入导出与迁移脚本保持可靠。
- Cloudflare 原生部署：示例配置开箱即用、手动/Agent 部署、Access 保护、可审查的升级 PR。
- 个人知识管理：引用关系、附件、公开分享、语义检索和 AI 工作流。
- 笔记 MCP：Agent 通过 `/mcp` 搜索、读取、创建和修改用户的 memo；不设独立的 AI 记忆账本。

## 工程主线

- D1 + Drizzle 作为数据事实源。
- R2 只存对象文件。
- `/api/v1/*` 和 `/api/app/*` 复用同一套 domain services。
- 每个公开 API 都有测试。
- 每个 release 都有 tag、CHANGELOG、migration notes 和升级说明。
- 没有 CI：push 与 PR 不自动跑检查，门禁在维护者本地按改动跑定向测试，全量 `pnpm verify` 只在明确要求时执行。GitHub Actions 不在上游或 push 流程中做生产部署；自托管部署仓库的部署/更新 workflow 以 `docs/templates/workflows/` 的模板形式提供，仅通过 `workflow_dispatch` 手动部署、用受限 workflow 准备上游升级 PR。

## 公开任务池

> 需求池与对标分析见 `docs/product-requirements.md`；具体任务从该文档选定后拆解到 GitHub Issues。

- 盘清兼容层的实际支持范围并如实写进文档，不再宣称第三方客户端可用。
- 笔记 MCP 工具面：按真实客户端反馈补齐搜索、标签与批量读写，不扩张成记忆子系统。
- 回顾触达渠道：✅ 站内通知已落地（cron 幂等写入 `daily_review` 收件箱，铃铛直达 `/review/daily`）；✅ Web Push 已落地（VAPID 订阅 + 回顾推送，见 docs/deploy.md 配置小节）；AI 洞察类派生能力（Workers AI 或外部模型）仍为后续。
- 增加附件生命周期观测面：清理计数、缺失对象报告和可控重试。
- 扩大浏览器 E2E：Markdown、历史恢复、反向链接、分享撤销和附件预览。

## 不做

- 不复制任何上游实现，内核始终是自己的。
- 不做 VPS / Docker / Postgres 部署主路径。
- 不把 KV、R2、Vectorize 当主数据库。
- 不在应用里重造实例级 Bearer token 登录。
- 不把未实现功能放进前端入口。
