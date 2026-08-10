# Memos 兼容矩阵

> 矩阵快照：2026-08-05。本页按当前工作树、当前 `git diff` 和仓库测试整理；它描述的是 FlareMo 的兼容边界，不是对任意 Memos 客户端的线上承诺。

FlareMo 是运行在 Cloudflare Workers 上的个人知识系统，不是 Memos Server 的 Go fork。它的定位是“内核不同、对外协议尽量兼容”：应用层使用 Better Auth，数据由 D1/Drizzle 和 R2 承载，并提供 Memos 风格 current camelCase REST、旧 FlareMo legacy wire、基于 pinned upstream schema 的 generated Connect/protobuf unary adapter、有限 SSE 和无状态 Streamable HTTP MCP。官方 Memos generated Connect client 已在隔离的本地 Wrangler Worker 上完成 binary unary smoke，并对生产域名完成匿名 `ListMemos` binary smoke；这仍不是完整 Memos Server parity 或官方 Web/第三方客户端线上兼容证明。

当前可以准确地说 FlareMo 已经有 Better Auth 原生鉴权、Memos 风格 access/refresh token、可撤销 `memos_pat_` PAT，以及 Memo/Auth/Shortcut 为主并扩展到 Attachment、单用户 UserService（含 webhook/notification 子集）、Instance 和空 IdentityProvider 列表的兼容基础。不能宣称已经完成完整 Memos Server parity，也不能把仓库 contract tests 写成官方 Web 或第三方客户端已经可用。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| 已实现 | 当前工作树存在对应 Worker/domain handler；不代表所有字段、错误、ACL 或 wire transport 都与上游一致。 |
| 已测试 | 仓库中的测试对该路径或边界做了断言；这些是 FlareMo contract tests，不是第三方客户端 smoke。 |
| 仅静态审计 | 只检查了当前参考快照中的 Memos proto/generated client 或第三方客户端源码，没有用该客户端真实请求 FlareMo。 |
| 未实现 | 当前没有对应 handler，或 handler 明确返回 `501`。 |
| 未验证 | 代码路径存在，但没有足够的端到端、generated client 或线上证据支撑“兼容”。 |

## 总体矩阵

| 能力面 | 代码状态 | 仓库测试状态 | 当前结论 |
| --- | --- | --- | --- |
| Better Auth 原生登录、单用户 bootstrap、cookie session | 已实现 | 已测试 | 应用层身份事实源是 Better Auth；不是 Cloudflare Access identity。 |
| Memos 风格 sign-in/refresh/sign-out facade | 已实现 | 已测试 | 返回 FlareMo 生成的 HS256 access JWT，并轮换 `memos_refresh`；不是 Memos JWT 的字节级 parity。 |
| `memos_pat_` Personal Access Token | 已实现 | 已测试 | PAT 可创建、列出、撤销；明文只在创建响应中出现一次。 |
| current camelCase REST | 已实现 | 已测试 | memo、attachment、social、share、PAT 和有限 filter/order 的子集。 |
| Connect JSON unary | 已实现 | 已测试 | 主要服务以及单用户 UserService 的 webhook/notification 资源有 Worker contract 覆盖。 |
| protobuf / gRPC-style / gRPC-Web unary | generated schema + unary adapter | 已测试子集 | 普通上游 RPC 使用 pinned generated schema/runtime；仍是 Worker 上的单帧 unary adapter，不是原生 HTTP/2 gRPC server，也未达到完整服务语义 parity。 |
| SSE | 已实现 | 已测试 | D1 outbox + polling + cursor replay 的 FlareMo 实现；不是上游进程内 SSEHub parity。 |
| Streamable HTTP MCP | 已实现 | 已测试 | 根 `/mcp` 是无状态 JSON 子集；不承诺有状态 session、SSE 或完整工具面。 |
| 官方 Memos generated Connect client | 已验证子集 | 已测（local + production anonymous smoke） | 当前可重跑的 generated-client 测试直接覆盖 `MemoService` 的 Connect/gRPC-Web binary CRUD/read 子集，以及 `UserService` webhook/notification 的 Connect/gRPC-Web binary 子集；生产仅验证匿名 `MemoService/ListMemos`，不是完整 parity。历史文档中更宽的方法清单需要重新跑出源码证据后才能恢复。 |
| 官方 Memos Web、第三方客户端 | 未验证 | 未测 | 官方 Web 仍只有源码静态审计；第三方候选见 [memos-ecosystem.md](./memos-ecosystem.md)，没有真实客户端 smoke 记录。 |
| 完整 Memos Server parity | 未实现 | 未验证 | 当前明确不能宣称完成。 |

