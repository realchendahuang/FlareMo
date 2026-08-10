# 维护手册

这份文档记录自托管 FlareMo 的日常维护方式。

## 质量门禁

提交和发布前执行：

```bash
pnpm format:check
pnpm verify
pnpm deploy:dry-run
```

`pnpm format:check` 会执行 Biome 格式和 lint 检查，不修改文件。自动修复格式使用：

```bash
pnpm format
```

`pnpm verify` 会执行：

- TypeScript check
- Vitest
- production build
- Playwright E2E

`pnpm deploy:dry-run` 会构建前端并让 Wrangler 验证 Worker、Assets、D1、R2 和变量绑定。

## 自动生产部署

官方生产 Worker `flaremo` 已连接 GitHub 仓库 `realchendahuang/FlareMo`：

- Production branch：`main`
- Build command：`pnpm run build`
- Production deploy command：`pnpm run deploy`
- Non-production deploy command：`npx wrangler versions upload`

PR 分支只生成 preview version，不执行远端 D1 migration。PR 合并到 `main` 后，Cloudflare Workers Builds 会自动执行构建、远端 migration 和生产发布。不要把 non-production deploy command 改成 `pnpm run deploy`。

## 数据库迁移

本地：

```bash
pnpm migrate:local
```

远端：

```bash
pnpm migrate:remote
```

改 schema 时：

```bash
pnpm db:generate
pnpm verify
```

生成的 SQL migration 必须提交。

`v0.2.0` 起 Worker 每天 `03:17 UTC` 运行附件清理任务：删除超过 24 小时仍未绑定 memo 的对象，以及处于 `deleting` 状态的重试项。手动验证 scheduled handler：

```bash
pnpm dev:worker -- --test-scheduled
curl http://127.0.0.1:8787/__scheduled
```

清理只处理 D1 已记录的附件元数据，不扫描或删除未知 R2 key。

## 应用内数据迁移导出

除管理员灾备（见下节「备份」）外，FlareMo 还提供**应用内用户导出**，用于把数据迁移到另一套 FlareMo 或人工归档：

- 小型数据走内联 `GET /api/v1/export`（≤32 MiB，含附件 base64），前端导出按钮直接下载 JSON。
- 超过内联上限时前端自动改用**导出任务**：`POST /api/v1/export/tasks` 创建任务，分页读取 D1 并把数据按类型写成 R2 下的 NDJSON 分块（`exports/<task-id>/data/*.ndjson`），最后生成自包含 `manifest.json`（记录每类数据块、附件清单及逻辑附件 ID）。
- 任务状态通过 `GET /api/v1/export/tasks/:id` 查询；manifest 经 `GET .../manifest` 下载；附件经 `GET .../attachments/:attachmentId` 流式下载（不暴露裸 R2 key）。
- 导入走 `POST /api/v1/import/tasks`（请求内执行并记录结果），`data_tasks` 表记录 `queued/running/succeeded/failed` 全生命周期。每日 cron 兜底把 lease 过期的 stale 任务标记为失败，并清理超过 7 天的任务行与对应 R2 导出产物。

`data_tasks` 是业务数据，会包含在你的 D1 备份中；导出产物本身在 R2 的 `exports/` 前缀下，随任务行过期后由 cron 清理。

## 备份

FlareMo 的主数据在 D1，附件在 R2。备份必须同时覆盖两者。

D1 备份建议使用 Cloudflare dashboard 或 Wrangler 导出能力生成 SQL dump，并把 dump 存到可信位置。`memos_fts` 是可由 `memos` 重建的 FTS5 虚拟索引；Wrangler 不支持整库导出包含虚拟表的数据库，因此导出时只选择下面的持久业务表，不导出 FTS shadow tables：

认证表也属于 D1 的持久业务数据。它们包含 session、账户关联和 PAT 的敏感校验数据，备份文件必须按生产数据同等敏感级别保存；不要把导出文件上传到 issue、聊天或公开 artifact。

```bash
pnpm exec wrangler d1 export DB --remote \
  --table users \
  --table auth_users \
  --table auth_accounts \
  --table auth_sessions \
  --table auth_verifications \
  --table auth_apikeys \
  --table auth_user_links \
  --table auth_bootstrap \
  --table memos \
  --table attachments \
  --table memo_relations \
  --table settings \
  --table shares \
  --table memo_tags \
  --table memo_revisions \
  --output ./backups/flaremo.sql \
  --skip-confirmation
```

当前 `pnpm backup:drill` 和远端恢复脚本已经把这些认证表纳入自动化导出、恢复和计数校验；仍需在每次认证 schema 变更后重新演练，不要把旧的 backup drill 结果当成新的认证数据恢复证明。

R2 备份建议使用 S3 兼容工具同步 bucket：

