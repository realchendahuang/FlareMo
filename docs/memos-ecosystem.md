# Memos 生态兼容记录

FlareMo 的目标是复用 Memos 生态，但兼容必须被验证。本文把“代码已接入”“仓库 contract 已测试”“源码静态审计”和“真实客户端 smoke”分开记录，不把“接口长得像”当成“已经兼容”。截至本次快照，FlareMo 已有 Better Auth-backed identity、Memos 风格 HS256 access JWT/轮换 `memos_refresh` cookie、current camelCase REST 的 memo/social 子集、单用户 UserService 的 webhook/notification 资源生命周期、四类 memo 事件的 D1 outbox 投递/重试、PAT、Connect/protobuf/gRPC-Web unary 子集、D1 outbox/cursor replay SSE 和根 `/mcp` 无状态 Streamable HTTP MCP 子集；官方 generated Connect client 已在隔离的本地 Wrangler Worker 完成 binary unary smoke，并在生产域名完成匿名 `ListMemos` binary smoke，但完整 Memos Server parity、完整上游 webhook 事件/egress 语义、完整多用户 notification ACL、官方 Web 真实指向 FlareMo 和第三方客户端实测仍未完成。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| 已实现 | FlareMo 当前工作树有对应 route/domain handler。 |
| 已测试（仓库契约） | FlareMo 自己的测试以 Miniflare/Worker 或纯 codec 断言了行为；不是外部客户端已连接。 |
| 仅静态审计 | 阅读了上游 proto/generated client 或第三方客户端源码，推断潜在兼容面；没有真实请求 FlareMo。 |
| 未测 | 没有足够的源码结论或真实连接记录，不能判断可用。 |
| 未实现 | FlareMo 没有 handler，或明确返回 `501`。 |

本文中的“可用”只用于 FlareMo 自己的 contract surface。第三方工具在没有实际请求记录前，一律不能标记为“可用”。

## 应用层认证和 Access 边界

应用层使用 Better Auth；Cloudflare Access 是可选的外层 policy，不是 FlareMo 用户身份。

```text
浏览器：Better Auth username/password -> HttpOnly cookie session
脚本 / Memos-compatible client / MCP：Authorization: Bearer memos_pat_...
可选外层：Cloudflare Access Service Token -> 仍需上面的 FlareMo 应用凭据
```

如果生产实例仍放在 Cloudflare Access 后面，机器客户端需要同时满足 Access policy 和 FlareMo 应用层认证：

```text
CF-Access-Client-Id: ...
CF-Access-Client-Secret: ...
Authorization: Bearer memos_pat_...
```

Access Service Token 不会自动变成 FlareMo 用户 session；不能发送应用层 `Authorization` 的工具不能访问私有 API，除非增加明确的代理层。公开 share 仍只依赖 FlareMo 的 share token、过期时间和 memo 状态校验。

浏览器 cookie session 的 `POST`、`PATCH`、`DELETE` 等状态变更必须携带 `Origin`，并精确命中 `FLAREMO_PUBLIC_URL` 或 `FLAREMO_TRUSTED_ORIGINS`；缺失或不匹配返回 `403`。PAT 的桌面脚本、MCP 请求可以没有 Origin；若主动携带 Origin，也必须命中同一 allowlist。不能用 wildcard、`Referer` 或 Access headers 替代 Origin。

