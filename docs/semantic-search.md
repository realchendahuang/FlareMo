# 语义搜索架构

FlareMo 的语义搜索只做派生检索能力。D1 仍然是 memo、关系、分享、附件元数据和状态的事实源；Vectorize 只保存可重建的 embedding 索引。

语义搜索已经端到端上线：Workers AI 生成 embeddings，Vectorize 提供向量查询，`/api/app/search/semantic` 提供 API，前端搜索栏提供「语义搜索（找一找）」入口。本文描述已实现的架构与持续有效的边界约束。

## 目标

- 让用户用自然语言找到相关 memo。
- 保持普通搜索、标签、状态、时间过滤仍由 D1 提供。
- 保持 `/api/v1/*` Memos-compatible API 的权威数据来自 D1。
- 用 Workers AI 生成 embeddings，用 Vectorize 查询相似 memo。

## 非目标

- 不把 Vectorize 当主数据库。
- 不把 Workers AI 返回结果当权威笔记内容。
- 不在 Vectorize 里保存完整 memo 内容、附件正文或私密大段文本。
- 不因为接入语义搜索而绕过 Cloudflare Access。

## 数据归属

| 数据 | 事实源 | 说明 |
| --- | --- | --- |
| memo 内容、状态、可见性、时间戳 | D1 | 权威业务数据。 |
| 标签、payload、relations、shares | D1 | 参与过滤和权限判断。 |
| 附件二进制和导出包 | R2 | D1 只保存对象元数据和 R2 key。 |
| embedding vector | Vectorize | 可删除、可重建的派生索引。 |
| 少量检索元数据 | Vectorize metadata | 只放回查 D1 和工具观测所需字段。 |

Vectorize 返回命中后，FlareMo 必须回 D1 读取 memo，并重新校验 `status`、`visibility`、share 状态和 Access 边界。搜索响应不会直接把 Vectorize metadata 当作最终 memo DTO。

## 索引记录

memo 向量 ID：

```text
memos/{memo_id}#chunks/{chunk_index}
```

查询时去掉 `#chunks/` 后缀即可还原 memo id。memo 向量 metadata 只保留两个字段：

```json
{
  "memo_id": "…",
  "user_id": "…"
}
```

- **memo 向量全部写在同一个共享 namespace**（查询时不传 namespace）。metadata 里的 `user_id` 只是归属标注，不作为 Vectorize 侧的查询预过滤：整个团队共享同一次向量查询，查询成本不随作者数量增长，被移除作者的团队/公开 memo 也仍可被召回。授权边界是查询时回 D1 的 `memoReadScope` 复查（见「查询流程」），而不是 namespace 或 metadata 过滤。
- **memory 向量保留 per-user namespace**（namespace = 记忆所属用户），因为记忆召回只允许触达调用者自己的条目。
- metadata 只用于过滤和回查。不要把完整 `content`、附件正文、share token、Access Service Token、用户邮箱或其他凭据放进 Vectorize metadata。

## 写入流程

创建或更新 memo 时：

1. 先写 D1，同时在 `embedding_tasks` outbox 表记录一条索引任务。
2. 请求路径的 outbox sweep 和每日 Cron（`17 3 * * *`）都会派发任务；失败任务保留重试计数，D1 的 `embedding_status` 记录 `not_indexed / pending / indexed / error`。
3. 派发时从 D1 重新读取 memo，按内容切成稳定 chunk，用 Workers AI（默认 `@cf/qwen/qwen3-embedding-0.6b`，1024 维）生成 embeddings。
4. 批量 upsert 到 Vectorize 的共享 namespace（metadata 带 `memo_id` / `user_id`），并在 D1 记录 `indexed`。

如果 embedding 或 Vectorize 写入失败，D1 写入仍然成功。失败只影响语义搜索召回，不影响 memo 创建、更新、导出、分享或 Memos-compatible API。

## 更新和删除同步

更新 memo 时：

- D1 是先行写入。
- 内容变化通过新的 outbox 任务重新生成 chunk 和 embeddings。
- 重新派发会对该 memo 的全部 chunk vector 重新 upsert，旧的 chunk id 集合被覆盖。

删除、进入回收站或状态不可索引时：

