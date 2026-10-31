# FlareMo Agent 指南

这份文件给 Codex、Claude Code、Cursor Agent 等自动化编码工具使用。目标是让 Agent 能稳定理解、修改、验证和部署 FlareMo。

## 项目定位

FlareMo 是一个 Cloudflare 原生的个人知识管理系统：

- 前端和 API 运行在 Cloudflare Workers。
- D1 是笔记、用户、关系、分享、设置和附件元数据的事实源。
- R2 只存附件、导出包和对象文件。
- `/api/v1/*` 提供 Memos 兼容 API 子集。
- 应用层使用 Better Auth：浏览器使用 HttpOnly cookie session，脚本、Memos-compatible 客户端和 MCP 使用可撤销的 `memos_pat_` Personal Access Token。
- Cloudflare Access 是可选的外层防线和迁移期防线；启用时，客户端仍必须通过 Access policy，并在应用层提供 cookie session 或 `memos_pat_`。
- 当前默认是一套单用户 bootstrap；禁止公开 signup，但认证表和 `auth_user_links` 为未来多用户保留扩展边界。

不要把 FlareMo 改成 VPS、Docker、Postgres 或 Node 常驻服务，也不要另造一套绕开 Better Auth 的登录、Bearer token 或共享密码方案。

## 常用命令

```bash
pnpm install
pnpm check
pnpm test
pnpm build
pnpm backup:drill
```

`pnpm verify`（12 步全量门禁）只在维护者明确要求时运行，见下方「敏捷开发节奏」。

本地开发：

```bash
pnpm migrate:local
pnpm dev:hot   # 推荐：前端 HMR + Worker 热重载
pnpm dev       # 无热重载：先构建前端，再由 Worker 托管该产物
```

`pnpm dev:hot` 同时起 Vite（前端，默认 **5573**）和 `wrangler dev`（Worker，默认 8787），浏览器只开 **5573**：

- 改前端源码 → Vite 即时热更新（React Fast Refresh，页面状态不丢）
- 改 worker / packages 源码 → wrangler 自动重新打包，刷新即见
- API、SSR 分享页 `/share/:token`、文章页 `/article/:slug`、R2 附件 `/file/*`、`/mcp`、feed 与 sitemap 由 Vite 代理到 Worker，因此同源，cookie 与 origin 校验照常工作

端口用 `FLAREMO_DEV_WEB_PORT` / `FLAREMO_DEV_WORKER_PORT` 覆盖（第二个 checkout 或端口转发时用）。首次运行若 `apps/web/dist` 不存在会先构建一次（`wrangler dev` 要求 assets 目录存在）；该分支只跑 `vite build`，不含 `tsc`，不会因类型错误挡住 dev 启动。

改 `wrangler.jsonc` 的 `assets.run_worker_first` 时必须同步 `apps/web/vite.config.ts` 的 `server.proxy`——两者不一致会让某条路径在 dev 下走错的服务器（`apps/web/src/dev-proxy-parity.test.ts` 会失败提醒）。

dev:hot 下额外启用 **React Grab**（`apps/web/src/dev/react-grab.ts`）：悬停任意界面元素即可复制其组件名、源码行列与 CSS 选择器，粘贴给 agent 比用文字描述位置准确得多。引入点在 `main.tsx` 的 `import.meta.env.DEV` 分支，生产构建实测不含其任何代码；`pnpm dev`（Worker 托管构建产物）与部署产物同样没有它。SSR 分享页/文章页是 Worker 渲染的独立文档，不在其作用范围。初始化显式传 `telemetry: false`，不向 react-grab.com 发版本检查。

已知小限制：组件栈里的文件名只有基名（`input.tsx` 而非完整路径）——Vite dev 的 sourcemap `sources` 本身就只发布基名，拾取器只是如实转述。靠组件名 + 行列号 + CSS 选择器足以定位。

生产部署：

```bash
pnpm deploy:dry-run
pnpm deploy
```

`pnpm verify` 是 12 步全量门禁（含 e2e），**只在维护者明确要求时执行**（发版也不需要）。

只验证 Cloudflare 配置和打包：

```bash
pnpm deploy:dry-run
```

## 修改规则

