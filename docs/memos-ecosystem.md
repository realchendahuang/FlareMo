# Memos 生态兼容记录

FlareMo 的目标是复用 Memos 生态，但兼容必须被验证。这个文档记录第三方客户端、脚本和工具对 FlareMo 的真实可用性，不把“接口长得像”当成“已经兼容”。当前工作树已经提供 Better Auth-backed identity、Memos-style HS256 access JWT/rotating `memos_refresh` cookie、current camelCase REST 的 memo/social 子集、PAT 资源、Connect JSON/protobuf/gRPC-Web unary 子集、D1 outbox/cursor replay SSE 和根 `/mcp` 无状态 Streamable HTTP MCP 子集；完整 Memos Server parity 和第三方客户端实测仍未完成。

生产实例迁移期建议放在 Cloudflare Access 后面。第三方工具访问私有 FlareMo 时，必须满足应用层认证：

```text
Authorization: Bearer memos_pat_...
```

如果外层仍启用 Cloudflare Access，还必须额外发送：

```text
CF-Access-Client-Id
CF-Access-Client-Secret
```

Access Service Token 只通过外层 Access policy，不会自动变成 FlareMo 用户 session；不能发送应用层 `Authorization` 的工具无法访问私有 API，除非使用额外代理层。公开分享仍只依赖 share token、过期和 memo 状态校验。

## Origin 安全契约

浏览器 cookie session 的 `POST`、`PATCH`、`DELETE` 等状态变更必须携带 `Origin`，并精确命中 `FLAREMO_PUBLIC_URL` 或 `FLAREMO_TRUSTED_ORIGINS`；缺失或不匹配返回 `403`。桌面脚本、MCP 和其他非浏览器客户端使用 PAT 时可以不发送 Origin；若 PAT 请求主动携带 Origin，也必须命中同一 allowlist，否则返回 `403`。不使用 wildcard、`Referer` 或 Access headers 替代 Origin。

