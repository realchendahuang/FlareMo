# 语义搜索向量分区设计（个人 / 团队）

状态：已实施并部署（99a58a4→bf5bbae，2026-09-15）。

本方案把 memo 语义索引从"全体用户共享一个池子"改造为"个人分区 + 团队分区"的 namespace 布局。D1 仍是唯一事实源，Vectorize 仍是可重建的派生索引，授权边界仍然是查询时回 D1 的 `memoReadScope` 复查——本设计不改变这些地基，改变的是向量的**物理归属**。

配套文档：[semantic-search.md](./semantic-search.md)（现有 A 布局描述，实施后需同步更新）。

## 1. 背景与问题

现状（A 布局）：所有用户的 memo 向量不分可见性全部写入同一个共享 namespace，查询时也不传 namespace，靠 D1 复查过滤出调用者有权的内容。这套模型在一个部署 = 一个信任单元时成立，但在 SaaS 共享实例下有三个实际问题：

1. **池子稀释**：候选来自全体用户的向量，个人查询的 top-K 名额被其他用户占掉后全被 D1 复查丢弃，需要 5 倍 top-K 放大对冲，实例越大召回质量越差。
2. **用量账错误**：`reportVectorUsage` 把 `index.describe()` 的全实例 vectorCount 当作每个用户个人的用量上报（`packages/domain/src/usage.ts:93`），并刺向 per-user 限额。
3. **"发布"没有物理实感**：个人笔记转团队只是改 D1 可见性字段，向量从一开始就在池子里，产品上"分享到团队"的显式动作在向量层不存在；同时删号/离队的向量清理只能靠 256 个 id 的宽扫兜底。

## 2. 方案结论

| 方案 | 布局 | 结论 |
| --- | --- | --- |
| A 扁平池 | 一个 namespace，全混 | 现状，如上三个问题 |
| **B 分区（采纳）** | 个人向量进 `user:{userId}`，团队向量进 `team:{teamId}` | 与"分享是显式动作"的产品定调物理对齐；搜索永不稀释；清理有抓手 |
| C 打标过滤 | 一个 namespace + metadata 过滤 | 隐私边界仍是逻辑保障，作为超限退路保留 |

不做部署时可切换的多模式：单一 B 布局覆盖个人自部署、团队、SaaS 共享三种形态；未来若出现 B 覆盖不了的场景，利用"D1 为事实源 + 全量重建"的现成地基再加新布局即可，不为尚无用户的形态付双倍维护成本。

## 3. 目标与非目标

目标：

- memo 向量按可见性物理分区：私密（含作者本人可见）进个人 namespace；对团队可见（`protected` / `public`）进团队 namespace。
- 个人↔团队的可见性转换变成真实的向量搬迁，搬迁**不重新生成 embedding**（内容未变，向量值不变，chunk 切分是确定性纯函数）。
- 语义搜索查询范围收窄到"个人分区 + 团队分区"，消除池子稀释。
- 修好用量的 per-user 口径。
- 删号、离队、撤回的向量清理有明确抓手。

非目标：

- 不改授权模型。`memoReadScope` 复查仍是唯一授权边界，namespace 只是缩小候选面的性能与隔离手段，不是权限判断。
- 不做 per-user × per-team 的 namespace 乘积。
- 不引入第二个 Vectorize index；一切分区内嵌在现有 `VECTORIZE_MEMOS` 里。

## 4. Namespace 布局

```text
一个 Vectorize index（VECTORIZE_MEMOS）
├─ namespace "user:{userId}"   作者私密 memo 的全部 chunk 向量
├─ namespace "user:{userId}"   …每个用户一组
└─ namespace "team:{teamId}"   对团队可见 memo 的全部 chunk 向量
```

- 命名格式：`user:{userId}` 与 `team:{teamId}`。当前一个部署只有一个团队、没有 teams 表，`teamId` 用常量 `default`；预留格式是为未来多团队留路（届时改名走全量重建，成本可控）。
- **一条 memo 的向量在任一时刻只存在于一个 namespace**（见 §6 搬迁原语）。禁止"个人一份、团队一份"的双份共存设计。
- namespace 上限（Workers Paid 每 index 50,000 个）只按"用户数 + 1"增长，纪律是**禁止任何用户×团队的乘积粒度**；超限时先向 Cloudflare 申请加额，退路是 C 方案的 metadata 过滤。
- metadata 维持现状两个字段：`{ "memo_id": "…", "user_id": "…" }`，不放可见性、不放内容。可见性以 D1 为准，metadata 不参与授权。

## 5. 目标 namespace 的判定

以 D1 当时的可见性为唯一依据，不存额外状态：

```text
memo.visibility === "private"  → namespace = user:{memo.userId}
memo.visibility ∈ {protected, public} → namespace = team:default
```

作者本人的搜索同时覆盖个人与团队分区（他自己发布的团队 memo 也能被自己搜到），与 `memoReadScope` 的可见性并集语义一致。

