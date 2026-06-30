# 语义搜索架构

FlareMo 的语义搜索只做派生检索能力。D1 仍然是 memo、关系、分享、附件元数据和状态的事实源；Vectorize 只保存可重建的 embedding 索引。

本文只定义边界和后续实现约束，不表示当前已经接入 Vectorize、Workers AI、Queues 或 Cron。

## 目标

- 让用户用自然语言找到相关 memo。
- 保持普通搜索、标签、状态、时间过滤仍由 D1 提供。
- 保持 `/api/v1/*` Memos-compatible API 的权威数据来自 D1。
- 允许后续用 Workers AI 生成 embeddings，用 Vectorize 查询相似 memo。

## 非目标

- 不把 Vectorize 当主数据库。
- 不把 Workers AI 返回结果当权威笔记内容。
- 不在 Vectorize 里保存完整 memo 内容、附件正文或私密大段文本。
- 不因为接入语义搜索而绕过 Cloudflare Access。
- 不在前端展示未实现的语义搜索入口。

## 数据归属

| 数据 | 事实源 | 说明 |
| --- | --- | --- |
| memo 内容、状态、可见性、时间戳 | D1 | 权威业务数据。 |
| 标签、payload、relations、shares | D1 | 参与过滤和权限判断。 |
| 附件二进制和导出包 | R2 | D1 只保存对象元数据和 R2 key。 |
| embedding vector | Vectorize | 可删除、可重建的派生索引。 |
| 少量检索元数据 | Vectorize metadata | 只放过滤和回查 D1 所需字段。 |

Vectorize 返回命中后，FlareMo 必须回 D1 读取 memo，并重新校验 `status`、`visibility`、share 状态和 Access 边界。搜索响应不能直接把 Vectorize metadata 当作最终 memo DTO。

## 索引记录

每个 Vectorize vector 对应一个 memo chunk。

建议 ID：

```text
memos/{memo_id}#chunks/{chunk_id}
```

建议 metadata：

```json
{
  "memo_id": "memos/abc",
  "chunk_id": "chunks/0",
  "user_id": "users/owner",
  "state": "normal",
  "visibility": "private",
  "updated_at": "2026-06-30T00:00:00.000Z"
}
```

metadata 只用于过滤和回查。不要把完整 `content`、附件正文、share token、Access Service Token、用户邮箱或其他凭据放进 Vectorize metadata。

## 写入流程

创建或更新 memo 时：

1. 先写 D1。
2. 生成可索引文本。
3. 切成稳定 chunk。
4. 用 Workers AI 或外部 embedding provider 生成 embeddings。
5. upsert 到 Vectorize。
6. 在 D1 记录索引状态，例如 `semantic_index_version`、`indexed_at`、`index_error`。

如果 embedding 或 Vectorize 写入失败，D1 写入仍然成功。失败只影响语义搜索召回，不影响 memo 创建、更新、导出、分享或 Memos-compatible API。

## 更新和删除同步

更新 memo 时：

- D1 是先行写入。
- 如果内容变化，重新生成 chunk 和 embeddings。
- 对不再存在的旧 chunk 执行 Vectorize delete。
- 对仍存在或新增的 chunk 执行 Vectorize upsert。

删除、进入回收站或归档时：

- hard delete 必须删除对应 Vectorize vectors。
- trash/archive 可以选择删除 vectors，或保留 vector 但查询后回 D1 过滤；默认建议删除或标记为不可召回，避免语义搜索返回不可见内容。

Vectorize V2 的 mutation 可能不是立刻对查询可见，因此查询层必须始终以 D1 状态为最终过滤条件。

## 重建索引

必须支持从 D1 全量重建 Vectorize。

重建流程：

1. 创建新 Vectorize index，或清空现有 index。
2. 从 D1 按 `updated_at` / `id` 分页读取可索引 memos。
3. 为每条 memo 生成 chunk 和 embeddings。
4. 批量 upsert vectors。
5. 记录进度、失败 memo 和索引版本。
6. 重建完成后切换查询使用的新索引版本。

重建必须是可重复的。只要 D1 和 R2 还在，Vectorize 丢失不应造成业务数据丢失。

## 查询流程

语义查询时：

1. 对用户查询生成 embedding。
2. 查询 Vectorize，使用 metadata filter 缩小用户、状态和可见性范围。
3. 取回 `memo_id` 和 score。
4. 回 D1 批量读取 memos。
5. 用 D1 状态做最终过滤和排序融合。
6. 返回 FlareMo 自己的 search result DTO，而不是直接返回 Vectorize match。

普通关键词搜索仍走 D1。后续可以做 hybrid search，把 D1 关键词结果和 Vectorize 语义结果融合，但 D1 权威过滤必须最后执行。

## 隐私边界

- 生产实例仍由 Cloudflare Access 保护。
- 脚本、MCP 和 Memos-compatible 客户端仍使用 Access Service Token。
- embedding provider 只能接收必要的 memo 文本。
- 不索引已删除 memo。
- 私密 memo 可以进入私有语义索引，但查询必须限制在同一用户和同一 Access 边界内。
- 公开分享不自动开放语义搜索结果；分享只暴露 share token 对应的 memo 内容。

## 失败恢复

语义搜索是可降级能力：

- Vectorize 不可用时，保留 D1 普通搜索。
- Workers AI 不可用时，memo CRUD 仍然成功，并记录待重试索引任务。
- 部分 memo 索引失败时，搜索结果可以缺失该 memo，但不能返回过期或无权访问的数据。
- 索引版本不一致时，以 D1 为准，必要时触发重建。

## 后续实现条件

真正实现前必须先补：

- `wrangler.jsonc` 的 Vectorize / Workers AI binding。
- D1 中的索引状态字段或独立索引任务表。
- 后台重试机制，优先考虑 Queues / Cron / Workflows。
- 语义搜索 API contract 和测试。
- D1 回查、权限过滤和删除同步测试。

在这些条件完成前，前端不展示语义搜索入口。
