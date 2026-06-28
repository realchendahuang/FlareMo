# Changelog

FlareMo 使用 SemVer。每个 release 都要写清楚升级影响、Cloudflare 资源变化和 Memos 兼容面变化。

## v0.1.4

开源项目成熟度补强版本。这个版本不改变部署架构，重点是补齐公开协作、双语入口、工程门禁、Memos 生态兼容记录和 GitHub 仓库治理。

### 已包含

- 增加 `CODE_OF_CONDUCT.md`、`SUPPORT.md` 和 `CODEOWNERS`，补齐社区治理和支持入口。
- 增加 `README.en.md`、`docs/en/deploy.md`、`docs/en/agent-deploy.md` 和 `docs/en/memos-compatibility.md`，提供最小英文入口。
- 增加 `docs/memos-ecosystem.md`，公开记录 Memos 第三方客户端、脚本和 MCP 工具的兼容验证状态。
- 根目录增加 `pnpm lint`、`pnpm format`、`pnpm format:check`，并把 `pnpm format:check` 纳入 `pnpm verify`。
- Playwright E2E 扩大到创建/搜索、编辑/分享、归档/恢复、回收站/恢复/彻底删除和移动端导航。
- Playwright 本地 webServer 启动前自动执行 `pnpm migrate:local`，避免 E2E 依赖本机残留 D1 schema。
- Memos-compatible contract test 增加 OpenAPI 版本断言和公开分享附件隔离测试。
- OpenAPI 版本同步到 `0.1.4`。
- GitHub 仓库启用 main/tag rulesets、Dependabot security updates、vulnerability alerts、secret scanning 和 push protection。

### 约束

- 不新增 Cloudflare 资源。
- 不新增 D1 migration。
- 不改变 Memos 兼容 API 路径。
- 不引入 GitHub Actions。
- 生产访问边界仍是 Cloudflare Access。

### 升级说明

- 代码部署不需要额外 Cloudflare 操作。
- 自托管升级按常规流程执行 `pnpm verify`、`pnpm deploy:dry-run` 和 `pnpm deploy`。
- 如果本地 E2E 曾依赖旧的 `.wrangler` 状态，现在会在测试启动前自动应用本地 D1 migrations。

## v0.1.3

Deploy Button 文档修正版本。这个版本不改变运行时代码，只把实测得到的 Cloudflare Git provider 前置条件写进 README 和部署文档。

### 已包含

- README 的一键部署段落增加 GitHub/GitLab provider 连接说明。
- `docs/deploy.md` 增加 `Connect a Git account to continue.` 的原因说明。

### 约束

- 不新增 Cloudflare 资源。
- 不新增 D1 migration。
- 不改变 Memos 兼容 API。

### 升级说明

- 代码部署不需要额外操作。
- 如果使用 Deploy Button，需要先在 Cloudflare Dashboard 连接 GitHub 或 GitLab provider。

## v0.1.2

Deploy Button 实测记录补强版本。这个版本不改变运行时代码，只把 Cloudflare Dashboard 真实创建页的验证结果写进仓库。

### 已包含

- 更新 `docs/deploy-button-test.md`，记录 Chrome 登录态下进入 Workers `deploy-to-workers` 创建页的实际结果。
- 记录 Cloudflare 能解析 FlareMo 的项目名、D1/R2 binding、环境变量、构建命令和部署命令。
- 记录测试时如何把 D1/R2 从现有生产资源切到独立新建测试资源，避免误连生产数据。
- 记录完整部署当前被 `Connect a Git account to continue.` 挡住，需要先在 Cloudflare Dashboard 连接 GitHub/GitLab provider。

### 约束

- 不新增 Cloudflare 资源。
- 不新增 D1 migration。
- 不改变 Memos 兼容 API。
- 不静默执行 Git provider OAuth 授权。

### 升级说明

- 代码部署不需要额外操作。
- 如果要完整跑通 Deploy Button，需要先在 Cloudflare Dashboard 连接 GitHub 或 GitLab provider。

## v0.1.1

开源项目基础设施补强版本。这个版本不改变部署架构，重点是让仓库首页、验证脚本、备份演练、兼容测试和发版流程更可信。

### 已包含

- README 增加真实桌面端和移动端截图，截图由 `pnpm screenshots` 从本地 Worker 实例生成。
- 增加 `pnpm release <version>`，本地完成工作树、远端 main、tag、`pnpm verify`、`pnpm deploy:dry-run` 和 GitHub Release 检查。
- 增加 `pnpm backup:drill`，覆盖本地 D1 导出、隔离恢复、恢复后 schema 查询、远端 migration 检查和 R2 bucket 检查。
- 增加 Memos-compatible Worker contract test，覆盖 memo DTO shape、附件 export/import roundtrip 和 OpenAPI 路径。
- `POST /api/v1/import` 返回值增加 `imported_attachments`，导入结果不再只统计 memo、relation 和 share。
- README、维护文档、发版文档补齐截图、备份演练、发版脚本和兼容测试说明。

### 约束

- 项目仍不使用 GitHub Actions 作为 CI。
- D1 仍是事实源，R2 仍只保存附件、导出包和对象文件。
- Cloudflare Access 仍是生产访问边界，不增加应用内 Bearer token 登录。

### 升级说明

- 不需要新增 Cloudflare 资源。
- 不需要执行新的 D1 migration。
- 从旧版本升级代码后执行 `pnpm verify` 和 `pnpm deploy:dry-run`，确认通过后再部署。

## v0.1.0

首个公开可部署版本。这个版本把 FlareMo 收口成 Cloudflare-native、Memos-compatible 的自托管笔记系统，并补齐开源项目所需的部署、协作、Agent、发版和安全文档。

### 已包含

- Cloudflare Worker + Workers Static Assets 一体部署。
- D1 schema 和 Drizzle migrations。
- R2 附件存储。
- memo、user、attachment、relation、share、setting 基础领域服务。
- Memos 兼容 `/api/v1` 子集。
- Flomo 风格的快速记录和时间线 UI。
- 搜索、标签筛选、归档、回收站、活动热力图。
- Memos 数据导入导出。
- OpenAPI 输出。
- MCP 端点。
- 中英文界面。
- Cloudflare Access 作为生产访问边界。
- Deploy to Cloudflare 按钮。
- 人工部署文档和 Agent 部署 runbook。
- 维护、备份和恢复手册。
- Memos 兼容矩阵。
- 发版规则、贡献指南、安全策略、issue template 和 PR template。
- `pnpm verify`、`pnpm migrate:local`、`pnpm migrate:remote`、`pnpm deploy:dry-run` 质量门禁。
- 本地 Vitest 配置排除 `dist`，避免构建产物重复进入测试。
- Playwright E2E 覆盖创建 memo 和标签筛选主路径。

### 约束

- 项目不使用 GitHub Actions 作为 CI。
- 发布前由维护者在本地执行 `pnpm verify` 和 `pnpm deploy:dry-run`。
- D1 是主数据事实源；R2 只存对象文件。
- 生产访问边界由 Cloudflare Access 处理。

### 升级说明

- 生产部署前执行 `pnpm migrate:remote`。
- 生产实例建议放在 Cloudflare Access 后面。
- 脚本、Memos-compatible 客户端和 MCP 使用 Access Service Token。