## Wire 模式

| 模式 | 选择方式 | 说明 |
| --- | --- | --- |
| current（默认） | 不加 header；或 `X-FlareMo-Wire: current` | 使用 camelCase 字段、大写 protobuf 风格枚举和 current 标准错误。 |
| legacy | `X-FlareMo-Wire: legacy`；或 `Accept: application/vnd.flaremo.legacy+json` | 保留既有 FlareMo snake_case API，供旧脚本和旧客户端迁移使用。 |

current REST 的资源名使用 Memos 风格，例如 `memos/{id}`、`attachments/{id}`、`users/{id}`。`GET /openapi.json` 默认返回 current OpenAPI；显式 legacy wire 时返回旧文档。

## 认证边界

Better Auth 是应用层认证事实源，Cloudflare Access 只能作为可选外层 policy，不能映射成 FlareMo 用户身份。

| 入口 | 当前认证方式 | 兼容说明 |
| --- | --- | --- |
| Web / Better Auth | 用户名 + 密码，登录后使用 `HttpOnly` cookie session | 当前是一套单用户 bootstrap；公共 signup 关闭，认证表和 `auth_user_links` 为未来多用户保留扩展边界。 |
| current auth facade | `POST /api/v1/auth/signin`、`refresh`、`signout`，以及 `GET /api/v1/auth/me` | Better Auth 提供身份和账户事实源；signin 返回 FlareMo 生成的 Memos 风格 HS256 access JWT，并设置轮换的 `memos_refresh` HttpOnly cookie。旧 Better Auth session bearer 仍保留兼容。 |
| `/api/v1/*` 私有 API | cookie session，或 `Authorization: Bearer memos_pat_...` | PAT 由已登录账户创建、只在创建时显示一次、可撤销，并由 Better Auth API key/plugin 数据承载。native JWT 和 PAT 是两种明确的应用凭据。 |
| current PAT 资源 | `/api/v1/users/{user}/personalAccessTokens` | 提供当前用户的 list/create/revoke 基础；`memos_pat_` 本身不能管理 PAT。 |
| 根 `/mcp` | cookie session、Better Auth session bearer、FlareMo native access JWT，或 `memos_pat_` PAT | Streamable HTTP 是无状态 JSON 子集，不创建 MCP session。 |
| Origin policy | cookie session 状态变更必须携带并精确匹配 `FLAREMO_PUBLIC_URL` / `FLAREMO_TRUSTED_ORIGINS`；PAT 可无 Origin，带 Origin 时同样必须匹配 | 缺失或不可信 Origin 返回 `403`；Access headers 不替代应用层 Origin。 |
| Cloudflare Access | 可选外层 policy / Service Auth | Access 只解决外层网络门禁；启用时仍要提供上面的 cookie、session bearer、native JWT 或 PAT。 |

## current REST 矩阵

