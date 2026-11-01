# Agent Memory：AI 长期记忆中枢

FlareMo 除了记录「你写过什么」（Memo），还提供一套独立的 **Agent Memory**，回答「AI 应该长期记住什么」：让 Claude Code / Codex / Pi / ZCode 等 Agent 通过 **CLI 命令与 Skills 工作规约**读写跨 session、跨 Agent 共享的长期记忆（用户偏好、项目决策、约束、经验、流程），而你在 FlareMo Web 界面随时能查看、确认、锁定、纠正、删除 AI 记下的每一条。

定位是 **FlareMo = Human Knowledge (Memo) + Agent Memory**：记忆归用户所有，Agent 只是读者和贡献者。

## 与 Memo 的边界

- **Memo** 是时间线上的记录，可长可短，属于「事件流」。
- **Memory** 是原子结论，一条记忆表达一个稳定事实（例如「FlareMo 用 D1 作为事实源」），上限 4000 字；长内容存 Memo，Memory 只存结论。
- 两者通过 `derived_from` / `promoted_to` 双向连接：memo 可以提炼为 memory，memory 可以展开为 memo。

## 推荐接入：CLI + Skills（最佳实践）

接入原则（设计规范 [memory-ledger-design.md](./memory-ledger-design.md) §八）：**REST 是唯一基底，CLI 与 Skill 是对外的主路径**。两者都随 FlareMo 仓库分发、随开源仓库发布。

> **Harness 适配**：本文描述的是 CLI + Skill 最佳实践；各 Harness（首发 ZCode / Codex / Antigravity）的针对性插件、替换原生自动记忆、五层召回与四路写入、从 GitHub 仓库安装的方案见 [harness-adapter-spec.md](./harness-adapter-spec.md)（v0.2）。业界记忆系统对标调研与最佳实践结论见 [agent-memory-landscape.md](./agent-memory-landscape.md)。

- **CLI**：仓库根 `bin/flaremo`，`package.json` 已注册 `bin` 字段。克隆仓库后安装：

  ```bash
  npm install -g .    # 或 pnpm link --global；也可直接 node bin/flaremo
  ```

- **Skill**：`skills/flaremo-memory/SKILL.md`——跨 Agent（Claude Code、Codex、Pi、ZCode 等）的标准工作规约：开工先查规矩、工作中记事实、收工写战报、服务不可达时显式声明。把它装进支持 skills 的工具目录（如 `~/.agents/skills/flaremo-memory/`）即可获得一致行为，无需任何 system prompt。

CLI 通过两个环境变量定位实例与凭据：

```bash
export FLAREMO_URL="https://flaremo.example.com"   # 你的 FlareMo 实例
export FLAREMO_PAT="memos_pat_…"                    # Web 界面创建的 PAT
```

日常四步：

```bash
flaremo lens                       # 开工：当前项目的随身锦囊（服务端编译的真实投影）
flaremo recall "数据库迁移规范"      # 定向检索历史规矩与踩坑
flaremo remember "结论" --key "deploy.wrangler_config"  # 记一条事实（同键自动版本断代）
flaremo checkpoint "本次战报"       # 收工：沉淀 episodic 战报与原子结论
```

另有 `flaremo status`（看生效便签）与 `flaremo seed`（冷启动：扫描 README/AGENTS 递交候选便签）。**退出码契约**（`0` 成功 / `0`+离线告警 / `1` 错误 / `3` 服务不可达）与弱网下的本地快照降级写在 Skill 里——**「查到了规矩」与「只拿到旧快照」必须能分辨**，否则 Agent 会把过期快照当当前事实。

CLI 是能力面的命令行子集：`lens`↔`memory_compile`、`recall`↔`memory_recall`、`remember`↔`memory_remember`、`checkpoint`↔`memory_checkpoint`、`status`↔`memory_bootstrap`。关系编辑（`memory_link`）与归档（`memory_forget`）走 Web 界面或下面的 MCP 端点。

## 认证

Agent Memory 复用 FlareMo 的 Better Auth 应用层认证，**不新增第二套令牌**。Agent 通过可撤销的 `memos_pat_` Personal Access Token 访问；浏览器管理界面走 HttpOnly cookie session。若生产仍启用 Cloudflare Access，再附加成对的 Access Service Token，但 Access Service Token 单独不能成为 FlareMo 身份。

先在 Web 界面创建一个有明确用途和过期时间的 PAT。

## 备选接入：MCP 端点

既有 MCP 客户端可以直接连 `/memory/mcp`（无状态 Streamable HTTP MCP）。它与 CLI/Skills 共用同一套 REST 域语义，不产生第二套语义；与既有的 `/mcp`、`/api/v1/mcp`（memo 工具子集）是**不同端点**，互不干扰。

工具发现：

