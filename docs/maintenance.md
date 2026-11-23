# 维护手册

这份文档记录自托管 FlareMo 的日常维护方式。

## 质量门禁

提交和发布前按改动选择定向检查：

```bash
pnpm format:check
```

`pnpm format:check` 会执行 Biome 格式和 lint 检查，不修改文件。自动修复格式使用：

```bash
pnpm format
```

`pnpm verify` 是 7 步全量门禁（持久化清单、全部脚本测试、format:check、lint/typecheck、Vitest、构建、Playwright E2E），步骤定义见 `scripts/preflight.mjs`。

`pnpm verify` 是完整门禁，只在维护者明确要求时运行；日常提交和发布默认不运行。涉及 Wrangler、D1、R2、Access 或部署配置的改动，再运行 `pnpm deploy:dry-run`。

`pnpm deploy:dry-run` 会构建前端并让 Wrangler 验证 Worker、Assets、D1、R2 和变量绑定。

## 生产部署

生产部署由维护者在本地手动执行；上游仓库不配置 push 或 CI 自动生产部署。自托管 fork/deployment repository 可以复制 `docs/templates/workflows/deploy-cloudflare.yml`，通过受控的 `workflow_dispatch` 手动执行，不改变上游发布策略。

```bash
pnpm run deploy
```

`pnpm run deploy` 会先跑部署 preflight，再构建前端、执行 Worker bundle dry-run，然后应用尚未执行的远端 D1 migrations，最后通过 `wrangler deploy` 发布 Worker。发布前按改动运行定向检查；需要验证 Cloudflare 打包时再运行 `pnpm deploy:dry-run`。PR 分支不触发任何自动构建或部署。

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
```

再跑与 schema 改动相关的定向单测；全量 `pnpm verify` 只在维护者明确要求时执行。

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
- 导入走 `POST /api/v1/import/tasks`（请求内执行并记录结果），`data_tasks` 表记录 `queued/running/succeeded/failed` 全生命周期。每日 cron 会把 lease 过期的 stale import 标记为失败；export 最多自动重试 3 次，未耗尽的 stale/running 任务回到 queued，随后清理超过 7 天的任务行与对应 R2 导出产物。
- 绑定 `flaremo-data-export` Queue 时，`POST /api/v1/export/tasks` 创建任务后投递 `{taskId}` 并立即返回 queued，由 queue 消费端执行导出；未绑定的部署仍在请求内执行。两条路径共用同一个幂等 executor（只认领 `queued` 行，重放安全），scheduled maintenance 同时是兜底 reconciler。
- 成员移除使用独立的 `member_removal_jobs` 表，记录操作人、阶段、尝试次数和错误；管理员重试会投递 `flaremo-member-removal` Queue，scheduled maintenance 作为未绑定 Queue 或旧环境的 fallback。迁移 0016 后应在管理员页检查失败任务并按需重试。

`data_tasks` 和 `member_removal_jobs` 都是业务数据，会包含在你的 D1 备份中；导出产物本身在 R2 的 `exports/` 前缀下，随任务行过期后由 cron 清理。Queue 消息是可重放的 job ID，恢复 D1 后应先确认 Queue 资源和 migration 状态，再允许后台清理运行。

## 备份

FlareMo 的主数据在 D1，附件在 R2。备份必须同时覆盖两者。

D1 备份建议使用 Cloudflare dashboard 或 Wrangler 导出能力生成 SQL dump，并把 dump 存到可信位置。`memos_fts` 是可由 D1 事实源重建的 FTS5 虚拟索引；Wrangler 不支持整库导出包含虚拟表的数据库，因此不能把 FTS shadow tables 当作备份目标。

认证表也属于 D1 的持久业务数据。它们包含 session、账户关联和 PAT 的敏感校验数据，备份文件必须按生产数据同等敏感级别保存；不要把导出文件上传到 issue、聊天或公开 artifact。

不要在文档或临时 shell 命令里维护第二份手写表清单。唯一清单在 [`scripts/persistence-manifest.mjs`](../scripts/persistence-manifest.mjs)：其中的 `RESTORE_TABLES` 覆盖身份、memo/SSE/webhook/通知、附件、导入导出任务、用量、项目与任务等所有 D1 事实源表；`embedding_tasks` 则属于可由事实源重建的派生工作队列。`pnpm persistence:check` 会把这份清单与 `packages/db/src/schema/` 下每个模块的每一个 `sqliteTable` 对比，少表、多表或重复分类都会失败；它也是 `pnpm verify` 的第一道门禁。

日常演练请直接使用 `pnpm backup:drill`，真实远端恢复验证使用 `pnpm backup:drill:remote`。两个脚本从同一清单生成 Wrangler 的 `--table` 参数、按依赖顺序的恢复文件和源/目标逐表计数校验。每次认证或 schema 变更后仍需重新演练，不要把旧的 drill 结果当作新的恢复证明。

R2 备份建议使用 S3 兼容工具复制 bucket。**不要用不带版本保护的裸 `rclone sync`**：它会把生产端的误删同步到备份端。

```bash
# 只新增/覆盖，不传播源端删除
rclone copy flaremo-r2:flaremo-attachments ./backups/flaremo-attachments \
  --backup-dir "./backups/flaremo-attachments-versions/$(date -u +%Y%m%dT%H%M%SZ)"

