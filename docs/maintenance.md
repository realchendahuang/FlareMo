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

## 备份

FlareMo 的主数据在 D1，附件在 R2。备份必须同时覆盖两者。

D1 备份建议使用 Cloudflare dashboard 或 Wrangler 导出能力生成 SQL dump，并把 dump 存到可信位置。`memos_fts` 是可由 `memos` 重建的 FTS5 虚拟索引；Wrangler 不支持整库导出包含虚拟表的数据库，因此导出时只选择下面的持久业务表，不导出 FTS shadow tables：

```bash
pnpm exec wrangler d1 export DB --remote \
  --table users \
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

R2 备份建议使用 S3 兼容工具同步 bucket：

```bash
rclone sync flaremo-r2:flaremo-attachments ./backups/flaremo-attachments
```

不要只备份 D1。附件二进制不在 D1 里。

## 恢复

恢复顺序：

1. 创建新的 D1 database 和 R2 bucket。
2. 对新的 D1 database 执行 FlareMo migrations。
3. 恢复 D1 数据。`pnpm backup:drill` 会生成按外键依赖排序的数据恢复文件，可作为恢复流程参考；插入 `memos` 时 migration 创建的 trigger 会重建 `memos_fts`。
4. 恢复 R2 对象。
5. 更新 `wrangler.jsonc` 的 D1 `database_id` 和 R2 bucket name。
6. 执行 `pnpm deploy:dry-run`。
7. 执行 `pnpm deploy`。
8. 检查 Access policy 和公开分享 bypass policy。

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
