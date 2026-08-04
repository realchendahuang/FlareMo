# Agent 部署 Runbook

这份文档给自动化 Agent 使用。目标是让 Agent 能在不依赖 GitHub CI 的情况下完成验证、部署和回归检查。

## 前置条件

- 当前目录是 FlareMo 仓库根目录。
- `pnpm install` 已完成，或 Agent 可以执行它。
- Wrangler 已登录目标 Cloudflare 账号。
- `wrangler.jsonc` 里的 D1、R2 binding 指向目标资源。
- `wrangler.jsonc` 的 Static Assets `run_worker_first` 必须覆盖 `/api/*`、`/file/*`、`/mcp`、`/openapi.json` 和 `/memos.api.v1.*`；否则 API、Memos Web 附件文件 URL 或 Connect/gRPC-Web 路径会被静态资源 fallback 接管，返回 SPA HTML 而不是进入 Worker。
- `wrangler.jsonc` 的 `FLAREMO_PUBLIC_URL` 已设置为生产 canonical origin；需要时设置 `FLAREMO_TRUSTED_ORIGINS`。
- `BETTER_AUTH_SECRET` 和 `FLAREMO_BOOTSTRAP_SECRET` 已通过 Wrangler secret 或 Cloudflare 控制台配置，且各至少 32 个字符。`FLAREMO_RECOVERY_SECRET` 只在明确批准的 break-glass recovery 窗口临时配置。Agent 不得要求用户把 secret、密码、cookie 或 PAT 粘贴到聊天中。
- `FLAREMO_SINGLE_USER_EMAIL` 和 `FLAREMO_SINGLE_USER_NAME` 只是既有 `users/owner` domain metadata 的 legacy 公开变量；它们不是 Better Auth 登录身份、用户名、密码或 bootstrap 输入。初始认证身份以部署者在生产 `/setup` 页面提交的值为准。
- Cloudflare Access 可以作为可选外层防线，但不替代 FlareMo 应用层认证。
- 生产 Cloudflare WAF/Rate Limiting 已覆盖登录、bootstrap 和 operator recovery 路径；Worker 内置限流只作为单 isolate 补充。

## 禁止事项

- 不要新增 GitHub Actions CI 或部署 workflow。`flaremo-update.yml` 是唯一例外，只在用户部署仓库中准备上游升级 PR。
- 不要绕过 `pnpm verify` 直接部署。
- 不要把 `Temp/`、`node_modules/`、`dist/`、`.wrangler/` 提交。
- 不要新增绕开 Better Auth 的登录、共享密码或第二套 Bearer token；机器访问使用已撤销能力的 `memos_pat_` PAT。
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

配置生产认证 secrets（交互式输入，不要把值写进命令行参数、仓库或日志）：

```bash
pnpm exec wrangler secret put BETTER_AUTH_SECRET --config ./wrangler.jsonc
pnpm exec wrangler secret put FLAREMO_BOOTSTRAP_SECRET --config ./wrangler.jsonc
# 仅在批准的 operator recovery 窗口临时执行；成功后立即 rotate/delete。
pnpm exec wrangler secret put FLAREMO_RECOVERY_SECRET --config ./wrangler.jsonc
```

Wrangler secret 不提供安全的值回读路径。Agent 只检查配置后的 bootstrap status，不得要求用户把 secret 重新粘贴、打印或通过命令行转交。

部署；`pnpm deploy` 会先应用远端 D1 migrations：

```bash
pnpm deploy
```

## 部署后检查

Wrangler 会输出生产 URL。设置：

```bash
export FLAREMO_URL="https://<worker-name>.<account>.workers.dev"
```

检查原生认证是否已经配置：

```bash
curl "$FLAREMO_URL/api/auth/flaremo/bootstrap/status"
```

首次安装必须由部署者在浏览器打开 `https://<your-flaremo-origin>/setup`，并在生产 HTTPS 页面手动输入 `FLAREMO_BOOTSTRAP_SECRET`、初始用户名、显示名、邮箱和 12–128 个字符的初始密码。如果启用了 Cloudflare Access，先通过外层 policy 再打开 `/setup`。Agent 不得要求用户把这些值粘贴到聊天、命令行、shell history、issue、日志或 Agent 输出，也不得代用户调用 bootstrap endpoint；部署者完成页面提交后，Agent 只能检查 bootstrap status 和登录结果。