```bash
rclone sync flaremo-r2:flaremo-attachments ./backups/flaremo-attachments
```

不要只备份 D1。附件二进制不在 D1 里。

## 恢复

恢复顺序：

1. 创建新的 D1 database 和 R2 bucket。
2. 对新的 D1 database 执行 FlareMo migrations。
3. 先恢复 `users`，再恢复 `auth_users`，然后按外键依赖恢复 `auth_accounts`、`auth_sessions`、`auth_verifications`、`auth_apikeys`、`auth_user_links` 和 `auth_bootstrap`，最后恢复 memo、附件、关系、分享、设置等业务表。`pnpm backup:drill` 会生成按外键依赖排序的数据恢复文件，可作为恢复流程参考；插入 `memos` 时 migration 创建的 trigger 会重建 `memos_fts`。
4. 恢复 R2 对象。
5. 更新 `wrangler.jsonc` 的 D1 `database_id` 和 R2 bucket name。
6. 配置相同或有意轮换的 `BETTER_AUTH_SECRET`，并重新配置 `FLAREMO_BOOTSTRAP_SECRET`；不要把 secret 写入恢复 SQL 或仓库。
7. 执行 `pnpm deploy:dry-run`。
8. 执行 `pnpm deploy`。
9. 检查 Better Auth bootstrap 状态、cookie session、PAT、PAT revoke 和公开分享；如果保留 Access，再检查 Access policy 和公开分享 bypass policy。

D1 migration 不等于备份。破坏性 migration 发布前必须先做 D1 dump。

## 备份恢复演练

本地演练命令：

```bash
pnpm backup:drill
```

它会导出本地 D1 持久业务表（跳过可重建的 FTS5 虚拟索引）、生成按表依赖排序的数据恢复文件、用 migrations 在隔离目录创建恢复 schema、导入数据、验证业务表与重建后的 FTS 索引、检查远端 migration 状态、确认 `flaremo-attachments` R2 bucket 存在，并在 `backups/` 下生成演练报告。`backups/` 是本地输出目录，不提交到 Git。

真实 Cloudflare 资源演练需要先创建临时 D1 和 R2，并明确传入目标，脚本不会猜测或覆盖生产绑定：

```bash
export FLAREMO_RESTORE_DATABASE="flaremo-restore-drill-YYYYMMDD"
export FLAREMO_RESTORE_DATABASE_ID="<temporary-d1-id>"
export FLAREMO_RESTORE_BUCKET="flaremo-restore-drill-YYYYMMDD"
pnpm backup:drill:remote
```

远端演练会导出生产 D1 持久数据，对临时 D1 应用 migrations，按依赖顺序恢复数据，比较所有业务表和 FTS 计数，并按 D1 中仍有效的 `r2_key` 逐个复制、下载和校验 R2 对象。最后脚本生成指向临时 D1/R2 的 Wrangler 配置并执行 deploy dry-run，但不会部署，也不会修改 `wrangler.jsonc`。

认证表恢复演练必须额外确认：bootstrap 状态仍为 `complete`、既有 owner 映射存在、session/PAT 的敏感值没有出现在报告中，并在必要时主动撤销旧 session/PAT。认证数据不能只按普通 memo 行计数。

脚本故意不自动删除目标资源。检查 `backups/remote-restore-*/report.md` 后，使用明确名称删除：

```bash
pnpm exec wrangler d1 delete "$FLAREMO_RESTORE_DATABASE"
pnpm exec wrangler r2 bucket delete "$FLAREMO_RESTORE_BUCKET"
```

如果生产 D1 当前没有有效附件记录，R2 复制计数为 0 是正确结果；演练仍会验证源 bucket、目标 bucket 和恢复后的 attachment 元数据计数。不要扫描或复制 D1 未引用的未知对象。

最近一次真实演练：2026-07-23。生产 D1 的 1 个用户、2 条 memo 和对应 FTS 行被恢复到临时 D1，源/目标业务表计数完全一致；生产当时没有有效 attachment，因此 R2 引用对象复制数为 0。指向临时 D1/R2 的 deploy dry-run 成功，随后临时资源被显式删除。

## 线上排障

查看 Worker 日志：

```bash
pnpm exec wrangler tail
```

检查 D1 migrations：

```bash
pnpm exec wrangler d1 migrations list DB --remote
```

检查 R2 bucket：

```bash
pnpm exec wrangler r2 bucket list
```

生产实例如果启用了 Cloudflare Access，未带 Access Service Token 的脚本请求被拦截是预期行为。

即使 Access Service Token 通过，未带 Better Auth cookie session 或 `memos_pat_` PAT 的私有业务请求仍应返回应用层 `401`。排障时先区分外层 Access 状态和 Worker 原生认证状态，不要把 Access 通过误判为应用登录成功。
