# 部署 FlareMo

FlareMo 部署到 Cloudflare Workers。Worker 同时承载前端静态资源和 API，D1 保存主数据，R2 保存附件。

## 一键部署（社区支持）

仓库提供一份面向 [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/realchendahuang/FlareMo) 按钮的跟踪配置 `wrangler.json`（D1 `database_id` 是占位值，Cloudflare 会在部署时自动创建资源并改写 ID）。按钮流程会克隆仓库到你的 GitHub 账号并接入 Workers Builds。

已知问题与注意点：

- 首次尝试可能出现 “Github API Limit Exceeded”，这是 Cloudflare 侧克隆时的临时限流，等待几分钟重试通常即可。
- 部署完成后，需要把 Worker 的 `FLAREMO_PUBLIC_URL` 变量改成你的实际 origin（workers.dev 子域名或自定义域名），并用 `wrangler secret put BETTER_AUTH_SECRET`（及可选 `FLAREMO_BOOTSTRAP_SECRET`）补上密钥，然后重试部署一次使新配置生效。
- 语义搜索依赖的 Vectorize index 与 R2/D1/Queue 一样由按钮流程自动创建。

手动部署仍是受支持的完整路径，按钮流程更适合快速试用。

## GitHub Action 手动部署（自托管 fork）

自己的 fork 或部署仓库可以使用 `.github/workflows/deploy-cloudflare.yml`：在 Actions 里手动 `Run workflow`，创建缺失的 D1 / R2 / Queue / Vectorize，发布 Worker，并把仓库 Secrets 里的 `BETTER_AUTH_SECRET`、`FLAREMO_BOOTSTRAP_SECRET` 同步到 Cloudflare。push 不会自动发布；上游 `realchendahuang/FlareMo` 不会跑这个 job。

完整步骤见 [用 GitHub Action 部署](./github-action-deploy.md)。

## 手动部署

仓库不跟踪 `wrangler.jsonc`（手动部署者的配置以本机文件形式存在），也没有 CI 或自动部署。先创建资源、复制配置模板并填入自己的值，再执行部署命令。

安装依赖：

```bash
pnpm install
```

复制配置模板，把 `FLAREMO_PUBLIC_URL` 设置为你的公开访问 origin，再创建 D1 和 R2：

```bash
cp wrangler.jsonc.example wrangler.jsonc
pnpm provision:remote
```

`pnpm provision:remote` 会创建缺失的 D1、R2、Queue 和 Vectorize 资源，并把 D1 的 `database_id` 自动写回 `wrangler.jsonc`；幂等，已存在的资源会跳过。

也可以手动执行等价命令：

```bash
cp wrangler.jsonc.example wrangler.jsonc
pnpm exec wrangler d1 create flaremo
pnpm exec wrangler r2 bucket create flaremo-attachments
```

手动创建时需要把 D1 输出的 `database_id` 写入 `wrangler.jsonc`；bucket、queue 和 Vectorize index 名称可以保留为建议默认值。

部署；这个命令会先构建前端、应用远端 migrations，再发布 Worker：

```bash
pnpm deploy
```

部署前建议跑：

```bash
pnpm deploy:dry-run
pnpm deploy:preflight
```

（全量 `pnpm verify` 仅在维护者明确要求时运行。）

`pnpm deploy:preflight` 会确认本地发布环境提供了至少 32 个字符的
`BETTER_AUTH_SECRET`，并拒绝常见占位值。在 CI 构建环境（`CI=true`，如
Workers Builds）中 preflight 只降级为警告不阻断：
自动部署环境不携带操作者 secrets，正式 secret 存放在 Worker 的 secret
store，首次部署后由部署者用 `wrangler secret put` 配置。本地手动发布仍
强制校验。生产发布还必须确认
`flaremo-member-removal` Queue 已在目标 Cloudflare 账户创建；`pnpm deploy:dry-run`
会显示该 Queue、D1、R2、Vectorize、AI 和 Assets binding，但不会创建远程资源。

