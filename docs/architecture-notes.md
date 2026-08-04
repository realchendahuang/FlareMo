# FlareMo 架构设计

这份文档描述 FlareMo 当前的架构方向。它是开源仓库里的结果型设计文档，不是过程记录。后续架构变化应直接修改本文原文。

本地参考仓库放在 `Temp/` 下，并通过 `.gitignore` 排除在版本库之外：

- `Temp/MeowNocode`：来自 `XuYouo/MeowNocode`
- `Temp/blinko`：来自 `blinkospace/blinko`
- `Temp/memos`：来自 `usememos/memos`

## 目标

FlareMo 要做一个 Flomo 风格、面向 Memos 生态构建兼容层、完整运行在 Cloudflare 上的个人知识管理系统。

核心目标：

- 快速记录，打开就能写。
- 对外提供 Memos 兼容 API，方便复用 Memos 生态。
- 前端和 API 都运行在 Cloudflare Workers 上。
- 笔记、用户、关系、分享、设置等主数据存 D1。
- 附件、导出包、生成资源和音频存 R2。
- 应用层认证使用 Better Auth；Cloudflare Access 只作为可选外层防线。
- 后续语义检索和 AI 工作流可以接入 Vectorize 和 Workers AI。
- 不依赖 VPS、Docker、Postgres、Node 常驻进程或本地文件系统。

## 总体方向

FlareMo 以 Memos 作为生态锚点，但不复制 Memos 的内部实现。

这意味着：

- Memos 的领域模型、资源命名、`/api/v1` 协议、OpenAPI、导入导出和 MCP 方向，是 FlareMo 的对外兼容目标。
- FlareMo 的内部实现围绕 Cloudflare Workers、D1、R2、Drizzle、Hono 和 TypeScript 重建。
- 产品体验更接近 Flomo：更快记录、更安静的时间线、更轻的导航、更少后台感和社交感。
- Blinko 和 MeowNocode 只作为功能参考，不作为架构基底。

当前参考项目的权重：

- `usememos/memos`：MIT，生态最大，是模型、API 和兼容层的主参考。
- `blinkospace/blinko`：GPL-3.0，适合作为 AI 检索、附件、引用、编辑器交互参考，不适合复制源码作为基底。
- `XuYouo/MeowNocode`：MIT，适合作为轻量 Cloudflare/D1 笔记应用参考。

FlareMo 的实际目标不是“能导入 Memos 数据的普通笔记 App”，而是“Cloudflare-native 的 Memos-compatible 个人知识系统”。

## 参考项目定位

### Memos

Memos 是 FlareMo 的主要生态和兼容目标。

值得借鉴：

- 清晰的 memo 领域模型：`content`、`visibility`、`pinned`、`row_status`、creator、created/updated timestamps。
- 用 `payload` / `property` 承载计算属性，例如 tags、link/task/code 标记、title、location。
- attachments、memo relations、shares、settings、identities 等独立模型。
- 时间线优先的产品思路。
- React Query 缓存和乐观更新策略。
- Markdown 渲染、编辑器拆分、过滤器、标签、统计、分享图等前端经验。
- OpenAPI 和 MCP 方向。

不能照搬：

- Go 单体服务。
- Echo `http.Server`。
- `database/sql` 和本地 SQLite/Postgres/MySQL 驱动。
- 本地文件服务。
- SSE 连接管理。
- 后台 runner。
- 多数据库抽象和实例管理后台。

Memos 对 FlareMo 来说是协议、生态和产品模型参考，不是运行时模板。

### Blinko

Blinko 是功能参考，不是架构基底。

值得借鉴：

- 普通搜索升级到 AI / vector search 的产品路径。
- 附件和 note reference 的交互。
- note history、internal share、public share、archive/recycle 等状态设计。
- 编辑器里的 draft persistence、file drop、references、quick capture、hotkeys。
- embedding pipeline：chunk note content、embed、mark indexed、rebuild index。

不能照搬：

- Bun/Node 后端。
- Prisma + Postgres。
- 过宽的全量应用模型：comments、follows、notifications、plugins、MCP servers、AI providers、conversations、scheduled tasks、fonts。
- GPL-3.0 代码。

### MeowNocode

MeowNocode 是轻量 Cloudflare/D1 参考。

值得借鉴：

- React + Vite 的轻量前端。
- Cloudflare D1 部署路径。
- 基础 memo/settings CRUD。
- 本地优先、导入导出、延迟同步思路。
- heatmap、daily review、backlinks、canvas mode、public/private toggle 等轻功能。

不能照搬：

- 松散 schema。
- 共享密码式鉴权。
- 客户端过重的同步逻辑。
- 大量二级功能直接混在主页面状态里。

## Cloudflare-native 边界

FlareMo 首先是一个完整可用的笔记和知识管理系统，不是 Cloudflare 全家桶展示项目。

