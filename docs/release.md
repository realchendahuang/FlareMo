# 发版规则

FlareMo 使用 Git tag 和 GitHub Release 发布版本。仓库有瘦 CI（format / lint / typecheck / 单元测试）作为 push 与外部 PR 的快速门禁，但它不跑 E2E、不做部署；发布前默认按改动执行定向检查，完整门禁仅在维护者明确要求时于本地执行。用户部署仓库中的更新 workflow 只消费这里发布的正式 Release。

## 标准流程（runbook）

仓库有瘦 CI、没有 Workers Builds 自动部署；E2E 与部署之外的完整门禁都在维护者本地跑（瘦 CI 只做 format / lint / typecheck / 单元测试的快速防线）。一次「改动 → 推送 → 测试 → 发版」按这个顺序：

1. **改动与提交**：产品改动走 feature 分支 + conventional commits（`feat(...)`、`fix(...)`、`chore(...)`）；文档等小改动可直接提交 main。推送前先 `pnpm check`（lint + typecheck）。
2. **合并与推送**：main 统一 fast-forward（`git checkout main && git merge --ff-only <branch> && git push origin main`），保持线性历史。**合并依赖更新 PR 必须逐个合、每个之间先 rebase/重新解析**：并行合并两个基于同一旧 lockfile 的 PR 会把 `pnpm-lock.yaml` 写坏（duplicated key）；且 Dependabot 不遵守 `minimumReleaseAge` 供应链策略，其 lockfile 改动合并后必须用 `pnpm install` 重新解析并确认通过策略校验。
3. **测试门禁**：默认只跑与改动直接相关的定向用例（单个 Vitest 文件 / 单个 e2e spec），提交前过 `pnpm format`。全量 `pnpm verify`（13 步：持久化清单 + format:check + lint/typecheck + Vitest + 构建 + E2E）**只在维护者明确要求时执行**，发版也不需要；`pnpm release --verify` 可按需开启。**新增文件先过 `pnpm format`**（biome 会拦未格式化文件）。
4. **发版准备**：更新 `CHANGELOG.md`（新增 `## vX.Y.Z` 小节，写清升级影响、Cloudflare 资源变化、Memos 兼容面变化），统一 bump 版本号——根 package.json + 全部 `apps/*`、`packages/*` 的 package.json，外加 `packages/contracts/src/constants.ts` 的 `FLAREMO_API_VERSION`——提交 `chore(release): prepare vX.Y.Z` 并推送 main。
5. **发版**：`pnpm release vX.Y.Z`（脚本要求工作区干净且 `HEAD == origin/main`），依次执行 deploy:dry-run、打 tag、推 tag、用 CHANGELOG 小节创建 GitHub Release。全量门禁默认跳过，需要时用 `pnpm release vX.Y.Z --verify`。
6. **部署**：上游部署由维护者本地手动执行 `pnpm deploy`（自动应用远端 D1 migration；本地需 ≥32 字符的 `BETTER_AUTH_SECRET` 环境变量，CI 环境降级为警告，见 [deploy.md](./deploy.md)）。不存在 push 触发的上游自动部署；现有自托管 fork/deployment repository 可通过受控 `workflow_dispatch` 手动执行部署 workflow。

## 版本号

使用 SemVer。

- `PATCH`：bugfix、文档修正、小 UI 修正，不改变部署方式和兼容 API。
- `MINOR`：新增能力、扩大 Memos 兼容子集、非破坏性 schema 变更。
- `MAJOR`：破坏性 API、破坏性 migration、部署方式或访问边界变化。

当前 `0.x` 版本仍按这个规则发布。只要影响自托管升级，就必须写清楚。

## 发布前门禁

```bash
pnpm deploy:dry-run
pnpm backup:drill
```

全量 `pnpm verify` 仅在维护者明确要求时运行（`pnpm release vX.Y.Z --verify`）。

涉及数据库变更时，还要检查：

```bash
pnpm exec wrangler d1 migrations list DB --local
```

涉及生产部署时：

```bash
pnpm deploy
```

`pnpm deploy` 会在发布 Worker 前应用尚未执行的远端 D1 migrations。

## Release notes 必须包含

- 主要变化。
- Memos 兼容面变化。
- 数据库 migration 说明。
- Cloudflare 资源或 Access 配置变化。
- Better Auth 应用认证变化：cookie session、bootstrap、signup 状态、PAT 前缀/撤销行为，以及 `FLAREMO_PUBLIC_URL`、`FLAREMO_TRUSTED_ORIGINS` 和 Worker secrets 的配置要求。
- 升级步骤。
- 已知问题。

自动部署先执行 migration，再发布 Worker。所有 migration 必须与上一正式版本的 Worker 向后兼容；删除列、收紧约束等破坏性收缩要等新代码完成发布后，在后续 release 中单独执行。

涉及 Better Auth 的 release 还必须明确记录：

1. 先备份 D1 和 R2，并确认认证表也在备份范围内。
2. 设置公开的 `FLAREMO_PUBLIC_URL`，通过 `wrangler secret put` 配置 `BETTER_AUTH_SECRET` 和 `FLAREMO_BOOTSTRAP_SECRET`；任何 secret、密码、cookie 或 PAT 都不得进入 release notes、Git 或日志。
3. 应用认证 migration 后部署 Worker，由部署者在生产 HTTPS 的 `/setup` 页面手动完成一次性 owner 初始化，再检查 bootstrap status、用户名登录、密码修改、session 撤销、PAT 创建/撤销和公开分享。
4. 验证 cookie session 状态变更必须使用 allowlist 内的 Origin；无 Origin 或不可信 Origin 返回 `403`。同时验证无 Origin 的 PAT 请求可用，以及带不可信 Origin 的 PAT 请求返回 `403`。
5. 第一轮发布保留 Cloudflare Access。Access 是可选外层，不得把 Access Service Token 单独当成 FlareMo 应用身份。
6. 如果 release 声称扩大 Memos 兼容面，必须同时提供真实客户端证据；仓库 contract/generated-client tests 证明的是 current camelCase REST、social 与 UserService webhook/notification 资源子集、四类 memo 事件的 D1 outbox 投递/重试、Better Auth-backed auth facade、PAT 资源、Connect JSON/protobuf/gRPC-Web unary 子集和 `/mcp` 无状态 MCP 子集，不等于完整 Memos Server parity、完整上游 webhook 事件/egress 语义、完整多用户 ACL、原生 JWT parity 或第三方客户端已验证。

## 发版命令

确认版本号后运行：

```bash
pnpm release vX.Y.Z
```

发布脚本会检查工作树、确认 `HEAD` 已经推到 `origin/main`、提取 `CHANGELOG.md` 中对应版本的 release notes、执行 `pnpm deploy:dry-run`（migration 有变化时先跑 `backup:drill`），然后创建 tag 和 GitHub Release。全量 `pnpm verify` 默认跳过，仅在明确要求时用 `--verify` 开启。

## 回滚

代码回滚：

```bash
git checkout <previous-tag>
pnpm deploy
```

D1 migration 回滚不能假设自动可逆。破坏性 migration 必须在 release notes 里写清楚备份和人工恢复方式。