## Better Auth 原生认证

FlareMo 的应用层认证由 Better Auth 提供。当前是“单用户完整能力、多用户数据地基”模型：首次部署通过一次性 bootstrap 创建用户名、显示名、邮箱和密码，之后关闭公共 signup。浏览器使用 `HttpOnly`、`SameSite=Lax` cookie session；脚本、MCP 和 Memos-compatible 客户端使用由已登录账户创建的可撤销 `memos_pat_` PAT。

Cloudflare Access 可以作为额外的外层防线，但 Access 身份或 Access Service Token 不会自动映射为 FlareMo 用户。启用 Access 时必须同时满足外层 policy 和下面的应用层认证。

生产还应在 Cloudflare WAF/Rate Limiting 中为 `/api/auth/sign-in/*`、`/api/auth/flaremo/bootstrap`、`/api/auth/flaremo/recover` 和 `/api/auth/flaremo/recover-bootstrap` 配置按 IP/入口的失败或请求速率限制。Better Auth 的 Worker 内置限流是单 isolate 的补充，不是跨边缘位置的唯一 credential-stuffing 防护；bootstrap/recovery 自定义路由也不自动进入 Better Auth handler 的限流范围。

### 1. 配置公开变量

在 `wrangler.jsonc` 的 `vars` 中设置：

| 变量 | 要求 |
| --- | --- |
| `FLAREMO_PUBLIC_URL` | 必填；canonical origin，例如 `https://notes.example.com`，不能带 path、query 或 fragment。生产使用 HTTPS。 |
| `FLAREMO_TRUSTED_ORIGINS` | 可选；逗号分隔的额外完整 origin，只在确实需要跨 origin Web 客户端时设置。 |
| `FLAREMO_SINGLE_USER_EMAIL` / `FLAREMO_SINGLE_USER_NAME` | 既有 `users/owner` domain metadata 的 legacy 公开变量，不是 Better Auth 登录凭据，也不提供初始密码；首次认证身份和 setup 时提交的 owner 资料以 `/setup` 页面输入为准。已有 `users/owner` 行不会因修改这两个变量而被自动重写。 |

`FLAREMO_PUBLIC_URL` 和 `FLAREMO_TRUSTED_ORIGINS` 不是凭据，可以写入部署配置。`FLAREMO_PUBLIC_URL` 为空或格式不合法时，Better Auth 会 fail closed，不能完成 setup。

### 2. 凭据类型与 Origin policy

应用层按凭据类型执行不同的 Origin 契约。allowlist 总是包含 `FLAREMO_PUBLIC_URL`，并在设置时加入 `FLAREMO_TRUSTED_ORIGINS` 中的逗号分隔 origin；比较使用精确 origin，不接受 wildcard，也不使用 `Referer` 或 Cloudflare Access headers 代替。

| 请求类型 | Origin 要求 | 失败行为 |
| --- | --- | --- |
| Cookie session 状态变更 | 必须携带 `Origin`，并精确匹配 `FLAREMO_PUBLIC_URL` 或 `FLAREMO_TRUSTED_ORIGINS` | 缺失或不匹配返回 `403` |
| PAT/Bearer 无 Origin | 允许，适用于桌面脚本、MCP 和其他非浏览器客户端 | 继续按 `memos_pat_` PAT 验证 |
| PAT/Bearer 携带 Origin | 必须精确匹配同一 allowlist | 不匹配返回 `403` |
| Cloudflare Access headers | 只属于可选外层 policy | 不能替代 cookie session、PAT 或 Origin 校验 |

