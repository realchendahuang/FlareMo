# 发版规则

FlareMo 使用 Git tag 和 GitHub Release 发布版本。项目不依赖 GitHub Actions；发布前由维护者在本地跑完整门禁。

## 版本号

使用 SemVer。

- `PATCH`：bugfix、文档修正、小 UI 修正，不改变部署方式和兼容 API。
- `MINOR`：新增能力、扩大 Memos 兼容子集、非破坏性 schema 变更。
- `MAJOR`：破坏性 API、破坏性 migration、部署方式或访问边界变化。

当前 `0.x` 版本仍按这个规则发布。只要影响自托管升级，就必须写清楚。

## 发布前门禁

```bash
pnpm verify
pnpm deploy:dry-run
pnpm backup:drill
```

涉及数据库变更时，还要检查：

```bash
pnpm exec wrangler d1 migrations list DB --local
```

涉及生产部署时：

```bash
pnpm migrate:remote
pnpm deploy
```

## Release notes 必须包含

- 主要变化。
- Memos 兼容面变化。
- 数据库 migration 说明。
- Cloudflare 资源或 Access 配置变化。
- 升级步骤。
- 已知问题。

## 发版命令

确认版本号后运行：

```bash
pnpm release vX.Y.Z
```

发布脚本会检查工作树、确认 `HEAD` 已经推到 `origin/main`、提取 `CHANGELOG.md` 中对应版本的 release notes、执行 `pnpm verify` 和 `pnpm deploy:dry-run`，然后创建 tag 和 GitHub Release。

## 回滚

代码回滚：

```bash
git checkout <previous-tag>
pnpm verify
pnpm deploy
```

D1 migration 回滚不能假设自动可逆。破坏性 migration 必须在 release notes 里写清楚备份和人工恢复方式。
