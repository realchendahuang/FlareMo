# Agent 部署 Runbook

这份文档给自动化 Agent 使用。目标是让 Agent 能在不依赖 GitHub CI 的情况下完成验证、部署和回归检查。

## 前置条件

- 当前目录是 FlareMo 仓库根目录。
- `pnpm install` 已完成，或 Agent 可以执行它。
- Wrangler 已登录目标 Cloudflare 账号。
- `wrangler.jsonc` 里的 D1、R2 binding 指向目标资源。
- 生产访问由 Cloudflare Access 配置，不由 FlareMo 应用代码配置。

## 禁止事项

- 不要新增 GitHub Actions CI 或部署 workflow。`flaremo-update.yml` 是唯一例外，只在用户部署仓库中准备上游升级 PR。
- 不要绕过 `pnpm verify` 直接部署。
- 不要把 `Temp/`、`node_modules/`、`dist/`、`.wrangler/` 提交。
- 不要新增应用内 Bearer token 登录。
- 不要把 D1 主数据迁移到 KV、R2 或 Vectorize。

## 标准流程

确认工作树：

```bash
git status --short
```

安装依赖：

```bash
pnpm install
```

本地质量门禁：

```bash
pnpm verify
```

Cloudflare 打包验证：

```bash
pnpm deploy:dry-run
```

部署；`pnpm deploy` 会先应用远端 D1 migrations：

```bash
pnpm deploy
```

## 部署后检查

Wrangler 会输出生产 URL。设置：

```bash
export FLAREMO_URL="https://<worker-name>.<account>.workers.dev"
```

如果生产实例由 Cloudflare Access 保护，未登录访问应返回 Access 页面：

```bash
curl -sSL "$FLAREMO_URL" | rg "Log in|Cloudflare Access|FlareMo"
```

脚本访问需要 Access Service Token：

```bash
curl "$FLAREMO_URL/api/v1/memos" \
  -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET"
```

公开分享路径要单独验证 bypass policy，但分享内容仍必须由 FlareMo token 控制。

## 常见失败

### D1 migration 失败

先确认 `wrangler.jsonc` 的 D1 binding 名是 `DB`，再执行：

```bash
pnpm exec wrangler d1 migrations list DB --remote
```

### R2 上传失败

确认 `wrangler.jsonc` 中 R2 binding 是 `ATTACHMENTS`，bucket 名存在。

```bash
pnpm exec wrangler r2 bucket list
```

### 线上被 Access 拦截

这是生产默认预期。脚本请求必须加：

```text
CF-Access-Client-Id
CF-Access-Client-Secret
```

### 前端资源旧版本

重新构建并部署：

```bash
pnpm --filter @flaremo/web build
pnpm deploy
```
