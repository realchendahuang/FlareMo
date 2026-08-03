# Memos 兼容矩阵

FlareMo 是一个运行在 Cloudflare Workers 上的 Memos-compatible 个人知识系统，不是 Memos Server 的 Go fork。当前默认公开的是 current Memos 风格的 camelCase / protobuf-JSON REST 子集，同时保留旧 FlareMo snake_case wire 作为显式兼容模式；根路径 `/mcp` 提供无状态 Streamable HTTP MCP 子集。

这意味着当前可以把 FlareMo 当作“内核不同、对外协议尽量兼容”的实现，但不能宣称已经完成完整 Memos Server parity。第三方客户端、Memos 官方客户端和周边工具仍必须逐一真实连接验证；仓库自己的 contract tests 不能替代真实客户端 smoke test。实测记录见 [memos-ecosystem.md](./memos-ecosystem.md)。

## Wire 模式

| 模式 | 选择方式 | 说明 |
| --- | --- | --- |
| current（默认） | 不加 header；或 `X-FlareMo-Wire: current` | 使用 camelCase 字段、大写 protobuf 风格枚举和 current 标准错误。 |
| legacy | `X-FlareMo-Wire: legacy`；或 `Accept: application/vnd.flaremo.legacy+json` | 保留既有 FlareMo snake_case API，供旧脚本和旧客户端迁移使用。 |

current REST 的资源名仍使用 Memos 风格，例如 `memos/{id}`、`attachments/{id}`、`users/{id}`。`GET /openapi.json` 默认返回 current OpenAPI；显式 legacy wire 时返回旧文档。

## 认证边界

Better Auth 是应用层认证事实源，Cloudflare Access 只能作为可选外层 policy，不能映射成 FlareMo 用户身份。

| 入口 | 当前认证方式 | 兼容说明 |
| --- | --- | --- |
| Web / Better Auth | 用户名 + 密码，登录后使用 `HttpOnly` cookie session | 当前是一套单用户 bootstrap；公共 signup 关闭，数据模型保留未来用户映射边界。 |
| current auth facade | `POST /api/v1/auth/signin`、`refresh`、`signout`，以及 `GET /api/v1/auth/me` | 由 Better Auth session/account 数据驱动；`accessToken` 是 opaque session-backed token，不是 Memos 原生 JWT。 |
| `/api/v1/*` 私有 API | cookie session，或 `Authorization: Bearer memos_pat_...` | PAT 由已登录账户创建、只在创建时显示一次、可撤销，并由 Better Auth API key/plugin 数据承载。 |
| current PAT 资源 | `/api/v1/users/{user}/personalAccessTokens` | 提供当前用户的 list/create/revoke 基础；不是 Memos 原生 JWT/refresh-token parity。 |
| root `/mcp` | cookie session、Better Auth session bearer，或 `memos_pat_` PAT | Streamable HTTP 是无状态 JSON 响应子集，不创建 MCP session。 |
| Origin policy | cookie session 状态变更必须携带并精确匹配 `FLAREMO_PUBLIC_URL` / `FLAREMO_TRUSTED_ORIGINS`；PAT 可无 Origin，带 Origin 时同样必须匹配 | 缺失或不可信 Origin 返回 `403`；Access headers 不替代应用层 Origin。 |
| Cloudflare Access | 可选外层 policy / Service Auth | Access 只解决外层网络门禁；启用时仍要提供上面的 cookie、session bearer 或 PAT。 |

## 已实现的 current 子集

### REST 路由