## 6. 向量生命周期与搬迁原语

### 6.1 搬迁原语 relocate

新增 outbox 操作类型 `relocate`，派发时的执行顺序**固定为读值 → 删除 → 写入**：

1. 从 D1 重读 memo（最新内容、最新可见性），用 `chunkText` 确定性地推导全部 chunk id（不调用 embedding，纯函数）。
2. 用 `getByIds` 把这些 chunk id 的向量值原样读回（Vectorize 支持，返回 values + metadata）。
3. `deleteByIds` 删除这些 id。**必须先删再写**：Vectorize 的 `deleteByIds` 不带 namespace 参数、按 id 删除（官方语义为 index 级），且向量 id 在 index 层的跨 namespace 唯一性没有文档保证——先写后删可能连带删掉新分区里的副本，或留下跨分区同 id 的歧义。先删再写对两种删除语义都安全。
4. 按当前可见性推导目标 namespace（§5），把读回的值带 `namespace` upsert 写入。
5. 更新 D1 的 `embedding_status` / `embedding_version` / `embedded_at` / `embedding_chunks`。

时序上的语义盲窗：步骤 3 与 4 之间该 memo 短暂不参与语义召回（秒级，D1 列表与详情不受影响），outbox 重试兜底完成度，不追求跨步原子性。

**实施前提**：需要一次线上验证确认 `deleteByIds` 在实测中确实是 index 级生效（本设计的删除顺序对两种语义均正确，验证只影响注释措辞与失败排查预期）。

### 6.2 各触发路径

| 触发 | 行为 |
| --- | --- |
| 创建 memo | 现有 `index` 流程不变，写入位置由当时可见性决定（§5） |
| 编辑内容 | 现有 `reindex` 流程不变，写入位置由当时可见性决定；如可见性同时变了，最后跑完的任务以 D1 最新状态为准（§6.3） |
| **发布到团队**（private → protected/public） | `updateMemo` 向 outbox 投递 `relocate` 任务，请求路径的 post-response sweep 立即派发（用户可见时序为发布完成后的秒级）；失败由 outbox 重试兜底 |
| **撤回**（→ private） | 同上，投递 `relocate` 任务搬回个人分区 |
| 删除 / 回收站 / hard delete | 现有 `delete` 流程不变（`deleteByIds` 是 index 级的，天然覆盖任何 namespace 里的残留） |
| 作者离队（status 离开 active） | 其团队可见 memo 的向量保留在团队分区（团队知识沉淀，与现行 A 布局的"刻意保留"一致）；其个人分区的向量保留（账号未删，数据仍归本人） |
| **删号** | 走现有 artifact cleanup：按 memo id 的 index 级 `deleteByIds` 清掉个人与团队分区里的全部向量 |
| 换 embedding 模型/维度 | 走现有全量重建，重建时按 §5 决定每个 memo 的写入分区 |

### 6.3 并发与顺序

dispatch 顺序（`embedding_tasks.id` asc）不保证跨操作类型的业务顺序。安全性来自两条：每个任务派发时都以 D1 当前状态重读、以当前可见性决定写入分区（"最后写入者落在正确位置"），以及 relocate 的先删后写避免残留。极端交错（如编辑与搬迁任务并发）最坏结果是短暂的旧值候选，由 D1 复查与下一次任务纠正，不产生权限语义错误。

### 6.4 chunk 计数列

新增 `memos.embedding_chunks`（int nullable）：索引成功时记录 chunk 数。用途：

- 用量报表按用户精确统计向量数（§8）；
- 删除/搬迁用精确 chunk id 列表替代现在 `EMBEDDING_MAX_CHUNKS = 256` 的宽扫（列缺失时保留宽扫兜底）。

## 7. 查询流程

`/api/app/search/semantic` 改为按 namespace 分组查询后合并：

1. 生成查询向量（provider/模型不变）。
2. 确定要查的 namespace 集合：
   - 个人分区 `user:{user.id}`：总是查。
   - 团队分区 `team:default`：仅当 `FLAREMO_VECTORIZE_TEAM_LAYOUT` 启用（默认启用）且调用者是活跃团队成员（`isActiveTeamMember`，请求上下文里现成，零额外查询）。
   - 团队分区不可用时只查个人分区，属配置错误而非降级（见 §7.2）。
3. 总候选预算沿现有规则（`min(limit * 5, 100)`），**在两组之间拆分**（默认五五开），不再依赖 5 倍放大对冲稀释；两组各自去 chunk 后缀、合并 memo 去重、取每 memo 最高分。
4. D1 复查边界一字不动：`memoReadScope` + `status in (normal, archived)` 批量复核，仍是唯一授权边界。
5. 后续聚合、排序、DTO 组装不变。

成本口径：Vectorize 查询按参与的向量数计费而非按请求数，拆分两组的总预算与现单次查询同量级；且候选有效率大幅提高后，放大系数（5 倍）可在实测后收紧，总查询成本预期下降。

### 7.1 配置