# 如果确实需要镜像删除，仍必须把被删/被覆盖对象移到版本目录
rclone sync flaremo-r2:flaremo-attachments ./backups/flaremo-attachments \
  --backup-dir "flaremo-backup-versions/$(date -u +%Y%m%dT%H%M%SZ)"
```

生产 bucket 与备份目的端都应启用版本控制；需要更强防篡改时在备份目的端启用 Object Lock。不要只备份 D1。附件二进制不在 D1 里。

## 恢复

恢复顺序：

1. 创建新的 D1 database 和 R2 bucket。
2. 对新的 D1 database 执行 FlareMo migrations。
3. 使用 `pnpm backup:drill` 生成的按依赖排序恢复文件。它先恢复 identity roots 和 Better Auth 记录，再恢复 memo/SSE/webhook/通知、附件、数据任务、用量、项目和任务等全部事实源；migration 的 trigger 会重建 `memos_fts`。
4. 恢复 R2 对象。
5. 更新 `wrangler.jsonc` 的 D1 `database_id` 和 R2 bucket name；如启用了语义搜索，必须绑定一个**新建或已明确清空**的 Vectorize index。
6. 恢复文件会清空旧的 `embedding_tasks` 状态，并为正常/归档 memo 写入新的 `reindex` 任务。部署后让 Worker 的请求 outbox 或 Cron 完成重建；不要把旧 D1 的 `indexed` 标记误当成新 Vectorize index 中真的存在向量。
7. 配置相同或有意轮换的 `BETTER_AUTH_SECRET`，并重新配置 `FLAREMO_BOOTSTRAP_SECRET`；不要把 secret 写入恢复 SQL 或仓库。
8. 执行 `pnpm deploy:dry-run`。
9. 执行 `pnpm deploy`。
10. 检查 Better Auth bootstrap 状态、cookie session、PAT、PAT revoke 和公开分享；如果保留 Access，再检查 Access policy 和公开分享 bypass policy。

D1 migration 不等于备份。破坏性 migration 发布前必须先做 D1 dump。

`pnpm backup:drill:remote` 当前验证的是“live 源数据 → 临时目标 schema/恢复兼容性”，不是“从已经落盘的 D1 dump 和 R2 备份镜像恢复”。真实灾备验收必须另做一次从备份工件恢复：把选定的 D1 dump 导入临时 D1、把 R2 备份镜像复制到临时 bucket，再按本节的恢复顺序和逐表/对象清单核对计数与 checksum。只有这项演练通过，才能把该次备份标记为可恢复。

## 备份恢复演练

本地演练命令：

```bash
pnpm backup:drill
```

它会从持久化清单导出本地 D1 事实源表（跳过可重建的 FTS5 虚拟索引与旧 embedding queue 状态）、生成按表依赖排序的数据恢复文件、为新 Vectorize index 重新入队 embedding 工作、用 migrations 在隔离目录创建恢复 schema、导入数据、逐表比较源/目标计数并验证重建后的 FTS 索引、检查远端 migration 状态、确认 `flaremo-attachments` R2 bucket 存在，并在 `backups/` 下生成演练报告。`backups/` 是本地输出目录，不提交到 Git。

演练报告包含 Better Auth session 行与 API-key 哈希，属于敏感数据，默认只保留最近 10 次本地演练（`--keep=N` 或 `FLAREMO_BACKUP_KEEP` 调整）和最近 3 次远端恢复演练，更早的目录会在每次成功演练后自动清理。

真实 Cloudflare 资源演练需要先创建临时 D1 和 R2，并明确传入目标，脚本不会猜测或覆盖生产绑定：

```bash
export FLAREMO_RESTORE_DATABASE="flaremo-restore-drill-YYYYMMDD"
export FLAREMO_RESTORE_DATABASE_ID="<temporary-d1-id>"
export FLAREMO_RESTORE_BUCKET="flaremo-restore-drill-YYYYMMDD"
pnpm backup:drill:remote
```

远端演练会导出生产 D1 事实源，对临时 D1 应用 migrations，按依赖顺序恢复数据，比较持久化清单中的所有表和两份 FTS 索引计数，并按 D1 中仍有效的 `r2_key` 逐个复制、下载和校验 R2 对象。最后脚本生成指向临时 D1/R2 的 Wrangler 配置并执行 deploy dry-run，但不会部署，也不会修改 `wrangler.jsonc`。如有 Vectorize binding，目标配置还应指向独立或已清空的目标索引，再让重建任务运行。

认证表恢复演练必须额外确认：bootstrap 状态仍为 `complete`、既有 owner 映射存在、session/PAT 的敏感值没有出现在报告中，并在必要时主动撤销旧 session/PAT。认证数据不能只按普通 memo 行计数。

脚本故意不自动删除目标资源。检查 `backups/remote-restore-*/report.md` 后，使用明确名称删除：

```bash
pnpm exec wrangler d1 delete "$FLAREMO_RESTORE_DATABASE"
pnpm exec wrangler r2 bucket delete "$FLAREMO_RESTORE_BUCKET"
```

如果生产 D1 当前没有有效附件记录，R2 复制计数为 0 是正确结果；演练仍会验证源 bucket、目标 bucket 和恢复后的 attachment 元数据计数。不要扫描或复制 D1 未引用的未知对象。

历史真实演练（2026-07-23）只证明当时的早期表集合：生产 D1 的 1 个用户、2 条 memo 和对应 FTS 行被恢复到临时 D1，生产当时没有有效 attachment。它**不能**替代本清单引入后的全表恢复证明；在下一次生产 schema 或恢复流程变更前后，都应重新完成一次远端演练并更新本记录。

2026-09-15 全表恢复演练已完成并通过：持久化清单全部 36 张表 + 两个 FTS 索引逐表计数源/目标一致（5 条 memo、FTS 5 行），0 条有效附件对应 R2 复制计数 0，最后以临时 D1/R2 生成的 Wrangler 配置通过 deploy dry-run；临时资源已当场删除。本次演练暴露并修复了两个真实问题：一是 09-14 引入根目录 `wrangler.json` 后隐式配置解析会命中占位 UUID，`remote-restore-drill.mjs` 现在显式 pin `wrangler.jsonc`；二是自部署生产 schema 停在 8/30（仍有 `users.role`、无 `auth_organizations` 等新表），旧备份无法按列原样装入当前 schema——导出器已改为**按两侧共有列做显式列名 INSERT**（`remote-restore-drill.mjs` 的 schema-adaptive 导出），并在恢复末尾从遗留 `users.role` 重新推导默认团队与 owner 成员（对应 migration 0020 的 backfill）。旧备份 + 新 schema 的恢复路径从此是被演练覆盖的主路径，而不是假设。

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