```bash
curl "$FLAREMO_URL/memory/mcp" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $FLAREMO_PAT" \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

七个工具：

| 工具 | 作用 | 调用时机 |
| --- | --- | --- |
| `memory_bootstrap` | 恢复全局 + 项目的 core 记忆、重要决策/约束、近期教训 | 进入新项目或重要会话时调用一次，不要每轮都调 |
| `memory_recall` | 混合召回：事实键精确命中、全文、语义、关系四路融合，返回命中路径 | 任务涉及历史决策、偏好、约束、过往失败时 |
| `memory_remember` | 存一条原子长期事实（支持 `fact_key` 版本断代与证据链） | 发现跨 session 有价值的稳定结论时 |
| `memory_compile` | 编译当前情境的完整锦囊（确定性、受字符预算约束、铁律硬包含、自动留档） | 需要和别的 Agent 拿到同一份投影时；优先于自行拼装 bootstrap 结果 |
| `memory_checkpoint` | 把一段完成的工作提炼为 1 条 episodic 摘要 + 若干原子记忆 | 完成重要功能、设计、调研、决策后 |
| `memory_link` | 建记忆间或记忆到资源的关系（`supersedes`/`contradicts`/`supports` 等） | 发现新旧记忆矛盾、替代、支撑关系时 |
| `memory_forget` | 归档或替代一条已不正确的记忆 | 发现记忆已错、已过时、已无关时 |

每个工具的 description 已经内联了调用策略，任何 MCP 客户端连上即可获得一致行为，无需额外 system prompt。

### 关键参数

- **scope**：记忆按 `global` / `workspace` / `project` / `agent` 分域。召回与 bootstrap 默认覆盖 `global` + 当前 `project_key`（如 `github:owner/repo`）+ 当前 `agent`，**禁止跨 project 召回**。
- **type**：`semantic`（事实/知识）、`episodic`（事件/经历）、`procedural`（流程/方法）。
- **kind**：`preference` / `fact` / `decision` / `constraint` / `entity` / `event` / `outcome` / `lesson` / `procedure`。

### 典型调用

```bash
# 进入项目时恢复上下文（一次）
curl "$FLAREMO_URL/memory/mcp" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $FLAREMO_PAT" \
  --data '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memory_bootstrap","arguments":{"agent":"codex","project_key":"github:owner/repo"}}}'

# 记一条决策
curl "$FLAREMO_URL/memory/mcp" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $FLAREMO_PAT" \
  --data '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"memory_remember","arguments":{"content":"FlareMo 用 D1 作为业务数据事实源","type":"semantic","kind":"decision","scope_type":"project","scope_key":"github:owner/repo"}}}'
```

## 权限模型

用户权限永远高于 Agent：

```
locked > confirmed > observed > inferred
```

- Agent 只能以 `observed` / `inferred` 写入，**永远不能 lock 或 confirm** 一条记忆。
- Agent 不能覆盖用户 `confirmed` / `locked` 的记忆；遇到矛盾时用 `memory_link` 提出 `contradicts` 关系——**发起主张的记忆进入 Review 队列**（`needs_review`），被质疑的记忆原样不动、照常召回，由用户在界面裁决。
- Agent 从不硬删除；`memory_forget` 只会归档或标记替代，历史保留。只有用户能在 UI 里物理删除。
- 写入门禁会拒绝凭据（`Authorization` / `cookie` / `memos_pat_` / 私钥 / 密码），并做 SHA-256 指纹精确去重。

## 当前边界（P0）

这些是刻意后置、不是缺陷，设计上已预留扩展位：

- **混合召回**：`memory_recall` 并行走四路——`fact_key` 精确命中（命中即置顶）、全文索引（FTS5 bm25 相关度序）、`VECTORIZE_MEMORIES` 语义检索、关系 1-hop 展开——再按 RRF 融合排序；每条结果带上它命中了哪些路径。语义那一路依赖 embedding 基础设施（provider 或 index 不可用时该路自动缺席，其余三路照常工作），memory 向量按 `namespace = 记忆所属用户` 隔离，与 memo 语义搜索共用同一套基础设施，见 [语义搜索](./semantic-search.md)。
- **自动固化是离线提炼，不是对话中调用**：Agent 主动 `remember` / `checkpoint` 仍是主路径；「Dreaming」由每日维护窗口驱动——把扫描窗口内的新 memo 与 checkpoint 提炼成 💡 猜想送进审核箱（Workers AI 提炼，`FLAREMO_MEMORY_DREAMING=off` 可关），**永不直接进锦囊**、**永不自动替代人类资产**，且受每日提案配额（默认 5，`FLAREMO_MEMORY_PROPOSAL_DAILY_LIMIT`）、近 30 天驳回 fact_key 的提示词护栏与指纹去重约束。每周一另有冲突巡检：抽样人类资产查内部矛盾，发现一律提案、绝不改动。
- **生命周期有维护任务兜底**：💡 猜想 N 天（默认 14）未被处理会自动归档；👀 记忆 90 天未被召回自动沉底（人类资产永不沉底；召回会记录访问时间）；已替代 / 已归档 / 已过有效期或 `expires_at` 的条目，其向量由每日维护任务回收（未来生效的替代会留向量到生效日）；修订超 50 版折叠为里程碑快照；配额触顶先沉底清理、仍不足才明确拒绝。
- **证据有失效检测**：memo 来源的依据由每日维护比对——来源改了标【依据已变更】、来源没了标【依据缺失】并把该条送回审核箱，由人类重新取证或退役。
- **事实键有治理**：调用方给的键统一归一化（`Project.Database` → `project.database`）；未给键时优先复用同族既有键（主话题匹配既有键尾段），族不存在则保持无键，绝不由裸话题凭空铸键。
- **注入留档**：Agent 的 `memory_compile` 每次实际注入自动存档；Web `/memory/lens` 端点同时返回重算预览与最近一次实际注入，两者不一致时以存档为准。
- **`source_agent` 是字符串**：用于来源标注和按 agent scope 隔离，不是注册的身份系统。
- **单用户**：所有查询都带 `user_id`，多用户协作不在当前范围。

## 管理界面

Web 的 `/memory` 页面提供 Core / Projects / Recent / Review / Archive 分栏：查看 AI 记下的每条记忆的来源与可信度，确认、锁定、纠正、归档或删除；Review 分栏汇总 `inferred` 待确认与 `disputed` 冲突项。memo 详情页可「记为 Memory」，memory 卡片可「转为记录」。

导出时记忆六类数据纳入 bundle（version 6：items / revisions / relations / resource-links / evidence / events），fingerprint、访问计数与 embedding 派生字段不导出，导入时重建。