bootstrap endpoint 只保留给明确批准的受控初始化流程；本 runbook 不提供把 secret 或密码放进环境变量、命令行参数或非交互 `curl` 的示例。已完成 bootstrap 后的密码破窗恢复使用单独的 `FLAREMO_RECOVERY_SECRET`，重置现有 owner、撤销全部 session/PAT，不创建第二个 owner；恢复成功后立即轮换或删除该 secret。若 bootstrap 因部分写入进入 `recovery_required`，使用同一 secret 调用 operator-only `POST /api/auth/flaremo/recover-bootstrap` 只协调既有身份映射；该接口不接受用户名、密码，不会重新开放 signup，遇到多个身份或 link 会返回 `409`。

然后验证 cookie session，登录后创建并安全保存 `memos_pat_` PAT，再用 PAT 访问私有 API。PAT 明文只在创建时显示一次。

如果生产实例由 Cloudflare Access 保护，未通过外层 policy 的访问应返回 Access 页面：

```bash
curl -sSL "$FLAREMO_URL" | rg "Log in|Cloudflare Access|FlareMo"
```

脚本访问需要应用层 PAT；如果 Access 仍启用，还要加 Access Service Token：

```bash
curl "$FLAREMO_URL/api/v1/memos" \
  -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $FLAREMO_MEMOS_PAT"
```

公开分享路径要单独验证 bypass policy，但分享内容仍必须由 FlareMo share token 控制。Access Service Token alone 不能访问私有 API。

旧的 `/api/v1/mcp` 是 FlareMo 现有 JSON-RPC 子集；根 `/mcp` 现在提供 current Memos 风格的无状态 JSON Streamable HTTP MCP 子集。Agent 不得在发布记录中宣称已经完整兼容：完整 CEL、Connect/gRPC、SSE、comments/reactions/shortcuts 的完整上游 parity、完整上游 webhook 事件/egress 语义、完整 notification filter/多用户 ACL，以及第三方客户端真实 smoke test 仍未完成；有限 social、UserService webhook/notification 资源和四类 memo 事件的有界 outbox 投递/重试已经有本地 contract 覆盖。

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

### 原生认证返回 `401`

这通常表示请求只带了 Access headers，或者没有带 Better Auth cookie/PAT。按顺序检查：

1. `FLAREMO_PUBLIC_URL` 是不带 path/query/hash 的 canonical origin。
2. `BETTER_AUTH_SECRET` 长度至少为 32 个字符，且 secret 已配置到目标 Worker。
3. bootstrap status 为 `complete`，并且 owner 已成功登录。
4. 浏览器请求带 cookie，机器请求带 `Authorization: Bearer memos_pat_...`。
5. 如果 PAT 被撤销或过期，重新创建一个 PAT；不要把 PAT 明文写入 issue、日志或部署配置。

### 原生认证返回 `403`（Origin policy）

这通常表示凭据有效，但请求的 Origin 不符合应用层安全契约：

1. cookie session 的 `POST`、`PATCH`、`DELETE` 等状态变更必须携带 Origin，并且精确等于 `FLAREMO_PUBLIC_URL` 或 `FLAREMO_TRUSTED_ORIGINS` 中的一个 origin。
2. PAT 请求可以没有 Origin；桌面脚本、MCP 和其他非浏览器客户端不需要为了认证人为添加 Origin。
3. PAT 请求如果携带 Origin，也必须命中同一 allowlist；不匹配时预期返回 `403`。
4. allowlist 不支持 wildcard；`Referer` 和 Cloudflare Access headers 都不能修复 Origin mismatch。修改公开 vars 后需要重新部署 Worker。

这套规则与 Memos 0.30 的 browser-origin 模型方向一致，但不代表 FlareMo 已完成完整 Memos Server parity。current wire 和根 `/mcp` 只承诺兼容矩阵中列出的子集。

### 前端资源旧版本

重新构建并部署：

```bash
pnpm --filter @flaremo/web build
pnpm deploy
```