这与 [Memos MCP 文档](https://usememos.com/docs/integrations/mcp) 的 browser-origin 安全方向相似，但只说明安全边界相似，不说明 FlareMo 已达到完整 Memos 协议或 server parity。

## FlareMo 自己的已实现 / 已测试 surface

| 工具或路径 | 类型 | FlareMo 状态 | 仓库测试证据 | 外部客户端结论 |
| --- | --- | --- | --- | --- |
| current REST script / curl | 通用 HTTP 脚本 | 已实现 | `memos-compatibility.test.ts`、`memos-social.test.ts`、`auth.test.ts` 覆盖 current DTO、memo/attachment/share、social、PAT、native auth、Origin 和标准错误；`memos-auth-golden.test.ts` 固定验证 FlareMo 自己的 JWT/refresh bytes。 | 已测试的是 FlareMo contract；没有独立客户端或线上实例 smoke，也不证明上游 token parity。 |
| legacy REST script / curl | 兼容迁移脚本 | 已实现 | current/legacy OpenAPI 和 wire negotiation 有测试。 | 未对历史第三方脚本逐一重放。 |
| generic Connect JSON client | HTTP unary client | 已实现子集 | `memos-transport.test.ts` 覆盖 Memo/Shortcut 及部分 Auth、Attachment/User/Instance/IdentityProvider JSON RPC，包括 UserService webhook/notification 子集。 | 官方 generated client 的 binary smoke 已单独记录；generic JSON client 仍未逐一做第三方客户端 smoke。 |
| generic protobuf / gRPC-style client | HTTP binary client | 已实现子集 | `memos-protobuf.test.ts`、`memos-transport.test.ts` 覆盖 media type、部分 upstream field number、unary framing、gRPC-Web/text、data/trailer frame 和 error status。 | response 多数只做 frame/字节断言；generated schema roundtrip 只由下方官方 client smoke 覆盖有限 MemoService 方法。 |
| FlareMo current MCP endpoint | MCP client | 已实现子集 | `mcp-streamable.test.ts`、`memos-compatibility.test.ts` 覆盖 `initialize`、`notifications/initialized`、`tools/list`、`tools/call` 和工具错误 envelope。 | 根 `/mcp` 是无状态 JSON 子集；未测所有第三方 MCP client。 |
| FlareMo legacy MCP endpoint | 旧 MCP JSON-RPC | 已实现子集 | `mcp-streamable.test.ts` 和 `auth.test.ts` 覆盖旧工具名/PAT 边界。 | 不能从旧 endpoint 推断完整 Memos MCP 兼容。 |
| FlareMo SSE consumer | EventSource / SSE client | 已实现子集 | `memos-transport.test.ts` 覆盖 authenticated stream、connected/heartbeat、`Last-Event-ID` replay、visibility 和 cancellation。 | D1 polling 实现，未做第三方 EventSource smoke。 |
| FlareMo Telegram Worker example | Telegram webhook adapter | 已实现示例 | `apps/telegram-bot/src/index.test.ts` 覆盖 PAT-only、可选 Access headers、secret 校验和 fail-closed。 | 不是真实 Telegram API 或生产 FlareMo smoke。 |
| public share reader | 浏览器 / curl | 已实现 | `memos-compatibility.test.ts`、`api.test.ts` 覆盖 share token 隔离、撤销、过期/状态和附件读取。 | 仍需在实际部署域名上验证 Access bypass 规则；不绕过 FlareMo share 校验。 |
| Memos Web attachment file URL bridge | Memos Web `/file/attachments/{id}/{filename}` | 已实现子集 | `api.test.ts` 覆盖私有 cookie、Range/ETag、错误 filename 不改变对象定位，以及带 `share_token` 的公共读取和跨 memo 隔离。 | 只证明 FlareMo 的文件 URL contract；thumbnail 原图 fallback、motion media、官方 Web 全量行为和生产 Access path policy 仍未实测。 |
| 官方 Memos generated Connect client | `protoc-gen-es` + `@connectrpc/connect-web` binary unary client | 已实测子集 | `apps/worker/src/memos-connect-client.test.ts` 使用官方 generated `MemoService` 和 `UserService`：Connect binary 覆盖 memo 与 webhook/notification 方法，gRPC-Web binary 覆盖 memo 与 UserService 方法，并由 generated decoder 解码；另有下方记录的本地方法集 smoke 和生产域名匿名 `ListMemos` smoke。 | 生产只覆盖一个匿名 unary 方法；不是官方 Web 全量行为或完整 Memos Server parity。 |

## 官方 Memos generated Connect client：local 与 production anonymous smoke

2026-08-05 对当前本地工作树做过一次隔离 local E2E。测试使用本地参考快照 `Temp/memos` 的 commit `daa71d0456d07a25ff5ea435e46577d31d030728` 生成的 TypeScript client，并使用 `@bufbuild/protobuf@2.12.0`、`@connectrpc/connect@2.1.1`、`@connectrpc/connect-web@2.1.1` 和 `useBinaryFormat: true`，连接本地 Wrangler Worker `http://127.0.0.1:18787`。

已由官方 generated client 成功完成并解码：

- `InstanceService`：`GetInstanceProfile`、`BatchGetInstanceSettings`、`GetInstanceStats`。
- `AuthService`：`SignIn`、`GetCurrentUser`、`RefreshToken`、`SignOut`；signout 后 refresh token reuse 被拒绝。
- `MemoService`：memo CRUD、comments、reactions、shares 和 share read。
- `AttachmentService`：create/list/get/delete。
- `ShortcutService`：create/list/update/delete。
- `UserService`：list/get/stats/settings、webhook CRUD/signing-secret、notification list/update/delete。

local 证据说明 pinned generated client 能把列出的 Connect binary unary 请求发到 FlareMo，并把响应交给同一 generated schema 解码；production 证据只覆盖匿名 `MemoService/ListMemos`。这不是官方 Memos Web 全量 smoke：官方 Web 的 cookie credentials、refresh/retry、未覆盖的 IdentityProvider/AI 方法、streaming/metadata 等仍需单独验证；第三方客户端仍保持未测。

## 官方 Memos Web：仍仅静态审计

当前本地参考快照的官方 Web 代码仍只做过协议面静态审计。审计确认官方 Web 使用 8 类 generated Connect client：Auth、Memo、Shortcut、Attachment、User、Instance、IdentityProvider、AI；`connect.ts` 选择 binary format，并使用 `credentials: include`，认证生命周期包含 bearer access token、refresh cookie、Unauthenticated 后 refresh/retry。FlareMo 现在已经提供官方 Web 预期的 `/file/attachments/{id}/{filename}` 私有文件 URL 和 `share_token` 公共文件 URL bridge，但没有把官方 Web 本身配置到 FlareMo 的真实浏览器请求，因此不能把 generated client 或文件 bridge 扩大成“官方 Web 已兼容”。

## 第三方客户端矩阵

下面的“仅静态审计”表示从客户端源码、README 或依赖关系得到的候选结论，不代表已安装、已配置或已连接 FlareMo。

| 工具 | 类型 | 仓库 | 当前证据级别 | 静态审计结论 | 真实状态 / 下一步 |
| --- | --- | --- | --- | --- | --- |
| `memos-extensions` | 浏览器插件 | https://github.com/yozi9257/memos-extensions | 仅静态审计 | 看起来走 modern REST，是最高优先级的 PAT/header 注入候选。 | 未测；先验证扩展权限、`Authorization` 注入、创建/列表 memo。 |
| `memoflow` | Flutter / 移动端 | https://github.com/hzc073/memoflow | 仅静态审计 | 看起来依赖 modern REST/PAT，适合验证移动端基本 CRUD。 | 未测；需要 Flutter 环境和实际 base URL/PAT。 |
| `notum` | 离线优先笔记 | https://github.com/nikita-popov/notum | 仅静态审计 | 看起来使用 modern REST/PAT；同步协议和附件行为仍需实连。 | 未测；先验证同步、冲突和附件路径。 |
| `Dynos` | 移动端客户端 | https://github.com/HonKLam/Dynos | 仅静态审计 | 静态上存在 updateMask、connection check 等与 FlareMo 子集可能不一致的点。 | 未测；先记录第一条失败请求，不把静态 mismatch 直接写成“不支持”。 |
| `memos_wmp` | 微信小程序 | https://github.com/Rabithua/memos_wmp | 仅静态审计 | 是否能注入 `Authorization` PAT 和自定义 Access headers 尚未证明。 | 未测；需要微信网络层和 header 能力验证。 |
| `telegramMemoBot` | 第三方 Telegram bot | https://github.com/qazxcdswe123/telegramMemoBot | 仅静态审计 | 不能只验证 Cloudflare Access；必须确认它能使用 `memos_pat_` 或增加明确代理。 | 未测；区分该项目和 FlareMo 自带 Telegram Worker example。 |
| `memos-raycast` | Raycast extension | https://github.com/JakeLaoyu/memos-raycast | 仅静态审计 | preferences、API base URL 和 PAT/header 注入需要实际检查。 | 未测；先验证创建/列表/删除 memo。 |
| `mcp-server-memos` | 外部 MCP server | https://github.com/LeslieLeung/mcp-server-memos | 仅静态审计 | 它是另一个 adapter/server，不能从 FlareMo 自带 `/mcp` 推断互相兼容。 | 未测；验证其作为客户端连接 FlareMo 的 endpoint、认证和工具映射。 |
| `memos-desktop` | 桌面客户端 | https://github.com/xudaolong/memos-desktop | 仅静态审计 | 默认启动自己的内置 Memos 的路径不能代表远程 FlareMo 连接。 | 未测；需要显式 API base URL、PAT 和远程 CRUD 配置。 |

目前没有第三方条目可以标记为“可用”。“modern REST/PAT 候选”只表示值得优先 smoke，不是兼容承诺。

## 服务器侧明确未实现或不应误判为兼容

- 不是完整 Memos Server parity；不能把 current REST、Connect JSON、手写 protobuf 或 `/mcp` 子集合并成“完整兼容”。
- `AIService/Transcribe`、Instance email test、OAuth2/IdentityProvider CRUD、User create/delete、linked identity CRUD 当前明确未实现或返回 `501`；webhook 资源 CRUD/signing-secret、四类 memo 事件的有界 outbox 投递/重试和 notification list/update/delete 已有本地 contract/generated-client 覆盖，但完整上游 webhook 事件/egress 语义、完整通知 filter 和多用户 ACL 仍未完成。
- User/Instance/Attachment 的已列出方法已经有一次 pinned generated-client binary roundtrip，但这不覆盖全部字段、全部方法、生产域名或官方 Web；不能把它写成完整 binary parity。
- public memo read 已接入 current REST 和 Connect 的明确 viewer policy：匿名只读 `PUBLIC + NORMAL`，private/protected/archived/trashed/deleted 不可见；comments、relations、attachments、reactions 会先检查 parent/read visibility。公开 share 仍是独立 token 入口，不等于普通 memo public ACL。
- 没有完整 CEL、复杂分页/排序、全部 protobuf 字段、完整 metadata/trailer、压缩、streaming 或原生 HTTP/2 gRPC parity。gRPC-Web unary 的 data/trailer frame 已有本地 codec 与 generated-client 覆盖，但仍没有官方 Web 全量或第三方客户端 smoke。Attachment list 的 page token/order/filter 只是有限子集；`thumbnail=true` 暂时返回原始对象，motion media 和任意 `externalLink` 持久化仍未完成。
- SSE 是 D1 outbox/polling/replay，不是上游 SSEHub；没有完整事件集、retention/pruning 和第三方 EventSource 实测。
- 根 `/mcp` 没有有状态 MCP session，不承诺 SSE transport 或所有 MCP client 的 method surface。

## 真实客户端标记为“可用”的验收标准

在没有下列证据前，状态保持“未测”或“仅静态审计”：

- 客户端仓库、commit/tag、测试日期和 FlareMo commit。
- 实际配置 FlareMo base URL，并说明是 local、unprotected test 还是 protected production。
- 用 cookie session 或 `memos_pat_` 完成应用层认证；生产启用 Access 时同时验证 Access Service Token。
- 验证 cookie 状态变更的 trusted Origin；验证 PAT 无 Origin 可以工作，未授权 Origin 返回 `403`。
- 至少完成 create、list、edit、archive/delete memo；客户端支持时再完成 attachment 和 share。
- 记录实际请求 endpoint、HTTP/media type、认证方式、第一条失败请求、响应和已知缺口。

## 实测记录模板

```markdown
### <client name>

- 客户端版本 / commit：
- FlareMo version / commit：
- 测试日期：
- 部署方式：local / protected production / unprotected test
- 应用层认证：cookie / memos_pat_ / unsupported
- Access Service Token：required / not required / unsupported
- 实际请求路径和 media type：
- 结果：已测试可用 / 部分可用 / 不支持 / 未测
- 已验证：
  - sign in / refresh / sign out:
  - create memo:
  - list memo:
  - edit memo:
  - archive/delete memo:
  - attachment:
  - share:
- 第一条失败请求：
- 缺口：
```

真实客户端结果必须写回本文；在没有版本、日期和请求证据前，不能把静态审计结论升级为“生态兼容”。