- 改数据库结构时，先改 `packages/db/src/schema/` 下的对应模块（`schema.ts` 只是 barrel），再运行 `pnpm db:generate`。
- 生成的 SQL migration 必须提交到 `migrations/`。
- 自动部署会先迁移再发布 Worker；migration 必须向后兼容上一正式版本，破坏性收缩要拆到后续 release。
- 业务访问数据必须通过 Drizzle 和 domain services，不要在路由里堆散装 SQL。
- `/api/v1/*` 是兼容层；新增字段或行为时同步检查 `packages/memos` 和 OpenAPI。
- `/api/app/*` 可以服务前端体验，但必须复用同一套 domain services。
- 前端只展示已经接上后端能力的入口；不要放未实现功能的按钮、菜单或文案。
- 产品与界面改动遵循设计原则「简约不简单，克制不放肆」；视觉、动效和文案细节见 `docs/design-system.md`。
- 应用层认证边界是 Better Auth；不要新增绕开 Better Auth 的登录页、共享密码或第二套应用令牌。Cloudflare Access 可以作为可选外层防线，但不能被误当成应用用户身份映射。
- 凭据相关的 Origin 契约必须保持不变：cookie session 的状态变更请求（包括 `POST`、`PATCH`、`DELETE` 等非安全方法）必须携带并精确匹配 `FLAREMO_PUBLIC_URL` 或 `FLAREMO_TRUSTED_ORIGINS`；PAT 请求可以省略 Origin，但一旦携带也必须精确匹配同一 allowlist，否则返回 `403`。不要用 wildcard、`Referer` 或 Cloudflare Access headers 替代 Origin 校验。
- 不得把 `BETTER_AUTH_SECRET`、`FLAREMO_BOOTSTRAP_SECRET`、初始密码、cookie 或 `memos_pat_` 明文写进代码、文档、migration、issue、PR、日志或聊天；生产 secret 只能通过 Wrangler secret 或 Cloudflare 控制台安全配置。
- `Temp/` 是参考仓库目录，不能提交。
- 使用 GitHub Actions 时默认只允许两类 workflow：`.github/workflows/ci.yml`（瘦 CI：format / lint / typecheck / 单元测试，兕底与外部 PR 门禁）和 `.github/workflows/flaremo-update.yml`（只服务自部署用户自己的部署仓库，同步上游 Release 并创建升级 PR）。现有 `.github/workflows/deploy-cloudflare.yml` 是自托管 fork/deployment repository 的受控例外，只响应 `workflow_dispatch`，不在 push 时部署，并且上游 `realchendahuang/FlareMo` 不运行该 job；不要把上游或常规仓库改成 push/CI 自动生产部署。不要新增其它 workflow，不跑 E2E 进 CI；全量门禁 `pnpm verify` 只在维护者明确要求时于本地执行（发版也不需要）。不重新启用 Dependabot 或 Workers Builds。
- 改路由、守卫、导航行为时必须同步补 e2e 用例（2026-09-10 事故教训：v0.15.3 守卫重构后门禁拦不住匿名首页无限加载，因为 e2e 只覆盖了深度链接没覆盖 `/`；门禁的有效性 = 测试覆盖率）。**补用例 ≠ 主动跑**：写进仓库即可，跑不跑由维护者决定。
- 敏捷开发节奏（2026-09-16 维护者定调）：小步快跑，验证只跑与改动直接相关的定向用例（单个 Vitest 文件 / e2e spec）。**全量门禁 `pnpm verify` 只在维护者明确要求时执行——发版、部署、日常提交都不跑**。质量底线不变：改动涉及的测试必须绿、`pnpm format` 通过。

## Issue 和 PR 流程

`main` 永远代表可发布状态。

**维护者当面指派的任务直接在 `main` 上提交并 push（2026-09-17 维护者定调）。** Kim 的日常节奏是"在 main 上快速迭代"——给他做的小步功能/修复，做完 `git switch main && git pull` 后直接 commit + push，**不要开分支、不要开 PR**（2026-09-17 我给一个已完成的设置弹窗改动擅自开 PR，被当即否决："我要在 main 上面快速迭代"）。

issue -> branch -> PR 流程只用于：对外贡献者、维护者明确要求走分支/审查的大型改动、以及需要 CI 门禁的外部 PR 门禁场景。Agent 拿不准时按直接进 main 处理，拿得准要开 PR 的理由时先问一句。

操作规则：