| 能力 | 代码状态 | 仓库测试状态 | current 路径 / 边界 |
| --- | --- | --- | --- |
| current 用户与 auth facade | 已实现 | 已测试 | `GET /api/v1/auth/me`、`POST /api/v1/auth/signin`、`refresh`、`signout`；`memos-compatibility.test.ts`、`auth.test.ts` 覆盖账户和凭据边界。 |
| memo 创建、列表、详情、更新、删除 | 已实现 | 已测试 | `POST/GET /api/v1/memos`、`GET/PATCH/DELETE /api/v1/memos/{memo}`；支持 current `{ memo: {...} }` wrapper、有限 `pageSize`、`pageToken`、`orderBy`、filter 和 `updateMask`。 |
| memo 字段、状态、可见性、tags、property、location | 已实现 | 已测试 | 已做 DTO/枚举映射；FlareMo 的 trash/deleted 与 current Memos 状态模型并非完全相同。 |
| memo 附件、relations、comments、reactions | 已实现 | 已测试 | `memos/{memo}/attachments`、`relations`、`comments`、`reactions` 的 current 子集；完整上游资源语义仍未证明。 |
| attachment 资源 | 已实现子集 | 已测试 | `GET/POST /api/v1/attachments`、`GET/PATCH/DELETE /api/v1/attachments/{attachment}`；支持 current wrapper、R2 blob 和 memo 绑定，客户端指定 `attachmentId` 仍明确拒绝。官方 Memos Web 预期的 `/file/attachments/{id}/{filename}` 私有/分享读取也已接入；任意 `externalLink` 持久化、缩略图和 motion 转换仍未实现。 |
| shortcuts | 已实现 | 已测试 | `GET/POST /api/v1/users/{user}/shortcuts` 及单项 CRUD；覆盖有限 CEL 校验、`validateOnly` 和 `updateMask`。 |
| memo shares | 已实现 | 已测试 | `GET/POST /api/v1/memos/{memo}/shares`、`DELETE`；匿名读取仍由 share token、过期时间和 memo 状态控制。 |
| current PAT 资源 | 已实现 | 已测试 | `/api/v1/users/{user}/personalAccessTokens` 的 list/create/revoke；PAT 不能反过来管理 PAT。 |
| link metadata | 已实现 | 已测试 | Connect `GetLinkMetadata` / `BatchGetLinkMetadata` 提供受限 Open Graph 抓取；限制 HTTP(S)、redirect、HTML 大小和内网字面量地址。完整 DNS rebinding/egress policy 仍是部署边界。 |
| 标准错误 | 已实现 | 已测试 | current 错误使用 `{ code, message, details }`；Better Auth 无效凭据映射为 Memos 风格 `400` / code `3`。 |
| current OpenAPI | 已实现 | 已测试 | `GET /openapi.json` 及认证后的 current 文档；`memos-compatibility.test.ts` 检查 current/legacy wire 文档和主要路径。 |

### current filter / order 边界

为了保持 Workers 上的安全和可预测性，current adapter 不解释任意 CEL。当前只接受已经实现并测试的有限表达式，例如：

```text
content.contains("...")
tags.exists(t, t == "...")
pinned == true
visibility == "PUBLIC"
size(content) > 100
created_ts.getFullYear() == 2026
created_ts >= timestamp(1704067200)
updated_ts < now - duration("1h")
```

当前还支持 `size(content)`、`size(tags)`、上游 timestamp accessor（不接受 timezone 参数）、epoch integer timestamp，以及 `now`/`duration` 的时间算术。`orderBy` 当前只支持单字段的 `create_time` / `update_time` asc/desc 子集。未支持的 filter 或排序会返回 current 标准错误，而不是静默改变语义。大小写、RE2 与 JavaScript regex、`name` 变量、复杂宏、完整分页和大数据量 bounded execution 仍未完成上游对照。层级 tag 已实现：内容提取支持 `#父/子` 路径，`ListMemos` 的 `tag` 参数按前缀匹配（`工作` 命中 `工作/*`），前端 explorer 提供多级标签树、重命名/移动（含子树）与删除。

普通 `GetMemo`、`ListMemos`、comments、reactions、memo relations 和 memo attachments 已经有独立的 optional viewer：匿名只读 `PUBLIC + NORMAL`，认证用户继续使用 Better Auth/PAT 的 owner-scoped 读取；创建、更新、删除和 share/social mutation 仍需认证。User profile/stats 的完整 public projection 尚未实现，不能把这一段扩大成完整 Memos ACL parity。

## Connect / protobuf / gRPC-Web 矩阵

Worker 提供 canonical `memos.api.v1/{Service}/{Method}` 的 HTTP unary adapter，接受：

- `application/json`：Connect JSON message。
- `application/proto`：Connect protobuf unary message。
- `application/grpc`、`application/grpc+proto`：单个未压缩 gRPC-style unary frame；Worker 目前把两种请求 media type 映射到同一个 protobuf codec。
- `application/grpc-web`、`application/grpc-web+proto`：单个未压缩 gRPC-Web protobuf frame。
- `application/grpc-web-text`、`application/grpc-web-text+proto`：单个未压缩 gRPC-Web protobuf frame 的 base64 文本形式。