- 派发时会从 D1 重读 memo；只有 `normal` / `archived` 的 memo 会被索引。
- memo 不存在、被 hard delete 或状态不可索引时，对应 chunk vectors 会被删除，D1 的 embedding 状态被清理。

Vectorize V2 的 mutation 可能不是立刻对查询可见，因此查询层始终以 D1 状态为最终过滤条件。

## 重建索引

必须支持从 D1 全量重建 Vectorize。备份演练与恢复流程（`pnpm backup:drill` / `pnpm backup:drill:remote`）会把目标 Vectorize index 视为空，并为正常/归档 memo 重新写入 `reindex` 任务，让请求 outbox 或 Cron 完成重建；不要把旧 D1 的 `indexed` 标记误当成新 index 中真的存在向量。

重建是可重复的。只要 D1 和 R2 还在，Vectorize 丢失不应造成业务数据丢失。

## 查询流程

语义查询（`/api/app/search/semantic`）时：

1. 对用户查询生成 embedding（同一 provider、同一模型）。
2. 在共享 namespace 里做**一次** Vectorize 查询，`topK = min(limit * 5, 100)`。放宽的 top-K 吸收会被 D1 复查丢弃的其他作者的候选，使召回质量不依赖 per-user 预过滤。
3. 去掉 `#chunks/` 后缀得到 memo id，回 D1 用 `memoReadScope`（私密 / 团队可见 / 公开的三档可见性权限矩阵）加 `status in (normal, archived)` 批量读取。**这一步 D1 复查是唯一的授权边界**，路由不得绕过它直接查 `memos` 表。
4. 按 memo 聚合最高 chunk score，按分数排序，返回 FlareMo 自己的 search result DTO，而不是直接返回 Vectorize match。

普通关键词搜索仍走 D1 FTS5。降级路径：embedding provider 或 Vectorize index 缺失/报错时，语义搜索回退到 D1 FTS5 关键词搜索；`FLAREMO_EMBEDDING_PROVIDER=none` 时索引派发直接跳过，FTS5 搜索完全不受影响。

## 隐私边界

- 生产实例仍由 Cloudflare Access 保护。
- 脚本、MCP 和 Memos-compatible 客户端使用 FlareMo `memos_pat_` PAT；如果生产入口仍启用 Cloudflare Access，再附加 Access Service Token。Access Service Token 不能替代应用层 PAT。
- embedding provider 只能接收必要的 memo 文本。
- 不索引已删除或不可见 memo；trash / hard delete 的向量会被清除。
- 私密 memo 可以进入共享语义索引，但查询结果必须经过 `memoReadScope` 复查，私密内容只会回到作者本人的搜索结果里。
- 公开分享不自动开放语义搜索结果；分享只暴露 share token 对应的 memo 内容。

## 失败恢复

语义搜索是可降级能力：

- Vectorize 不可用时，保留 D1 FTS5 普通搜索。
- Workers AI 不可用时，memo CRUD 仍然成功，任务留在 `embedding_tasks` 待重试。
- 部分 memo 索引失败时，搜索结果可以缺失该 memo，但不能返回过期或无权访问的数据。
- 索引版本不一致时，以 D1 为准，必要时通过恢复流程触发重建。

## 实现状态

语义搜索已上线，对应的基础设施：

- `wrangler.jsonc` 的 `VECTORIZE_MEMOS`（flaremo-memos）、`VECTORIZE_MEMORIES`（flaremo-memories）和 Workers AI `AI` binding。
- D1 的 `embedding_tasks` outbox 表，以及 `memos` / `memory_items` 上的 `embedding_*` 状态字段。
- 派发通道：请求路径 outbox sweep + 每日 Cron，不依赖 GitHub Actions 或额外队列。
- API contract：`/api/app/search/semantic`（Zod schema、每月语义搜索配额检查）与前端搜索栏的「语义搜索」入口。
- D1 回查（`memoReadScope`）、状态过滤、删除同步和降级路径均有 Vitest 覆盖。
- Agent Memory 的语义召回共用同一套 provider / outbox 基础设施，但向量保留在 per-user namespace，见 [agent-memory.md](./agent-memory.md)。
