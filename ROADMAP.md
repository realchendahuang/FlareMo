# Roadmap

这份路线图只记录 FlareMo 的稳定方向，不写过程日志。具体任务放 GitHub Issues。

## 产品主线

- 快速记录：打开即写、低干扰输入、可靠草稿。
- 安静时间线：搜索、标签、归档、回收站、活动热力图。
- Memos 兼容：核心 `/api/v1` 子集稳定，导入导出可靠。
- Cloudflare 原生部署：一键部署、D1/R2 自动 provision、Access 保护、可审查的升级 PR、Agent runbook。
- 个人知识管理：引用关系、附件、公开分享、语义检索和 AI 工作流。

## 工程主线

- D1 + Drizzle 作为数据事实源。
- R2 只存对象文件。
- `/api/v1/*` 和 `/api/app/*` 复用同一套 domain services。
- 每个公开 API 都有测试。
- 每个 release 都有 tag、CHANGELOG、migration notes 和升级说明。
- 不使用 GitHub Actions 作为项目 CI 或生产部署器；维护者发布前本地跑 `pnpm verify` 和 `pnpm deploy:dry-run`。用户部署仓库只用受限 workflow 准备上游升级 PR。

## 公开任务池

- 扩大真实 Memos 客户端兼容矩阵，并补每个已验证客户端的配置示例。
- 增加语义搜索：按 `docs/semantic-search.md` 实现；D1 仍是事实源，Vectorize 只存派生索引。
- 增加 AI 回顾：Workers AI 或外部模型只做派生能力。
- 为超过内联上限的大型导入导出增加异步对象包和校验清单。
- 增加附件生命周期观测面：清理计数、缺失对象报告和可控重试。
- 扩大浏览器 E2E：Markdown、历史恢复、反向链接、分享撤销和附件预览。

## 不做

- 不复制 Memos Go server。
- 不做 VPS / Docker / Postgres 部署主路径。
- 不把 KV、R2、Vectorize 当主数据库。
- 不在应用里重造实例级 Bearer token 登录。
- 不把未实现功能放进前端入口。