普通上游 service/method 的 message 编解码使用 `apps/worker/src/memos-generated/` 中由 pinned Memos proto 生成的 `@bufbuild/protobuf` descriptor runtime；手写 `ProtoReader` / `ProtoWriter` 只保留给 FlareMo 历史 `GetSharedMemo` alias、错误/status framing 和没有上游 descriptor 的 fallback。能返回 unary frame 仍不等于原生 HTTP/2 gRPC server、完整 metadata/trailer、streaming 或完整服务语义 parity。

| 上游 service | 当前已接入方法 | 代码状态 | 仓库测试状态 | 重要边界 |
| --- | --- | --- | --- | --- |
| `MemoService` | `CreateMemo`、`ListMemos`、`GetMemo`、`UpdateMemo`、`DeleteMemo`；附件 binding；relations；comments；reactions；shares；`GetMemoByShare`；旧 `GetSharedMemo` alias；`GetLinkMetadata`、`BatchGetLinkMetadata` | 已实现子集 | 已测试 | JSON unary 和 generated protobuf/gRPC-Web framing 有覆盖；canonical `GetMemoByShare` 已有 JSON 测试。普通 memo RPC 仍需应用凭据。 |
| `AuthService` | `GetCurrentUser`、`SignIn`、`RefreshToken`、`SignOut` | 已实现子集 | 已测（Worker binary contract） | Better Auth 是身份事实源；native JWT/refresh 是 facade，不是上游 token 的字节级 parity；当前 auth binary 证据来自 Worker transport/codec 测试，不把它写成官方 generated Auth client smoke。 |
| `ShortcutService` | `ListShortcuts`、`GetShortcut`、`CreateShortcut`、`UpdateShortcut`、`DeleteShortcut` | 已实现 | 已测试 | 有 JSON、gRPC-Web framing 和 social contract 覆盖；filter 仍是有限 CEL。 |
| `AttachmentService` | `CreateAttachment`、`ListAttachments`、`GetAttachment`、`UpdateAttachment`、`DeleteAttachment`、`BatchDeleteAttachments` | 已实现子集 | 已测（Worker transport contract） | `ListAttachments` 支持有限 `pageToken`、`orderBy` 和 bounded CEL filename/mime/time/memo 过滤；当前 generated-client 测试没有直接覆盖 AttachmentService，不能写成官方 generated Attachment client smoke。update/batch delete、完整字段和上传语义仍未完成。只允许有限 memo 字段更新；外链、客户端指定 `attachmentId` 等能力明确拒绝。 |
| `UserService` | current user list/batch/get/update；stats；user settings；webhook CRUD/signing-secret；notification list/update/delete；PAT list/create/delete | 已实现子集 | 已测（Connect JSON + official generated binary/gRPC-Web 子集） | webhook secret 只由专用 RPC reveal，notification comment/mention payload 已接入；四类 memo 事件通过 D1 outbox 做有界异步投递/重试；完整上游 webhook 事件语义、egress SSRF 防护、完整多用户 ACL、linked identities 和用户生命周期仍未完成。 |
| `InstanceService` | `GetInstanceProfile`、`GetInstanceSetting`、`BatchGetInstanceSettings`、`UpdateInstanceSetting`、`GetInstanceStats`；`TestInstanceEmailSetting` 明确返回 `501` | 部分实现 | 已测（Worker transport contract） | profile、batch settings、stats 有 Worker contract 覆盖；当前 generated-client 测试没有直接覆盖 InstanceService，Storage/Tags/AI 等 setting oneof、更新和 email delivery 未完成。 |
| `IdentityProviderService` | `ListIdentityProviders` 返回空列表 | 仅有限实现 | 已测试（空列表） | 没有 OAuth2 provider CRUD 或 linked identity 流程；其余方法明确返回 `501`。 |
| `AIService` | 无可用业务实现；transcription 请求明确返回 `501` | 未实现 | 未验证 | protobuf codec 中存在字段映射代码不代表 AI provider 已配置或可调用。 |
| 其他 service / 未列出 method | 无 | 未实现 | 未验证 | route 对未知 service/method 返回 unimplemented，不做泛化伪成功。 |

