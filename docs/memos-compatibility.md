# Memos 兼容矩阵

FlareMo 正在构建一个对外兼容 Memos 生态的兼容层，但当前仍处于实现和验证阶段，不宣称已经完成 Memos 生态兼容。当前只承诺本文列出的 FlareMo 自身 API 子集；第三方客户端必须实际连接并完成验证后才能标记为可用。我们不复制 Memos 服务端实现，目标是逐步让常用客户端、脚本、导入导出、OpenAPI 和 MCP 在已验证范围内接入 FlareMo。

第三方客户端和工具的实测情况见 [memos-ecosystem.md](./memos-ecosystem.md)。本文件只描述 FlareMo 自身承诺的 API 子集。

## 认证边界

当前 #39 提供的是 FlareMo 原生认证基础，不是完整的 Memos Server auth parity：

| 入口 | 当前认证方式 | 兼容说明 |
| --- | --- | --- |
| Web / Better Auth | 用户名 + 密码，登录后使用 `HttpOnly` cookie session | 当前只支持一次性 owner bootstrap；正常公共 signup 已关闭。 |
| `/api/v1/*` 私有 API | `Authorization: Bearer memos_pat_...` | PAT 由已登录账户创建、只在创建时显示一次、可撤销；PAT 是 FlareMo-native credential。 |
| `/api/v1/mcp` | `Authorization: Bearer memos_pat_...` | 当前是 FlareMo 既有 JSON-RPC MCP 子集，不等于 Memos 当前 `/mcp` Streamable HTTP。 |
| Origin policy | cookie session 状态变更必须携带并精确匹配 `FLAREMO_PUBLIC_URL` / `FLAREMO_TRUSTED_ORIGINS`；PAT 可无 Origin，带 Origin 时同样必须匹配 | 缺失或不可信 Origin 返回 `403`；Access headers 不替代应用层 Origin。 |
| Cloudflare Access | 可选外层 policy / Service Auth | Access 只解决外层网络门禁；启用时仍要提供上面的 cookie 或 PAT。 |

Issue #40 才会处理真实 current camelCase wire adapter、Memos auth facade、字段和错误翻译，以及 `/mcp` Streamable HTTP。不要把当前 PAT/Bearer 基础宣传为完整 Memos server parity。

Origin 规则与 [Memos 0.30 MCP 文档](https://usememos.com/docs/integrations/mcp) 所描述的 browser-origin 模型保持同一安全方向，但当前 `/api/v1/mcp` 仍是 FlareMo 既有 JSON-RPC 子集；`/mcp` Streamable HTTP 和 current camelCase wire adapter 未实现。

## 已支持

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| memo resource name | 支持 | `memos/{id}`。 |
| attachment resource name | 支持 | `attachments/{id}`。 |
| share resource name | 支持 | `shares/{token}`。 |
| 创建 memo | 支持 | `POST /api/v1/memos`。 |
| memo 列表 | 支持 | `GET /api/v1/memos`。 |
| memo 详情 | 支持 | `GET /api/v1/{name=memos/*}`。 |
| 更新 memo | 支持 | `PATCH /api/v1/{memo.name=memos/*}`。 |
| 删除 memo | 支持 | `DELETE /api/v1/{name=memos/*}`，当前语义是进入回收站。 |
| 标签过滤 | 支持 | `GET /api/v1/memos?tag=<tag>`。 |
| 状态过滤 | 支持 | normal、archived、trashed。 |
| 分页 | 支持 | `page_size`、`page_token`。 |
| 排序 | 支持 | `order_by` 子集。 |
| 全文搜索 | 支持 | `q` 使用 D1 FTS5，并在需要时回退到安全模糊匹配；支持 `has:attachment`、`is:pinned`、日期和 `in:` 筛选。 |
| 附件上传 | 支持 | `POST /api/v1/attachments`；可选 `client_id` 让离线重试幂等。 |
| memo 绑定附件 | 支持 | `PATCH /api/v1/{name=memos/*}/attachments`。 |
| 附件下载 | 支持 | `GET /api/v1/{name=attachments/*}/blob`。 |
| Range / 内联预览 | 支持 | 单段 byte range、ETag 和受控 inline disposition。 |
| memo relations | 支持 | `GET/PATCH /api/v1/{name=memos/*}/relations`。 |
| relation context / backlinks | 支持 | `GET /api/v1/memos/{id}/relation-context`。 |
| memo 完整上下文 | 支持 | `GET /api/v1/memos/{id}/context`。 |
| 历史版本 | 支持 | 列出并恢复 memo revisions。 |
| 分享 | 支持 | 列出/创建 memo 分享，并通过 `DELETE /api/v1/shares/{share_id}` 撤销。 |
| 公开分享读取 | 支持 | `GET /api/public/shares/{token}`。 |
| 导出 | 支持 | `GET /api/v1/export`。 |
| 导入 | 支持 | `POST /api/v1/import`，支持 `duplicate`、`skip`、`overwrite`。 |
| OpenAPI | 支持 | `GET /openapi.json`。 |
| MCP（FlareMo 现有 JSON-RPC 子集） | 支持 | `POST /api/v1/mcp`，需要 cookie session 或 `memos_pat_` PAT；不承诺 Memos 当前 `/mcp` Streamable HTTP 或 current camelCase wire adapter。 |

## 当前不承诺

这些能力不是当前兼容目标，只有在服务 FlareMo 产品目标时才进入实现：

- Memos Go server 的内部 API parity。
- Connect/gRPC。
- 完整 CEL filter。
- 实例管理后台。
- 多用户社交、评论、反应、通知。
- SSE。
- Memos 原版认证、SSO 和登录流程。
- Memos current camelCase wire adapter、auth facade 和 `/mcp` Streamable HTTP。
- 原版数据库抽象和本地文件存储行为。

## 兼容测试目标

后续每次扩大兼容面，都要补测试：

- DTO 字段映射。
- resource name parser。
- 分页和排序。
- import/export roundtrip。
- 附件上传和下载。
- share token 隔离。
- OpenAPI schema。
- MCP tool 调用。
- cookie session、PAT Bearer、PAT 撤销和公开分享匿名读取的边界。

兼容不是口号。每个公开承诺的 endpoint 都需要测试覆盖。

第三方客户端兼容记录必须回写到 [memos-ecosystem.md](./memos-ecosystem.md)。没有实际连接 FlareMo 的客户端只能标记为“未测”，不能写成“支持”。
