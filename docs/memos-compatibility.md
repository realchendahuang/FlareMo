# Memos 兼容矩阵

FlareMo 兼容 Memos 生态，但不复制 Memos 服务端实现。兼容目标是常用客户端、脚本、导入导出、OpenAPI 和 MCP 能在 FlareMo 上工作。

第三方客户端和工具的实测情况见 [memos-ecosystem.md](./memos-ecosystem.md)。本文件只描述 FlareMo 自身承诺的 API 子集。

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
| 附件上传 | 支持 | `POST /api/v1/attachments`。 |
| memo 绑定附件 | 支持 | `PATCH /api/v1/{name=memos/*}/attachments`。 |
| 附件下载 | 支持 | `GET /api/v1/{name=attachments/*}/blob`。 |
| memo relations | 支持 | `GET/PATCH /api/v1/{name=memos/*}/relations`。 |
| 分享 | 支持 | `POST /api/v1/{parent=memos/*}/shares`。 |
| 公开分享读取 | 支持 | `GET /api/public/shares/{token}`。 |
| 导出 | 支持 | `GET /api/v1/export`。 |
| 导入 | 支持 | `POST /api/v1/import`。 |
| OpenAPI | 支持 | `GET /openapi.json`。 |
| MCP | 支持 | `POST /api/v1/mcp`。 |

## 当前不承诺

这些能力不是当前兼容目标，只有在服务 FlareMo 产品目标时才进入实现：

- Memos Go server 的内部 API parity。
- Connect/gRPC。
- 完整 CEL filter。
- 实例管理后台。
- 多用户社交、评论、反应、通知。
- SSE。
- Memos 原版认证、SSO 和登录流程。
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

兼容不是口号。每个公开承诺的 endpoint 都需要测试覆盖。

第三方客户端兼容记录必须回写到 [memos-ecosystem.md](./memos-ecosystem.md)。没有实际连接 FlareMo 的客户端只能标记为“未测”，不能写成“支持”。