新增环境变量（默认全开，个人自部署可关）：

```text
FLAREMO_VECTORIZE_TEAM_LAYOUT = "team" | "solo"   # solo：不建团队分区、不查团队分区、隐藏团队发布入口
```

### 7.2 边界情况

- 成员刚离队但上下文里仍是 active：多查一次团队分区，多余候选被 D1 复查丢弃，浪费预算、不泄内容，不为它做实时失效。
- solo 配置下却存在团队可见 memo：语义搜索只会从个人分区召回这些 memo 的旧位置（若搬迁前写入），D1 复查保证不越权；这是配置错误，产品上应在 solo 配置时隐藏团队分享入口。

## 8. 用量与配额修正

- `/usage/vector` 的 per-user 口径改为 D1 派生：按用户聚合 `embedding_status = 'indexed'` 且 `embedding_chunks` 非空的 memo 的 chunk 数，替代 `index.describe()` 的全实例总数。
- `describe()` 的全实例数字只保留在部署级运维视图（或单独的管理端点），不再下发到普通用户。
- per-user 限额（`storedLimit` / `queriedLimit`）改为与上述真实 per-user 口径比较。

## 9. 存量迁移与重建

- 迁移即一次全量重建（现有 `rebuildEmbeddingIndexes` 扩展为按 §5 决定分区），幂等可重复。
- 存量 SaaS 实例数据量小，走备份演练同款流程（`pnpm backup:drill` 扩展目标布局），重建期间语义搜索短暂降级为 FTS5，不阻塞业务。
- 重建完成后校验：每个 normal/archived memo 的向量恰好存在于其目标 namespace；无跨分区同 id 残留（用 `getByIds` 抽查）。
- 自部署与企业实例（kosx）随下次滚动部署一并重建。

## 10. 失败语义与降级

- 搬迁失败只影响语义召回的分区正确性，不影响 D1 与业务；outbox 按现有 MAX_ATTEMPTS / 退避 / dead 状态处理，dead 时照常写 `embedding_error`。
- 任何中间态（向量在错误分区、短暂缺失、残留旧副本）都不会造成越权：查询永远以 D1 `memoReadScope` 复查为最终闸门。这是全设计的兜底不变量。
- Vectorize / Workers AI 不可用时的整体降级路径维持不变（回退 FTS5）。

## 11. 实施清单

域层（packages/domain）：

- `embedding.ts`：`VectorIndex` 接口新增 `getByIds(ids)`；
- `embedding-outbox.ts`：新增 `relocate` 操作与派发逻辑；index/reindex/delete 按可见性写入对应 namespace；全量重建按分区写入；
- `usage.ts`：`reportVectorUsage` 改 D1 派生 per-user 口径；
- 新增 namespace 推导工具（visibility → namespace），含常量 `default` teamId。

数据层：

- 迁移：`memos.embedding_chunks`；
- schema 类型同步。

应用层（apps/worker）：

- `embedding.ts` 适配器实现 `getByIds`，新增 `memoSearchNamespaces`（按 `FLAREMO_VECTORIZE_TEAM_LAYOUT` 推导查询分区）；
- 发布/撤回经 `updateMemo` 投递 `relocate` 任务，由现有请求路径 post-response sweep 派发（不另设路由内搬迁）；
- `/api/app/search/semantic` 双 namespace 查询合并；
- `/usage/vector` 口径切换（D1 派生 per-user）；
- `FLAREMO_VECTORIZE_TEAM_LAYOUT` 配置与 `/health` 的 `team_layout` 字段；solo 前端隐藏团队发布入口为后续小项（solo 下 protected 可见性无团队成员可泄漏，仅影响语义搜索布局，非安全项）。

文档：

- 实施合并后同步更新 `semantic-search.md` 的 A 布局描述为本设计。

测试：

- relocate 单元测试（读值→删→写顺序、可见性推导、chunk id 确定性、读回缺失时重 embed 自愈、失败重试）；
- 发布/撤回/离队/删号的端到端 outbox 断言；
- 双 namespace 查询合并与 top-K 拆分的召回断言；
- 用量报表 per-user 口径断言；
- 存量迁移演练（backup:drill 扩展）；
- 线上验证 `deleteByIds` 删除语义的脚本（一次性）。

## 12. 风险登记

| 风险 | 缓解 |
| --- | --- |
| `deleteByIds` 跨 namespace 语义不明确 | 固定"先删后写"顺序，对两种语义都正确；上线前线上验证 |
| 搬迁与编辑任务交错产生旧值候选 | D1 复查兜底 + 任务以 D1 当前状态重读，无权限语义错误 |
| solo/team 配置与实际数据不一致 | 查询降级到个人分区不越权；产品层隐藏不一致入口 |
| namespace 逼近 5 万上限 | 监控用户数，超限前申请加额或切 C 方案 |
| 双查询合并的分数不可比（cosine 分数同模型可比，无需归一） | 同一 index、同一模型，分数直接可比；合并取每 memo 最高分 |