核心路径必须稳定依赖：

- Workers
- Workers Static Assets
- D1
- Drizzle
- Wrangler
- R2

其他 Cloudflare 产品按能力边界使用，不作为数据库替代品：

- KV：只在出现明确缓存或配置需求时使用。
- Durable Objects：只在实时同步、协作、WebSocket、强一致限流或用户级协调真的需要时使用。
- Queues / Cron：只在链接预览、导出生成、embedding、清理、定期回顾等异步任务出现时使用。
- Vectorize：只在实现语义搜索时使用。
- Workers AI：只在实现 AI 功能时使用。

## 认证架构

Better Auth 是 FlareMo 的应用层认证事实源，按请求使用当前 Worker 的 D1 binding 构建，避免把过期或缺失的 binding 捕获在模块级状态中。

当前认证流分成三个互不混淆的边界：

```text
浏览器
  Better Auth username/password
  -> HttpOnly、SameSite=Lax cookie session
  -> auth_user_links
  -> 既有 users/owner 和业务数据

脚本 / Memos 客户端 / MCP
  Authorization: Bearer memos_pat_...
  -> Better Auth API Key plugin
  -> auth_user_links
  -> 既有 FlareMo domain user

公开分享
  share token + expiration + memo state
  -> public share data only
```

首次安装只允许通过 `FLAREMO_BOOTSTRAP_SECRET` 保护的一次性 owner bootstrap 创建账号；正常 Better Auth signup 被关闭。bootstrap 成功后，Better Auth 用户通过 `auth_user_links` 映射到既有的 `users/owner`，不重写 memo、attachment、R2 object key 或 share token。未来多用户可以增加更多映射对，但不需要改变现有资源 ID。

PAT 由 cookie session 或 Better Auth session bearer 下的账户接口创建、列出和撤销，明文只在创建响应返回一次；`memos_pat_` 本身只能访问私有业务数据，不能调用账户 PAT 管理接口。`memos_pat_` 是 FlareMo-native credential，用于保护当前兼容 API 子集，不代表 Memos Server 的完整 auth parity。

当前没有 email provider，因此 Better Auth 的自助忘记密码流程保持关闭。已完成 bootstrap 的单用户实例可以临时配置独立 `FLAREMO_RECOVERY_SECRET`，只针对已存在的 owner 进入 Better Auth reset-password 流程；成功时撤销全部 session 和 PAT，不创建第二个用户。该 secret 不是登录凭据，恢复结束后必须立即轮换或删除。

Cloudflare Access 可以在这三层之前作为外层 policy。它只负责入口门禁，Access identity 或 Service Token 不会自动提供 FlareMo 应用用户身份；启用时请求仍需 cookie session 或 PAT。公开分享可在 Access 上对最窄路径做 bypass，但不跳过 FlareMo share token 校验。

### 按凭据区分的 Origin policy

`FLAREMO_PUBLIC_URL` 加上可选的 `FLAREMO_TRUSTED_ORIGINS` 形成精确 origin allowlist。cookie session 的状态变更请求（`POST`、`PATCH`、`DELETE` 等非安全方法）必须携带并命中该 allowlist；缺失或不匹配时返回 `403`。PAT/Bearer 请求允许无 Origin，以支持桌面脚本和 MCP；如果 PAT 请求带有 Origin，则同样必须命中 allowlist，否则返回 `403`。