`GetMemoByShare` 使用 canonical `shareId`；旧 `GetSharedMemo` 保留 `shareToken` 形态，目的是兼容已有 FlareMo 调用，不应把旧 alias 当成上游额外 RPC。

### binary transport 的已测与未测边界

已测证据包括：media type detection、upstream field number 的 `CreateMemo`/attachment/user 请求解码、Connect/gRPC/gRPC-Web/text gRPC-Web framing、部分 memo/shortcut/auth response bytes，以及 binary error body 与 `grpc-status` 的 code 对齐（例如 unauthenticated 为 `16`）。当前 `memos-connect-client.test.ts` 直接交给官方 generated decoder 的方法面是 MemoService 和 UserService 的列出子集；其余 service 的 response 证据仍是 Worker codec/contract 级别，不能升级成官方 generated client 端到端证明。

仍未验证或未实现的 binary 边界包括：

- Worker generated codec 已对 `InstanceSetting`/`UserSetting` oneof、notification payload、attachment `motionMedia` / `externalLink` 等字段做 focused roundtrip；UserService webhook CRUD/signing-secret、notification list/update/delete、comment/mention notification 生成，以及四类 memo 事件的 D1 outbox 投递/重试已有 bounded handler 和 local Connect/部分 generated-client 覆盖，但完整上游 webhook 事件语义、egress SSRF 防护、完整 notification filter/payload 语义和多用户 ACL 仍未完成。
- memo create/update 的完整时间、initial attachments/relations/location、完整 update mask、pagination token，以及 comments/reactions 的完整 response schema。
- Attachment update/batch delete、User/Instance/IdentityProvider 的未覆盖方法和完整 generated-client schema roundtrip；本次 smoke 只覆盖列出的 unary 子集。Attachment 列表的分页/排序/过滤是 FlareMo 的有限子集，不是完整 CEL parity。
- 官方 Memos Web 的 `/file/attachments/{id}/{filename}` 文件 URL bridge 已实现，支持 Better Auth/PAT/native access JWT 私有读取和 `share_token` 绑定的公开读取；`thumbnail=true` 目前返回原始对象，motion media 转换和任意 `externalLink` 持久化仍未完成。
- 原生 gRPC HTTP/2、完整 metadata/trailer、压缩、streaming RPC、取消和 deadline 语义；gRPC-Web unary 已有标准 data+trailer frame，但还没有官方浏览器 transport 的端到端证明。
- 官方 Memos Web 的真实浏览器请求、第三方客户端连接，以及 native HTTP/2 gRPC 的真实客户端验证。

## SSE 与 MCP

`GET /api/v1/sse` 是 authenticated `text/event-stream`。当前实现使用 D1 `memos_sse_events` outbox、5 秒 polling、`Last-Event-ID` cursor replay、连接注释和 30 秒 heartbeat；当前事件包括 memo create/update/delete、comment create、reaction upsert/delete。comment-created 事件按 pinned 上游语义把父 memo 放在 `name`，不额外写 `parent`；关系和附件绑定变更会与 `memo.updated` outbox 写入同一 D1 batch。仓库测试覆盖 authenticated handshake、replay、visibility filtering 和 cancellation。

这不是上游进程内 SSEHub parity：当前没有 Durable Object broadcaster、retention/pruning、关系/附件/shortcut/share/user/notification 的完整事件集，也没有第三方 EventSource smoke。

根 `POST /mcp` 是无状态 JSON Streamable HTTP 子集，覆盖 `initialize`、`notifications/initialized`、`tools/list`、`tools/call`；成功结果提供 text content 和 `structuredContent`，工具失败留在 MCP result 的 `isError: true` 中。旧的 `POST /api/v1/mcp` JSON-RPC 工具名继续保留。当前不承诺 SSE MCP transport、MCP session、完整 method surface 或所有第三方 MCP client。

## 仅静态审计与明确未实现