这与 [Memos 0.30 MCP 文档](https://usememos.com/docs/integrations/mcp) 的 browser-origin 模型方向一致，只说明安全边界相似。FlareMo 的 current wire 是当前已实现的兼容子集；它不等于完整 Memos 协议或完整服务端 parity。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| 可用 | 已连接 FlareMo，并用 cookie session 或 `memos_pat_` PAT 完成核心读写路径；如生产启用 Access，还验证了两层认证。 |
| 部分可用 | 核心路径有一部分可用，或只验证了 Access 外层而没有验证应用层 PAT。 |
| 不支持 | 当前客户端能力或认证模型与 FlareMo 不匹配。 |
| 未测 | 只完成资料收集，还没有实际连接 FlareMo。 |

## 已验证工具和脚本

这些条目已经由仓库自动化测试覆盖，可以作为脚本和工具接入 FlareMo 的当前事实基线。

| 工具 / 路径 | 类型 | 测试版本 | 请求路径 | 应用层认证 | 当前状态 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| curl / HTTP script | 通用脚本 | 当前工作树 | `/api/v1/memos`、`/api/v1/attachments`、`/api/v1/export`、`/api/v1/import` | `memos_pat_`；Access 开启时再加 Access headers | 可用（Worker contract） | `apps/worker/src/auth.test.ts` 和 `apps/worker/src/api.test.ts` 覆盖 cookie、PAT、memo CRUD、分页、搜索、附件、分享、revisions、export/import。 |
| current REST script | 通用脚本 | 当前工作树 | `/api/v1/auth/*`、`/api/v1/memos`、`/api/v1/memos/{memo}/comments`、`reactions`、`/api/v1/users/*/shortcuts`、`/api/v1/attachments`、`/api/v1/shares/*` | Better Auth cookie/session bearer、native Memos access JWT 或 `memos_pat_`；Access 开启时再加 Access headers | 可用（FlareMo contract） | `apps/worker/src/memos-compatibility.test.ts`、`memos-social.test.ts` 覆盖 current DTO、enum、updateMask、PAT、native JWT claims/rotation、social 资源、标准错误和匿名 share read；不是第三方客户端 smoke。 |
| OpenAPI consumers | API schema 工具 | 当前工作树 | `/openapi.json` | OpenAPI 描述可公开读取；私有 API 请求需 PAT | 可用（schema surface） | `apps/worker/src/memos-compatibility.test.ts` 断言默认 current OpenAPI 和显式 legacy OpenAPI。 |
| FlareMo legacy MCP endpoint | MCP 客户端 | 当前工作树 | `/api/v1/mcp` | `memos_pat_`；Access 开启时再加 Access headers | 部分可用（旧式 JSON-RPC） | `apps/worker/src/auth.test.ts` 覆盖 PAT `tools/list`；保留给已有 FlareMo 客户端。 |
| FlareMo current MCP endpoint | MCP 客户端 | 当前工作树 | `/mcp` | Better Auth cookie/session bearer、native Memos access JWT 或 `memos_pat_`；Access 开启时再加 Access headers | 可用（stateless protocol subset） | `apps/worker/src/mcp-streamable.test.ts` 和 `apps/worker/src/memos-compatibility.test.ts` 覆盖 `initialize`、`notifications/initialized`、`tools/list`、memo/social/attachment tool calls 和工具错误 envelope；未验证所有第三方 MCP client。 |
| Connect / protobuf client | HTTP unary client | 当前工作树 | `/memos.api.v1/{Service}/{Method}` | Cookie session、native Memos access JWT 或 `memos_pat_`；`GetSharedMemo` 和 link metadata 可匿名 | 部分可用（当前 service/transport subset） | 支持 `application/json`、`application/proto`、`application/grpc+proto`、`application/grpc-web+proto`、`application/grpc-web-text+proto`；覆盖 Memo/Auth/Shortcut 的明确 unary 方法集、comments/reactions/shares 和 link metadata；完整 gRPC metadata/trailer、压缩/streaming、其他 service 和第三方 Connect client 仍未测。 |
| Memos SSE consumer | SSE client | 当前工作树 | `/api/v1/sse` | Cookie session、native Memos access JWT 或 `memos_pat_` | 部分可用（D1 outbox/replay subset） | Worker contract 覆盖 authenticated stream、connected/heartbeat、`id`/`Last-Event-ID` replay、private/public visibility filter 和 cancellation；当前使用 D1 polling，事件集有限，第三方消费端未测。 |
| FlareMo Telegram Worker example | Telegram Bot | 当前工作树 | Telegram webhook -> `/api/v1/memos` | 必须使用 PAT；Access headers 仅在生产仍启用 Access 时成对追加 | contract-tested subset | Worker tests cover PAT-only native auth, optional Access headers, fail-closed secret configuration, and webhook validation；不等于真实 Telegram/生产 smoke。 |
| Public share reader | 浏览器 / curl | 当前工作树 | `/share/*`、`/api/public/shares/*` | 不需要 session/PAT；Access 开启时需 bypass | 可用（share contract） | Worker 测试覆盖 token 隔离、撤销和附件读取。 |

## 第三方客户端待测矩阵

这些条目还没有实际连接 FlareMo，不能写成支持。

| 工具 | 类型 | 仓库 | 待测版本 | 是否支持自定义 header | 是否可发送 PAT | 当前状态 | 需要验证的请求路径 / 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| memos-desktop | 桌面客户端 | https://github.com/xudaolong/memos-desktop | 待测 | 未确认 | 未确认 | 未测 | 验证 API base URL、PAT 配置/注入、memo CRUD；若 Access 开启，再验证双层 headers。 |
| memos_wmp | 微信小程序 | https://github.com/Rabithua/memos_wmp | 待测 | 未确认 | 未确认 | 未测 | 验证网络层是否允许添加 `Authorization` PAT 和可选 Access headers。 |
| memoflow | 移动端客户端 | https://github.com/hzc073/memoflow | 待测 | 未确认 | 未确认 | 未测 | 验证登录模型、PAT/API base URL、memo CRUD 和附件路径。 |
| telegramMemoBot | 第三方 Telegram bot | https://github.com/qazxcdswe123/telegramMemoBot | 待测 | 未确认 | 未确认 | 未测 | 验证是否支持 FlareMo `memos_pat_`，不能只验证 Cloudflare Access headers。 |
| Dynos | 移动端客户端 | https://github.com/HonKLam/Dynos | 待测 | 未确认 | 未确认 | 未测 | 验证离线同步和 FlareMo API 子集的重叠范围。 |
| mcp-server-memos | MCP server | https://github.com/LeslieLeung/mcp-server-memos | 待测 | 未确认 | 未确认 | 未测 | FlareMo 自带 MCP endpoint；仍可验证外部 MCP server 是否能作为兼容客户端使用。 |
| memos-raycast | Raycast extension | https://github.com/JakeLaoyu/memos-raycast | 待测 | 未确认 | 未确认 | 未测 | 验证 Raycast preferences 是否能配置 PAT；若 Access 开启，再验证 Access headers。 |
| memos-extensions | 浏览器插件 | https://github.com/yozi9257/memos-extensions | 待测 | 未确认 | 未确认 | 未测 | 验证扩展权限、header 注入和创建 memo 路径。 |
| notum | 离线优先笔记 | https://github.com/nikita-popov/notum | 待测 | 未确认 | 未确认 | 未测 | 验证同步协议是否只依赖 FlareMo 已支持的 `/api/v1` 子集。 |

## 验证标准

一个客户端标记为“可用”前，至少要完成：

- 配置 FlareMo base URL。
- 用 cookie session 或 `memos_pat_` PAT 访问应用层；若通过受保护生产实例，再加 Cloudflare Access Service Token。
- 验证 cookie session 的状态变更带 trusted Origin；缺失或不可信 Origin 返回 `403`。
- 验证无 Origin 的 PAT 桌面/脚本/MCP 请求可以工作；带未授权 Origin 的 PAT 请求返回 `403`。
- 不要把只通过 Cloudflare Access headers 当成应用层兼容证据。
- 记录客户端名称、版本、测试日期、FlareMo version 或 commit。
- 创建 memo。
- 列出 memo。
- 编辑 memo。
- 删除或归档 memo。
- 如果客户端支持附件，验证上传和下载。
- 如果客户端支持分享，验证创建分享和公开读取。
- 记录部署方式、已知缺口和是否需要代理层。

## 记录模板

```markdown
### <client name>

- 客户端版本：
- FlareMo version / commit：
- 部署方式：local / protected production / unprotected test
- 应用层 PAT：required / not required / unsupported
- Access Service Token：required / not required / unsupported
- 请求路径：
- 结果：可用 / 部分可用 / 不支持
- 已验证：
  - create memo:
  - list memo:
  - edit memo:
  - archive/delete memo:
  - attachment:
  - share:
- 缺口：
```

## 当前自动化覆盖

仓库里的 Memos 兼容测试覆盖 FlareMo 自己的 API contract：

- `packages/memos/src/adapter.test.ts`
- `apps/worker/src/memos-compatibility.test.ts`
- `apps/worker/src/api.test.ts`

这些测试证明 FlareMo 自己的 current/legacy 公开子集、Better Auth 认证边界、Connect/protobuf unary transport、有限 SSE cursor replay 和无状态 `/mcp` 协议切片，但不能替代真实 Memos 客户端兼容测试，也不能证明完整 Memos Server parity。真实客户端结果必须回写到本文；在没有实际连接、版本和日期证据前，第三方客户端保持“未测”。

当前已知的 transport 兼容边界：binary error body 只提供简化 `google.rpc.Status`，没有完整 gRPC trailer/metadata；只接受单个未压缩 unary frame；没有 AttachmentService、UserService、InstanceService、AIService、IdentityProviderService 等完整上游 service；link metadata 只抓取受限 Open Graph surface，并受 SSRF/redirect/HTML 大小限制。生产环境还应控制 Worker 外连策略，以补足域名解析后的 DNS rebinding 风险。