该校验只比较完整 origin，不接受 wildcard，也不把 `Referer` 或 Access headers 当作 Origin。它遵循 [Memos 0.30 MCP 文档](https://usememos.com/docs/integrations/mcp) 的 browser-origin 安全方向。当前 `/api/v1` 默认是 current camelCase wire，并提供根 `/mcp` 无状态 Streamable HTTP MCP 子集；这些是有限兼容面，不等于完整 Memos Server parity。

## Memos 兼容策略

兼容不是口号，而是产品能力。

### 数据兼容

- 采用 Memos 风格的核心实体：users、memos、memo relations、attachments、shares、settings。
- 保留 Memos 资源命名习惯：`memos/{id}`、`users/{id}`、`attachments/{id}`。
- 保留可映射到 Memos 的 payload/property 结构：tags、title、has_link、has_task_list、has_code、has_incomplete_tasks、location。
- 提供 Memos 数据导入导出路径。

### REST API 兼容

FlareMo 对外暴露 Memos-compatible `/api/v1`。公共兼容面包括：

- `POST /api/v1/memos`
- `GET /api/v1/memos`
- `GET /api/v1/{name=memos/*}`
- `PATCH /api/v1/{memo.name=memos/*}`
- `DELETE /api/v1/{name=memos/*}`
- `PATCH /api/v1/{name=memos/*}/attachments`
- `GET /api/v1/{name=memos/*}/attachments`
- `PATCH /api/v1/{name=memos/*}/relations`
- `GET /api/v1/{name=memos/*}/relations`
- `POST /api/v1/{parent=memos/*}/shares`
- `GET /api/v1/shares/{share_id}`
- `POST /api/v1/attachments`
- `GET /api/v1/attachments`
- `GET /api/v1/{name=attachments/*}`
- `GET /api/v1/{name=attachments/*}/blob`
- `DELETE /api/v1/{name=attachments/*}`
- `GET /api/v1/export`
- `POST /api/v1/import`
- `GET /openapi.json`
- `POST /api/v1/mcp`
- `POST /mcp` stateless Streamable HTTP MCP subset

同时支持：

- 应用层由 Better Auth cookie session 或 `memos_pat_` PAT 负责认证。
- 默认 `/api/v1` 使用 current camelCase/protobuf-JSON subset；旧 snake_case wire 通过 `X-FlareMo-Wire: legacy` 或 legacy vendor `Accept` 显式选择。
- current auth facade 由 Better Auth 提供身份事实源，并返回 Memos 风格 HS256 access JWT；`memos_refresh` 是 HttpOnly、轮换并可撤销的 refresh cookie。旧 opaque Better Auth session bearer 仍保留兼容。
- Cloudflare Access 是可选的外层 policy；启用时脚本和工具要同时携带 Access Service Token 与 FlareMo PAT。
- 常见分页参数：`page_size`、`page_token`。
- 常见排序参数：`order_by`。
- 常见状态过滤：`state`。
- 常见 filter 表达式。

Access Service Token 只属于 Cloudflare Access 层，不进入 FlareMo 用户
映射。生产实例如启用 Access，应在 Access application 上配置
`non_identity` policy，并用 `service_token` selector 绑定允许访问的 token；
客户端还要发送 FlareMo PAT：

```bash
CF-Access-Client-Id: <client id>
CF-Access-Client-Secret: <client secret>
Authorization: Bearer <memos_pat_...>
```

公开分享路径单独处理。`/share/*`、`/api/public/shares/*` 和 `/assets/*`
需要在 Cloudflare Access application 上配置 `bypass` policy，让未登录
访问者能打开分享页并加载前端静态资源。这个旁路只针对公开分享入口；
分享内容仍由 FlareMo 的 share token、过期时间和 memo 状态校验控制。

### 生态兼容

- 为 FlareMo 暴露的 `/api/v1` 维护 OpenAPI 文档。
- 基于 OpenAPI 暴露 MCP endpoint。
- 响应字段在支持范围内保持 Memos-compatible。
- UserService webhook 资源的 CRUD/signing-secret 已进入兼容层；四类 memo 事件已有 D1 outbox 的有界异步投递/重试，完整上游事件语义、egress SSRF 防护和完整多用户 ACL 仍是未完成边界。
- current camelCase wire、Better Auth-backed identity、native JWT/refresh facade、字段/错误翻译、PAT/social 资源、UserService webhook/notification 资源子集、Connect JSON/protobuf/gRPC-Web unary subset、heartbeat SSE 和根 `/mcp` 无状态 Streamable HTTP MCP 子集已实现并有仓库测试；这些仍不等于完整 Memos Server、原生 HTTP/2 gRPC 或第三方客户端 parity。

### 兼容边界

FlareMo 兼容 Memos 生态，不复制 Memos 服务端历史包袱。comments、reactions、shortcuts 和 UserService webhook/notification 已有有限实现，四类 memo 事件已有有界 outbox 投递/重试，但完整 Connect/gRPC、复杂 CEL filter、instance settings、SSO、完整上游 social/notification service 语义、完整 webhook 事件/egress 语义、完整多用户 ACL、admin surfaces、SSE、有状态 MCP session 和第三方客户端实测仍未完成；这些能力只有在它们确实服务 FlareMo 产品目标时才进入实现，不为了追求字面 parity 复制复杂度。

## API 分层

FlareMo 有两层 API。

### `/api/v1/*`

Memos-compatible API surface。除公开分享和 OpenAPI 入口外，业务请求需要 Better Auth cookie session 或 `memos_pat_` PAT。

用于：

- Memos-compatible clients
- 数据迁移
- 导入导出
- 脚本和自动化
- OpenAPI
- MCP

### `/api/app/*`

FlareMo 自己的前端 API。

这一层可以更简单、更贴近 Cloudflare 运行时，但必须复用同一套 domain services 和 Drizzle-backed repositories。不能维护两套业务实现。

## 数据模型

D1 是唯一的主数据库，Drizzle schema 是数据库结构事实源。

核心表从 FlareMo 自己的领域模型出发，同时保留到 Memos DTO 的 adapter 路径：

```sql
users
  id TEXT PRIMARY KEY
  email TEXT UNIQUE
  name TEXT
  avatar_url TEXT
  created_at TEXT
  updated_at TEXT

memos
  id TEXT PRIMARY KEY
  user_id TEXT NOT NULL
  content TEXT NOT NULL
  visibility TEXT NOT NULL DEFAULT 'private'
  status TEXT NOT NULL DEFAULT 'normal'
  pinned INTEGER NOT NULL DEFAULT 0
  source TEXT DEFAULT 'web'
  payload TEXT NOT NULL DEFAULT '{}'
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL

memo_relations
  memo_id TEXT NOT NULL
  related_memo_id TEXT NOT NULL
  type TEXT NOT NULL
  PRIMARY KEY (memo_id, related_memo_id, type)

attachments
  id TEXT PRIMARY KEY
  user_id TEXT NOT NULL
  memo_id TEXT
  r2_key TEXT NOT NULL
  filename TEXT NOT NULL
  content_type TEXT
  size INTEGER NOT NULL DEFAULT 0
  payload TEXT NOT NULL DEFAULT '{}'
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL

shares
  id TEXT PRIMARY KEY
  memo_id TEXT NOT NULL
  user_id TEXT NOT NULL
  token TEXT UNIQUE NOT NULL
  expires_at TEXT
  created_at TEXT NOT NULL

settings
  user_id TEXT NOT NULL
  key TEXT NOT NULL
  value TEXT NOT NULL
  PRIMARY KEY (user_id, key)
```

Better Auth 的认证表与上述领域表隔离保存：`auth_users`、`auth_sessions`、`auth_accounts`、`auth_verifications`、`auth_apikeys`、`auth_user_links` 和 `auth_bootstrap`。`auth_user_links` 是 auth identity 到 FlareMo domain user 的唯一桥接；保留这层边界可以在未来增加用户映射时不改变既有 memo、attachment 和 share 资源 ID。

payload 示例：

```json
{
  "tags": ["idea", "work"],
  "property": {
    "title": "",
    "has_link": true,
    "has_task_list": false,
    "has_code": false,
    "has_incomplete_tasks": false
  },
  "location": null,
  "client_id": "optional-offline-id"
}
```

设计原则：

- `content`、`visibility`、`status`、`pinned`、`created_at`、`updated_at` 是列。
- 附件二进制不进 D1，只在 D1 存 R2 key 和元数据。
- 向量库或 AI 知识库只存派生索引，不能存权威笔记。
- 语义搜索返回后必须回 D1 读取权威 memo。

## 前端方向

FlareMo 的前端以 Flomo 式快速收集为中心，不做重后台感。

第一屏应该是：

- 快速输入框
- 时间线
- 搜索
- 标签
- 基础统计或 activity calendar

产品能力包括：

- 反链
- 附件
- 分享
- 导入导出
- 每日/每周回顾
- 语义搜索
- 问我的笔记

避免：

- 把首页做成管理后台。
- 一上来引入社交、评论、通知等复杂面。
- 音乐、背景图等装饰功能进入核心路径。
- AI 功能压过基础记录体验。

## AI 和语义搜索

AI 和语义搜索是 FlareMo 个人知识管理能力的一部分，但不能成为权威数据源。

基础搜索由 D1 中的权威笔记、标签、时间和状态字段提供。

详细语义搜索边界见 [semantic-search.md](./semantic-search.md)。

语义搜索由 Vectorize 承载派生索引：

- memo 内容切块。
- 生成 embedding。
- 写入 Vectorize。
- 索引记录引用 D1 中的 memo。
- 搜索命中后回 D1 读取权威 memo 数据。

AI 工作流围绕个人知识库展开：

- 问我的笔记。
- 每日/每周回顾。
- 相关笔记推荐。
- 附件文本抽取。
- AI 标签建议。

## 工程顺序

下面是依赖顺序，不是产品分期，也不是功能降级。FlareMo 的目标始终是完整产品。

1. 建立 monorepo 和 Workers + Vite + Hono + D1 + Drizzle 基础。
2. 定义 Drizzle schema 和 D1 migrations。
3. 建立 domain services：users、memos、attachments、relations、shares、settings、tokens。
4. 实现 `/api/v1` Memos-compatible 核心 memo endpoints。
5. 实现 Flomo-like capture + timeline + search + tags。
6. 实现 Memos 导入导出。
7. 接入 R2 附件和导出包。
8. 维护 OpenAPI。
9. 基于 OpenAPI 增加 MCP。
10. 接入 Vectorize 和 AI 能力。

## 结论

FlareMo 的架构核心是：

**面向 Memos 生态的兼容 API + Better Auth + FlareMo-native internal model + Cloudflare Workers runtime + D1/Drizzle source of truth。**

对外吃 Memos 生态，对内保持干净，不复制 Memos 的历史包袱，也不为了凑技术栈而引入 Cloudflare 全家桶。