- 开始任务前先切回最新 `main`：`git switch main && git pull --ff-only`。
- 从 `main` 创建短生命周期分支。推荐前缀：`docs/*`、`test/*`、`feat/*`、`fix/*`、`ops/*`、`codex/*`。
- 一个 PR 只处理一个 issue，或一组强相关 issue；不要把无关清理混进同一个 PR。
- PR body 必须写验证命令和 issue 关系。能完整关闭时写 `Closes #N`；只能推进上下文时写 `Refs #N`。
- 合并使用 squash merge；合并后删除远端任务分支。
- 合并后本地执行 `git switch main && git pull --ff-only`，确认 `main` 已包含合并提交。

验证强度按改动类型选择（默认只跑定向测试，不跑全量 `pnpm verify`）：

- 纯文档、拼写、链接：`pnpm format:check`。
- 部署、Wrangler、D1、R2、Access 相关文档或配置：`pnpm format:check` 和 `pnpm deploy:dry-run`。
- API、domain service、Memos 兼容、测试夹具：改动文件对应的 vitest 用例（如 `pnpm exec vitest run apps/worker/src/api/memo-crud.test.ts -t "<用例名>"`）。
- UI 改动：秒级静态检查（`tsc --noEmit` + 改动文件的 vitest）+ 开发过程中目检。
- 全量 `pnpm verify`：**只在维护者明确要求时执行**，其他任何时候（含发版）都不要跑。

**E2E 一律 opt-in（2026-09-16 维护者定调）**：Agent 任何时候都不要主动跑 Playwright e2e——开发中途不跑、收尾也不跑，即使是很小的功能也如此。只有维护者明确说"跑 e2e"时才跑。日常 UI 改动用秒级手段验收：`tsc --noEmit`、定向 vitest、`pnpm build`（几百毫秒）、必要时 `pnpm dev` 起服务目检。e2e 冷启动要分钟级（wrangler dev + 全量构建），是本次主题色开发实测出的最大时间黑洞；新写的 e2e 用例留在仓库里，等维护者要求跑或下次触碰同一 spec 时一起跑。

## 验收口径

敏捷开发期（2026-09-16 起）默认验收线：

- 改动涉及的测试必须绿：只跑该改动相关的 vitest 文件（e2e 见上：opt-in，不主动跑）。
- 提交前跑一次 `pnpm format`（很快）。
- 部署不需要先跑全量门禁：直接部署（`deploy-kosx.mjs` 默认已跳过 verify），迁移、构建和线上冒烟仍由部署脚本执行。
- 全量 `pnpm verify` 只在维护者明确要求时执行；发版脚本（`pnpm release`）默认不跑，`--verify` 可按需开启。

涉及部署、Wrangler、D1、R2 或 Access 的改动，建议跑 `pnpm deploy:dry-run`。
涉及 UI 的改动，用 `pnpm dev:hot` 目检桌面和移动端（改样式即时生效，省掉每次重建）；e2e 不主动跑（见上）。

## 文档入口

- `README.md`：项目入口和部署入口。
- **README 语言版本规则（2026-09-22 整理后定案）**：`README.md` 是唯一基准（英文），`README.zh-CN` / `.ja` / `.ko` / `.fr` / `.es` / `.ru` / `.ar` 七个翻译版是它的结构镜像（逐节 1:1，只差译文）。改主 README 时必须同步更新对应翻译版；只动某一节也要把该节同步到全部语言版。各版本专有约定：zh-CN 的文档链接指向中文文档根 `docs/`，其他语言版指向 `docs/en/`（`plugin-platform-standard.md` 无英文专版，保持根路径）；语言切换器里的链接名保持各语言原生写法，不算混排。
- `docs/tech-stack.md`：确定的技术栈。
- `docs/architecture-notes.md`：架构和兼容边界。
- `docs/deploy.md`：人类部署指南。
- `docs/agent-deploy.md`：Agent 部署 runbook。
- `docs/release.md`：发版规则。
- `docs/maintenance.md`：维护、备份和恢复。
- `docs/memos-compatibility.md`：Memos 兼容矩阵。
- `docs/import-from-memos.md`：从 Memos 0.31 导出包迁移到 FlareMo（英文版在 `docs/en/`）。
- `docs/memos-ecosystem.md`：第三方客户端、认证方式和真实兼容验证记录。
- `docs/design-system.md`：Ember 设计系统（色彩、字体、动效、组件和文案约定）。
- `docs/semantic-search.md`：语义搜索、Vectorize 和 Workers AI 的边界。
- `ROADMAP.md`：稳定方向和公开任务池。