这与 [Memos 0.30 MCP 文档](https://usememos.com/docs/integrations/mcp) 的 browser-origin 安全模型保持同一方向。当前 `/api/v1` 默认使用 current camelCase wire，并已提供 Better Auth-backed identity、Memos 风格 HS256 access JWT、轮换的 `memos_refresh` HttpOnly cookie、PAT/social 资源、UserService webhook/notification 资源子集、四类 memo 事件的 D1 outbox 投递/重试、Connect JSON/protobuf/gRPC-Web unary subset、heartbeat SSE 和根 `/mcp` 无状态 Streamable HTTP MCP 子集；完整上游 webhook 事件/egress 语义、完整 notification filter/多用户 ACL、完整 Memos Server parity、原生 protobuf/gRPC 和第三方客户端仍未全部验证或完成。

### 3. 配置 Worker secrets

使用 Wrangler 的交互式 secret 输入；命令不会把值写进仓库：

```bash
pnpm exec wrangler secret put BETTER_AUTH_SECRET --config ./wrangler.jsonc
pnpm exec wrangler secret put FLAREMO_BOOTSTRAP_SECRET --config ./wrangler.jsonc
```

`BETTER_AUTH_SECRET` 和 `FLAREMO_BOOTSTRAP_SECRET` 都至少需要 32 个字符。两者应由部署者在密码管理器或安全随机数工具中生成，不能写入 `wrangler.jsonc`、`.dev.vars.example`、Git、issue、PR、日志或聊天记录。`FLAREMO_RECOVERY_SECRET` 是可选的独立 break-glass secret，也至少需要 32 个字符；正常运行时可以不配置，只在明确批准的 operator recovery 窗口临时配置，成功后立即轮换或删除。生产 `FLAREMO_PUBLIC_URL` 必须使用 HTTPS；HTTP 只允许本地开发 origin。

Wrangler secret 是写入式配置，部署者应把值保存在自己的密码管理器中；不要尝试通过命令回读、打印或把它传给 Agent。后续只验证 secret 已使 bootstrap status 显示 `setup_available: true`，不验证或输出 secret 本身。

### 4. 应用 D1 migration 并检查 setup 状态

先应用 migration，再发布或重启使用新配置的 Worker：

```bash
pnpm migrate:remote
curl "$FLAREMO_URL/api/auth/flaremo/bootstrap/status"
```

0016 migration 会创建 `member_removal_jobs`。应用后再检查管理员页的成员移除任务，
并确认 Queue 消费者可以领取 queued job；迁移前的旧数据库只保留兼容 fallback，不能
作为正式环境的最终状态。

首次安装应看到 `state: "ready"` 和 `setup_available: true`。如果返回 `recovery_required`，不要重复提交 bootstrap 或手工创建第二个账户；这表示身份创建和 domain owner 映射之间发生了部分失败，需要先按维护流程处理 bootstrap recovery。

### 5. 一次性创建 owner（生产主路径：`/setup` 页面）

生产首装由部署者在浏览器打开 `https://<your-flaremo-origin>/setup`，并在页面中手动填写以下内容：

- Worker secret `FLAREMO_BOOTSTRAP_SECRET`。
- 初始 Better Auth 用户名、显示名和邮箱。
- 初始密码（8–128 个字符）。

如果生产实例启用了 Cloudflare Access，先通过 Access 外层 policy 再打开 `/setup`。整个输入过程应只发生在 HTTPS 页面和部署者自己的密码管理器中；不要把 secret、密码或完整表单内容放入 shell 命令、shell history、Agent 输出、issue、日志或聊天。提交成功后页面会转到 `/login`，公共 signup 关闭；之后在账户页面修改密码或撤销其他 session。

`/setup` 页面调用一次性 bootstrap，成功后 D1 状态变为 `complete`，后续访问不会创建第二个 owner。bootstrap API endpoint 保留给明确批准的受控恢复/自动化流程；本部署指南不提供把 secret 或密码放进命令行、环境变量或非交互 `curl` 的示例。

### 6. 登录并创建 Memos PAT

用户名登录入口是 `/api/auth/sign-in/username`。浏览器或客户端必须保存响应中的 cookie，并在后续私有请求中发送它。账户管理接口包括：

- `/api/auth/update-user`：修改用户名等 Better Auth 用户资料。
- `/api/auth/change-password`：修改密码；密码修改时可以撤销其他 session。
- `/api/app/account/personal-access-tokens`：在 cookie session 下创建、列出和撤销 `memos_pat_` PAT。

当前没有配置邮件 provider，因此 Better Auth 的普通 `request-password-reset` 邮件流程保持关闭；账户页提供的是“知道当前密码时修改密码”。如需忘记密码自助找回，应先接入真实 transactional email provider，再配置 Better Auth 的 `sendResetPassword` 和 reset 页面，不要把一个假的成功提示当作恢复能力。

### Break-glass operator recovery

没有邮件 provider 时，已完成 bootstrap 的单用户实例可以使用单独的 `FLAREMO_RECOVERY_SECRET` 做受限恢复。这个入口只重置现有 owner，不创建用户、不重建 `auth_user_links`，并通过 Better Auth 的 reset-password 流程完成密码校验、哈希、一次性 verification 消费和 session 撤销；现有 `memos_pat_` 也会全部撤销。它是运维破窗能力，不是普通用户的忘记密码功能。

### Web Push 推送提醒（可选）

每日回顾与逾期日程支持浏览器 Web Push。生成 VAPID 密钥对后写入 Worker vars：

```bash
pnpm exec npx web-push generate-vapid-keys
# 两个值填入 wrangler.jsonc 的 vars：
#   FLAREMO_VAPID_PUBLIC_KEY  （公开值，非 secret）
#   FLAREMO_VAPID_PRIVATE_KEY （仅服务端使用；不放公开仓/客户端）
```

两个键都配置后，账户页「推送提醒」面板可开启/关闭订阅；每日 cron 在生成每日回顾与逾期提醒通知时同发推送。缺任一键则推送端到端关闭，站内通知不受影响。

安全边界：

- secret 只通过 Wrangler secret 或 Cloudflare 控制台输入，不能进入 URL、请求体、代码、Git、日志或聊天；
- 请求必须是 HTTPS `POST`，并带 canonical `Origin`；
- 新密码只通过 HTTPS 请求体传输，不能放进 shell history、命令参数或日志；
- recovery 成功后立即删除或轮换 `FLAREMO_RECOVERY_SECRET`，并让客户端重新创建 PAT；
- Access headers 只可作为外层门禁，不能单独调用该入口，也不能替代 Better Auth 身份。

恢复入口是：

```text
POST /api/auth/flaremo/recover
X-FlareMo-Recovery-Secret: <operator secret>
Origin: https://<your-flaremo-origin>
{"new_password":"<new password>"}
```

不要把上面的占位符替换后写进公开文档、issue、日志或聊天。完成恢复后检查 `bootstrap/status` 仍为 `complete`，用新密码登录，再重新创建 PAT；旧 session 和旧 PAT 预期全部失效。

PAT 明文只在创建响应中返回一次；list 和 revoke 响应不会返回明文或 hash。把 PAT 放入密码管理器，之后只通过环境变量或安全的客户端配置使用：

```bash
curl "$FLAREMO_URL/api/v1/memos" \
  -H "Authorization: Bearer $FLAREMO_MEMOS_PAT"
```

如果 Cloudflare Access 仍然启用，上面的请求还要附加 Access Service Token headers。Access Service Token 单独发送时，Worker 仍会返回应用层 `401`，这是预期行为。

旧的 `/api/v1/mcp` 是 FlareMo 既有 JSON-RPC MCP 子集，同样需要 cookie session 或 PAT；它继续保留给旧客户端。current Memos 风格的无状态 JSON Streamable HTTP MCP 位于根 `/mcp`，支持 `initialize`、`notifications/initialized`、`tools/list` 和 `tools/call`，但不承诺 SSE、有状态 session 或完整 method surface。

### Workers 免费套餐的可用性边界

FlareMo 是全功能应用（认证 + 全文/向量检索 + 附件 + 队列），Worker 的每请求 CPU 开销天然贴近 Cloudflare Workers **免费套餐的 10ms CPU/请求上限**。免费套餐可以跑轻量单用户实例，但要清楚这些边界（issue #138 的实测）：

- **登录是全应用 CPU 最重的路径**（argon2/scrypt 密码校验），负载或冷启动叠加时最先失败，表现为偶发「密码正确但无响应」（Error 1102）。
- 正常使用数小时后，突发高并发写入可能把后续请求（包括 `/api/app/health`）打成 503，需要等 isolate 冷却。
- 批量操作（大批量删除/导入）在贴线状态下也可能单请求 1102，重试即可。

免费套餐的建议用法：单用户、低频写入、避免自动化工具高并发打接口。付费套餐（Standard 起，无 10ms 限制）没有这些约束。如果你在免费套餐上稳定遇到 Error 1102，先确认是否属于上述场景，再考虑升级套餐——应用层配置无法绕开该限制。

### Cloudflare 资源用量面板（可选）

Owner 用量面板除了应用内自测的向量用量，还可以展示 Cloudflare 官方口径的本实例资源用量（Workers 请求数、D1 存储与读/写行数、R2 存储与 Class A / B 操作）。数据来自 GraphQL Analytics API（`api.cloudflare.com/client/v4/graphql`），按本部署自己的 Worker 名、D1 database id、R2 bucket 过滤，共享账号下其他项目的用量不会被计入。

启用只需一次性运行：

```bash
pnpm setup:usage
```

脚本会检测现有 secret、给出创建 API token 的指引（自定义 token 只需要 **Account → Account Analytics → Read** 一条权限）、写入 `FLAREMO_CF_ANALYTICS_TOKEN`、`FLAREMO_CF_ACCOUNT_ID`、`FLAREMO_CF_WORKER_NAME`、`FLAREMO_CF_D1_ID`、`FLAREMO_CF_R2_BUCKET` 五个 Worker secret，并当场验证 token 能读到 analytics。secret 配置一次即随实例永久生效，之后的部署无需重复任何步骤；`--reset` 可只重新录入 token。

Token 权限是账号级的（Cloudflare 不支持更细的 analytics 读取范围），但面板查询始终按资源 id 过滤。不配置 token 时该区块整体隐藏，应用其余功能不受影响。R2 存储指标约有 24 小时延迟；「本月」按 UTC 自然月对齐 Cloudflare 计费周期；最终计费以 Cloudflare Dashboard 为准。

## Cloudflare Access（可选外层防线）

第一轮生产发布建议保留 Access，作为迁移期和纵深防御边界。Access 的职责是保护网络入口，不取代 Better Auth：

- 人类访问：`Allow` identity policy。
- 脚本、MCP 和 Memos-compatible 客户端：`Service Auth` policy + Access Service Token，再使用 FlareMo PAT。
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

这个 policy 负责外层浏览器访问。通过后，用户仍要在 FlareMo 应用层完成 Better Auth 登录；Cloudflare Access session cookie 不会代替 FlareMo cookie session。

### 3. 创建 Service Token

脚本、MCP、Memos-compatible 客户端通常没有浏览器登录流程，应该使用 Access Service Token 通过外层 policy，再使用 FlareMo PAT 通过应用层。

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

机器客户端请求时发送 Cloudflare Access 要求的两个 header，并额外发送 FlareMo PAT：

```bash
curl "$FLAREMO_URL/api/v1/memos" \
  -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $FLAREMO_MEMOS_PAT"
```

MCP 示例：

```bash
curl "$FLAREMO_URL/api/v1/mcp" \
  -H "content-type: application/json" \
  -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $FLAREMO_MEMOS_PAT" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

current Memos 风格 MCP 使用根 `/mcp`，同样需要 FlareMo PAT；它是无状态 JSON Streamable HTTP 子集：

```bash
curl "$FLAREMO_URL/mcp" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "CF-Access-Client-Id: $FLAREMO_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $FLAREMO_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $FLAREMO_MEMOS_PAT" \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}'
```

不要把 Access Service Token 改造成 FlareMo 应用内 token。两种凭据属于不同层：Access 只保护入口，FlareMo PAT 才映射到 D1 中的应用用户。

### 5. 配置公开分享 bypass

公开分享需要让未登录访客访问分享页和分享附件。Cloudflare Access 的路径策略会让更具体的路径覆盖根路径策略，因此给以下路径单独配置 `Bypass`：

- `/share/*`
- `/api/public/shares/*`
- `/file/*`（只为带 `share_token` 的公开附件 URL 提供外层 bypass；无 token 时仍由 FlareMo 应用层认证）
- `/assets/*`

建议做法：

| Path | Policy action | Include |
| --- | --- | --- |
| `/share/*` | `Bypass` | `Everyone` |
| `/api/public/shares/*` | `Bypass` | `Everyone` |
| `/file/*` | `Bypass` | `Everyone` |
| `/assets/*` | `Bypass` | `Everyone` |

只 bypass 这些公开路径，不要 bypass `/api/auth/*`、`/api/app/*`、`/api/v1/*`、`/openapi.json` 或根路径。`/file/*` 同时承载 Memos Web 的私有附件 URL 和带 `share_token` 的公开 URL；如果对它做 Bypass，Worker 仍必须在无 token 分支要求 Better Auth cookie/session bearer、native access JWT 或 PAT，在带 token 分支严格校验 share token、过期时间、撤销状态、memo 状态和附件归属。`Bypass` 会跳过 Access 强制认证，但不会跳过这些 FlareMo 应用层校验；需要认证和审计的机器请求应使用 `Service Auth`，不要用 `Bypass`。

Bypass 只跳过 Cloudflare Access，不跳过 FlareMo 的 share token、过期时间和 memo 状态校验。归档、回收站、删除或过期的分享仍应由 FlareMo 返回不可访问。

### 6. 验证配置

启用 Access 时，未通过外层 policy 的浏览器访问应该看到 Cloudflare Access 登录页；通过 Access 后，未通过 Better Auth 的应用请求仍应被 FlareMo 拒绝：

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
- Better Auth 的 `FLAREMO_PUBLIC_URL`、`BETTER_AUTH_SECRET` 和 `FLAREMO_BOOTSTRAP_SECRET` 已配置；secret 未写入仓库。
- 已完成一次性 owner bootstrap，成功登录，并创建至少一个需要的 PAT。
- 脚本、MCP 和 Memos-compatible 客户端使用 `Service Auth` policy、Access Service Token 和 FlareMo PAT。
- `Client Secret` 没有写入仓库、issue、PR 或公开日志。
- `/share/*`、`/api/public/shares/*`、`/file/*`、`/assets/*` 有明确 `Bypass` policy；`/file/*` 的应用层 private/share 分支仍然 fail-closed。
- 没有 bypass 根路径、`/api/auth/*`、`/api/app/*`、`/api/v1/*` 或 `/openapi.json`。
- 关闭 Access 前，已在隔离环境验证 native cookie session、PAT、revoke、公开分享和无凭据 `401`。

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

应用内左下角的“系统更新”会显示当前版本和最新稳定版本。使用 Workers Builds 的 GitHub 部署可以按 [更新指南](./update.md) 运行更新 workflow、审查升级 PR，并在合并后自动发布。若使用 [GitHub Action 手动部署](./github-action-deploy.md)，合并升级 PR 之后还要再运行一次 `Deploy to Cloudflare`。

手工升级前先看 `CHANGELOG.md` 和 release notes，然后执行：

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

无论 Access 是否启用，私有 API 还必须通过 Better Auth cookie session 或 `Authorization: Bearer $FLAREMO_MEMOS_PAT`。仅有 Access headers 不足以访问私有业务数据。