对当前参考快照 `Temp/memos` 的 proto 和 generated Web Connect client 做过静态审计，并在 2026-08-05 使用 commit `daa71d0456d07a25ff5ea435e46577d31d030728` 生成的 client 做过一次隔离 local binary smoke；同日以同一 pinned client 连接 `https://flaremo.chendahuang.com`，匿名 `MemoService/ListMemos` binary response 也由 generated decoder 成功解码。静态审计确认上游参考面包含 Auth、Memo、Shortcut、Attachment、User、Instance、IdentityProvider、AI 八类 service，并确认官方 Web 使用 binary Connect、cookie credentials 和 bearer/refresh 生命周期；production smoke 只证明一个匿名 unary 方法，local smoke 只证明列出的 generated unary 子集，不证明官方 Web 或全部服务已互通。

当前明确未实现或未验证的能力：

- 完整 Memos Server parity，以及完整 REST/Connect/gRPC/protobuf schema parity。
- 单用户以外的用户创建、删除、权限、协作和完整用户资源语义。
- SSO/OAuth2 provider、linked identity、完整上游 webhook 事件/egress 语义、notification 的完整多用户 ACL/filter/投递语义。
- AI transcription、instance email testing/delivery、完整 instance setting provider 配置。
- 普通 public memo 的完整匿名 ACL、完整 CEL filter、复杂排序/分页和所有上游错误细节；当前 CEL 仍是受限 evaluator，且 filter 会在 Worker 侧执行而不是完全下推到 SQL。
- generated client 全量端到端 binary roundtrip、原生 gRPC metadata/trailer/streaming/compression，以及官方浏览器 gRPC-Web transport 全量验证。
- 完整 SSE event hub、事件保留策略和第三方 EventSource/MCP/client smoke。
- Memos native JWT/refresh token 的版本级、字节级 parity。

## 仓库测试证据

当前相关测试文件包括：

- `apps/worker/src/auth.test.ts`：Better Auth bootstrap、cookie session、账户变更、Origin、session/PAT 撤销和恢复边界。
- `apps/worker/src/memos-auth-golden.test.ts`：固定测试时间和 test-only token id 下的 FlareMo access/refresh JWT 与 refresh rotation golden bytes；这证明 FlareMo 自己的确定性，不证明 Memos 上游版本级 parity。
- `apps/worker/src/memos-compatibility.test.ts`：current/legacy REST、memo/attachment/share、PAT、native auth facade、OpenAPI、MCP contract。
- `apps/worker/src/memos-social.test.ts`：comments、reactions、shortcuts 和错误/Origin 边界。
- `apps/worker/src/memos-transport.test.ts`：native JWT、refresh cookie、Connect JSON、UserService webhook/notification 资源的部分 transport、部分新增 service、protobuf/gRPC-Web framing、SSE 和 canonical share RPC。
- `apps/worker/src/memos-protobuf.test.ts`：media type、请求 field number、部分 response serialization、gRPC-Web unary data/trailer frame 和 binary error status。
- `apps/worker/src/memos-connect-client.test.ts`：使用官方 generated `MemoService`、`UserService` 和 `@connectrpc/connect-web`，对 Connect binary 与 gRPC-Web binary 做有限的 schema-decoded unary smoke，包括 UserService webhook/notification 方法；不代表完整官方 Web 或第三方客户端兼容。
- `apps/worker/src/mcp-streamable.test.ts`：无状态 Streamable HTTP MCP 的初始化、工具列表、调用错误和 legacy route。
- `apps/worker/src/memos-link-metadata.test.ts`、`packages/memos/src/adapter.test.ts`、`packages/memos/src/current-adapter.test.ts`：link metadata 输入限制、resource name 和 DTO 映射。
- `apps/telegram-bot/src/index.test.ts`：项目自带 Telegram Worker 示例的 PAT、可选 Access headers 和 webhook fail-closed contract；不是对真实 Telegram 或生产 FlareMo 的 smoke。

这些测试证明的是 FlareMo 自己的协议契约和安全边界，不等于第三方客户端已经可用。真实连接结果、客户端 commit、FlareMo commit、请求路径、认证方式、失败请求和日期必须记录在 [memos-ecosystem.md](./memos-ecosystem.md) 后，才能把某个生态工具标记为真实可用。
