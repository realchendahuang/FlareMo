# Contributing

欢迎提交 issue 和 PR。FlareMo 是 Cloudflare 原生项目，改动要尊重当前架构边界。

## 开发

```bash
pnpm install
pnpm migrate:local
pnpm dev:hot   # 前端 HMR + Worker 热重载，浏览器开 http://localhost:5573
```

`pnpm dev:hot` 起 Vite 与 `wrangler dev` 两个进程，把 Worker 拥有的路径（API、SSR 分享页、R2 附件、feed）代理给后者，所以浏览器只访问一个源。前端跑在 **5573**（避开其他 Vite 项目的默认 5173）。该模式下还启用了 React Grab——悬停元素即可复制其组件与源码位置给 agent。想要无热重载的单进程模式仍可用 `pnpm dev`（Worker 托管前端构建产物，端口 8787）。

推荐 Node.js 22+ 和仓库声明的 pnpm 版本：

```bash
corepack enable
pnpm install
```

## 提交前

```bash
pnpm format:check
```

默认只跑与改动直接相关的测试（对应的 Vitest 文件或 e2e spec），不要求全量 `pnpm verify`。全量门禁（13 步，含 E2E 与构建）只在维护者明确要求时运行。

涉及 Cloudflare 配置、D1、R2 或部署脚本时：

```bash
pnpm deploy:dry-run
```

仓库**没有 CI**，push 与 PR 都不会自动跑检查，也没有自动部署。提交前请按改动在本地跑定向测试；维护者要求时再跑完整门禁 `pnpm verify`（含 Playwright E2E）并在 PR 里写明结果。

依赖更新目前**由人工执行**：`renovate.json` 记录了期望的升级策略（devDependencies 的 patch 可自动合并、Cloudflare 系包保持手动），但仓库没有配套的 Renovate workflow，bot 从未启用。Dependabot 已按项目决定停用且没有配置文件。看到依赖落后时，直接手工 `pnpm update <pkg>` 并跑相关测试即可，不要指望有自动升级 PR。

如需自动修复格式：

```bash
pnpm format
```

## PR 要求

- 描述用户可见变化。
- 产品与界面改动遵循设计原则「简约不简单，克制不放肆」，细节见 `docs/design-system.md`。
- 说明是否影响 D1 migration。
- 说明是否影响 Memos 兼容 API。
- 说明是否影响 Cloudflare Access、D1、R2 或部署流程。
- 附上验证命令和结果。

## 许可

- FlareMo 以 AGPL-3.0 授权。提交 issue、PR 或其他贡献即表示同意将其按 AGPL-3.0 授权给本项目与所有下游使用者。
- 贡献者同时授予项目版权持有者一项许可：可以在 AGPL-3.0 之外（含商业托管版本）使用、再授权这些贡献。
- 明确不提交的权利（如受雇作品归属）请先在 issue 中说明，再开始实现。

## 架构边界

- D1 是主数据事实源。
- R2 只存附件、导出包和对象文件。
- Memos 兼容层是 adapter，不是第二套业务实现。
- 生产访问由 Cloudflare Access 处理。
- 不新增未实现功能入口。

## Issue

Bug report 请包含：

- 版本或 commit。
- 部署方式。
- Cloudflare 资源：Workers、D1、R2、Access 是否启用。
- 复现步骤。
- 期望结果和实际结果。
- 相关日志或截图。

Memos 兼容问题请说明客户端、请求路径、请求体和返回体。

## 分支和发布

- `main` 永远代表可发布状态。
- 功能开发使用 `feat/*` 或 `codex/*` 分支。
- 每个 release 必须有 Git tag、GitHub Release、`CHANGELOG.md` 条目和升级说明。
- 维护者发布前执行 `pnpm deploy:dry-run` 和 `pnpm backup:drill`；全量 `pnpm verify` 仅在明确要求时（`pnpm release vX.Y.Z --verify`）执行。

## 社区和支持

- 支持入口见 `SUPPORT.md`。
- 安全问题见 `SECURITY.md`。
- 社区行为准则见 `CODE_OF_CONDUCT.md`。
- 第三方 Memos 客户端兼容记录见 `docs/memos-ecosystem.md`。
