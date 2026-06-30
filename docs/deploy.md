# 部署 FlareMo

FlareMo 部署到 Cloudflare Workers。Worker 同时承载前端静态资源和 API，D1 保存主数据，R2 保存附件。

## 一键部署

点击按钮会让 Cloudflare 从当前仓库创建一份新仓库，读取 `wrangler.jsonc`，自动创建需要的 D1 和 R2 资源，并配置 Workers Builds。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/realchendahuang/FlareMo)

公开入口的实测记录见 [deploy-button-test.md](./deploy-button-test.md)。

如果 Cloudflare Dashboard 还没有连接 GitHub 或 GitLab provider，创建页会先提示 `Connect a Git account to continue.`。这是 Cloudflare Workers Builds 的 Git 集成前置条件。

一键部署完成后还要做两件事：

- 在 Cloudflare Access 里保护 Worker 域名或自定义域名。
- 对远端 D1 执行 migrations。

```bash
pnpm migrate:remote
```

## 手动部署

安装依赖：

```bash
pnpm install
```

创建 D1 和 R2：

```bash
pnpm exec wrangler d1 create flaremo
pnpm exec wrangler r2 bucket create flaremo-attachments
```

把 D1 输出的 `database_id` 写到 `wrangler.jsonc`。

应用远端 migrations：

```bash
pnpm migrate:remote
```

部署：

```bash
pnpm deploy
```

部署前建议跑：

```bash
pnpm verify
pnpm deploy:dry-run
```

## Cloudflare Access

FlareMo 不在应用里做实例级登录。生产实例应该由 Cloudflare Access 保护，不要再给 FlareMo 增加应用内 Bearer token、登录页或自建会话网关。

Access 的推荐边界是：

- 人类访问：`Allow` identity policy。
- 脚本、MCP 和 Memos-compatible 客户端：`Service Auth` policy + Access Service Token。
- 公开分享和静态资源：最窄路径的 `Bypass` policy。

### 1. 创建 Access application

Cloudflare Dashboard 里进入 `Zero Trust` -> `Access` -> `Applications` -> `Add an application`，选择 `Self-hosted`。

建议填写：

| 字段 | 建议值 |
| --- | --- |
| Application name | `FlareMo` |
| Application domain | 你的生产域名，例如 `notes.example.com` |
| Session duration | 个人实例可用 `24h` 或 `1 week` |

如果先使用 `workers.dev` 或 Worker Preview URL，可以在 Worker 的 `Settings` -> `Domains & Routes` 里启用 Cloudflare Access，再进入 Access 管理策略。正式使用时更推荐绑定自定义域名，再保护这个域名。

### 2. 配置人类访问 policy

给根域名配置一个 `Allow` policy，只放你自己或明确允许的人。

推荐规则：

| 项 | 建议 |
| --- | --- |
| Policy action | `Allow` |
| Include | 你的邮箱、邮箱域名、GitHub/Google/SSO identity group，或 One-time PIN 的指定邮箱 |
| Exclude | 不需要时留空；不要用 `Everyone` 保护根路径 |

这个 policy 负责浏览器访问 FlareMo Web UI。通过后，用户会拿到 Cloudflare Access session cookie。

### 3. 创建 Service Token

脚本、MCP、Memos-compatible 客户端通常没有浏览器登录流程，应该使用 Access Service Token。

在 Cloudflare Dashboard 里进入 `Zero Trust` -> `Access` -> `Service Auth` -> `Service Tokens`，创建一个 token，例如：

```text
FlareMo API clients
```

保存创建时显示的 `Client ID` 和 `Client Secret`。`Client Secret` 只显示一次，写到本地密码管理器或部署环境变量里，不要提交到仓库。

本地建议使用：

```bash
export FLAREMO_ACCESS_CLIENT_ID="<client-id>"
export FLAREMO_ACCESS_CLIENT_SECRET="<client-secret>"
```

### 4. 配置机器访问 policy

回到 FlareMo Access application，新增一个 policy：

| 项 | 建议 |
| --- | --- |
| Policy action | `Service Auth` |
| Include | 刚创建的 Service Token |
| Require | 可选；固定网络可加 IP/Country 等额外限制 |

机器客户端请求时发送 Cloudflare Access 要求的两个 header：

```bash
curl "$FLAREMO_URL/api/v1/memos" \
  -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET"
```

MCP 示例：

```bash
curl "$FLAREMO_URL/api/v1/mcp" \
  -H "content-type: application/json" \
  -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

不要把 Service Token 改造成 FlareMo 应用内 token。FlareMo 业务代码不读取、签发或存储这些凭据。

### 5. 配置公开分享 bypass

公开分享需要让未登录访客访问分享页和分享附件。Cloudflare Access 的路径策略会让更具体的路径覆盖根路径策略，因此给以下路径单独配置 `Bypass`：

- `/share/*`
- `/api/public/shares/*`
- `/assets/*`

建议做法：

| Path | Policy action | Include |
| --- | --- | --- |
| `/share/*` | `Bypass` | `Everyone` |
| `/api/public/shares/*` | `Bypass` | `Everyone` |
| `/assets/*` | `Bypass` | `Everyone` |

只 bypass 这些公开路径，不要 bypass `/api/v1/*`、`/openapi.json` 或根路径。`Bypass` 会跳过 Access 强制认证，也不会产生 Access 访问日志；需要认证和审计的机器请求应使用 `Service Auth`，不要用 `Bypass`。

Bypass 只跳过 Cloudflare Access，不跳过 FlareMo 的 share token、过期时间和 memo 状态校验。归档、回收站、删除或过期的分享仍应由 FlareMo 返回不可访问。

### 6. 验证配置

未登录浏览器访问根路径应该看到 Cloudflare Access 登录页：

```bash
curl -I "$FLAREMO_URL"
```

带 Service Token 的 API 请求应该进入 FlareMo：

```bash
curl "$FLAREMO_URL/api/v1/memos" \
  -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET"
```

公开分享路径应该不要求 Access 登录，但无效 token 仍不能读到内容：

```bash
curl -I "$FLAREMO_URL/share/not-a-real-token"
curl -I "$FLAREMO_URL/api/public/shares/not-a-real-token"
```

## Access 配置检查清单

- 根域名或 Worker URL 已创建 Cloudflare Access application。
- 人类访问使用 `Allow` policy，范围只包含允许访问的人。
- 脚本、MCP 和 Memos-compatible 客户端使用 `Service Auth` policy 和 Access Service Token。
- `Client Secret` 没有写入仓库、issue、PR 或公开日志。
- `/share/*`、`/api/public/shares/*`、`/assets/*` 有明确 `Bypass` policy。
- 没有 bypass 根路径、`/api/v1/*` 或 `/openapi.json`。
- FlareMo 没有新增应用内 Bearer token 登录。

## 本地开发

```bash
pnpm migrate:local
pnpm dev
```

默认地址：

```text
http://localhost:8787
```

## 升级

升级前先看 `CHANGELOG.md` 和 release notes。只要 release notes 里提到 database migration，就先执行：

```bash
pnpm migrate:remote
```

再执行：

```bash
pnpm deploy
```

## 验证

部署完成后检查：

```bash
curl -I "$FLAREMO_URL"
curl "$FLAREMO_URL/openapi.json"
```

如果生产实例启用了 Cloudflare Access，未登录访问应看到 Access 登录页；脚本请求必须带 `CF-Access-Client-Id` 和 `CF-Access-Client-Secret`。