| 能力 | 状态 | current 路径 / 说明 |
| --- | --- | --- |
| current 用户 | 已实现 | `GET /api/v1/auth/me`、`GET /api/v1/users`、`GET /api/v1/users/{user}`。 |
| Better Auth 登录 facade | 已实现子集 | `POST /api/v1/auth/signin`、`POST /api/v1/auth/refresh`、`POST /api/v1/auth/signout`；返回 Better Auth-backed opaque token。 |
| 创建/列表 memo | 已实现子集 | `POST /api/v1/memos`、`GET /api/v1/memos`；支持 `pageSize`、`pageToken`、有限 `orderBy` 和有限 filter。 |
| memo 详情/更新/删除 | 已实现子集 | `GET/PATCH/DELETE /api/v1/memos/{memo}`；支持 current `{ memo: {...} }` body wrapper、`updateMask` 和 `memoId` 明确拒绝。 |
| memo 状态与可见性 | 已实现映射 | `NORMAL`、`ARCHIVED`、`PRIVATE`、`PROTECTED`、`PUBLIC`；FlareMo 的 trash/deleted 与 current Memos 状态模型不完全相同。 |
| memo 属性 | 已实现子集 | `tags`、`property`、`location`、`snippet` 以及基本字段映射。 |
| memo 附件绑定 | 已实现子集 | `GET/PATCH /api/v1/memos/{memo}/attachments`；PATCH 主要是替换 memo 的附件集合，不是完整 Attachment update parity。 |
| memo relations | 已实现子集 | `GET/PATCH /api/v1/memos/{memo}/relations`；返回 nested `memo` / `relatedMemo` DTO 和 current relation enum。 |
| memo shares | 已实现子集 | `GET/POST /api/v1/memos/{memo}/shares`、`DELETE /api/v1/memos/{memo}/shares/{share}`；current share name 使用 `memos/{id}/shares/{token}` 兼容形态。 |
| 匿名 share 读取 | 已实现 | `GET /api/v1/shares/{share_id}`；仍由 share token、过期时间和 memo 状态控制。 |
| 附件资源 | 已实现子集 | `GET/POST /api/v1/attachments`、`GET/PATCH/DELETE /api/v1/attachments/{attachment}`；支持 current `{ attachment: {...} }` wrapper，`attachmentId` 明确拒绝。 |
| 附件列表 | 已实现子集 | 返回 `attachments`、可选 `nextPageToken`；`size` 按 protobuf JSON 以十进制字符串输出。 |
| PAT 资源 | 已实现基础 | `GET/POST /api/v1/users/{user}/personalAccessTokens`、`DELETE /api/v1/users/{user}/personalAccessTokens/{token}`。 |
| 标准错误 | 已实现 | current 错误使用 `{ code, message, details }`，不把 FlareMo 内部异常直接暴露给客户端。 |
| current OpenAPI | 已实现 | `GET /openapi.json`、认证后 `GET /api/v1/openapi.json`；文档显式描述 current/legacy wire、认证和 `/mcp`。 |

### 有限 filter / order 支持

为了保持 Workers 上的安全和可预测性，current adapter 不解释任意 CEL。当前只接受已经实现并测试的有限表达式，例如：

```text
content.contains("...")
tags.exists(t, t == "...")
pinned == true
visibility == "PUBLIC"
```

`orderBy` 当前只支持单字段的 `create_time` / `update_time` asc/desc 子集。未支持的 filter 或排序会返回 current 标准错误，而不是静默改变语义。

### 根 `/mcp`

`POST /mcp` 是无状态 JSON Streamable HTTP MCP 子集，支持协议版本 `2025-03-26` 和 `2024-11-05`，核心方法为：

- `initialize`
- `notifications/initialized`
- `tools/list`
- `tools/call`

current 工具名使用 `memo_`、`attachment_`、`auth_` 前缀，覆盖 memo CRUD、memo attachments、memo relations、附件 list/get/delete 和 current user。成功结果同时提供 text content 与 object-shaped `structuredContent`；工具执行失败保留在 MCP result 的 `isError: true` 中。

`/mcp` 当前是无状态 JSON response，不承诺 SSE、MCP session、完整 method surface 或所有第三方 MCP client 的实测兼容。旧的 `POST /api/v1/mcp` JSON-RPC 工具名继续保留，供已有 FlareMo 客户端使用。

## 仍未完成或未验证

以下能力不能写成“完整兼容”：

- 完整 Memos Server parity，以及完整 Connect/gRPC parity。
- 完整 CEL filter、复杂分页/排序和附件 filter/order/page-token 语义。
- current attachment batch delete，以及超出 memo binding subset 的 Attachment update。
- Memos comments、reactions、shortcuts、notifications、admin/instance surfaces。
- SSE 和有状态 MCP session 行为。
- Memos 原生 JWT、refresh token 及其字节级认证 parity；FlareMo `accessToken` 是 opaque Better Auth session-backed token。
- 官方 Memos 客户端、MemoFlow、Dynos、Raycast、浏览器插件等第三方客户端的真实 smoke test。
- Cloudflare Access policy 本身的配置正确性；它是部署环境外层策略，不是 FlareMo 应用协议。

## 兼容测试目标

每次扩大兼容面，都要补测试：

- DTO 字段映射、current 大写枚举和标准错误。
- resource name parser、nested relation/share DTO。
- 分页、有限排序和不支持 filter 的拒绝行为。
- import/export roundtrip。
- 附件上传、列表、绑定和下载。
- share token 隔离以及匿名读取。
- OpenAPI current/legacy wire negotiation。
- Better Auth cookie、session bearer、PAT Bearer、PAT 撤销和公开分享边界。
- `/mcp` initialize、tools/list、tools/call 和工具错误 envelope。

这些仓库测试证明的是 FlareMo 自己的协议契约，不等于第三方客户端已经可用。第三方连接结果必须回写到 [memos-ecosystem.md](./memos-ecosystem.md)，未真实连接的客户端只能标记为“未测”。
