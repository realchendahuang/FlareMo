# Agent Memory：AI 长期记忆中枢

FlareMo 除了记录「你写过什么」（Memo），还提供一套独立的 **Agent Memory**，回答「AI 应该长期记住什么」：让 Claude Code / Codex / Pi / DeepSeek Harness 等 Agent 通过一个统一的 MCP 端点读写跨 session、跨 Agent 共享的长期记忆（用户偏好、项目决策、约束、经验、流程），而你在 FlareMo Web 界面随时能查看、确认、锁定、纠正、删除 AI 记下的每一条。

定位是 **FlareMo = Human Knowledge (Memo) + Agent Memory**：记忆归用户所有，Agent 只是读者和贡献者。

## 与 Memo 的边界

- **Memo** 是时间线上的记录，可长可短，属于「事件流」。
- **Memory** 是原子结论，一条记忆表达一个稳定事实（例如「FlareMo 用 D1 作为事实源」），上限 4000 字；长内容存 Memo，Memory 只存结论。
- 两者通过 `derived_from` / `promoted_to` 双向连接：memo 可以提炼为 memory，memory 可以展开为 memo。

## 认证

Agent Memory 复用 FlareMo 的 Better Auth 应用层认证，**不新增第二套令牌**。Agent 通过可撤销的 `memos_pat_` Personal Access Token 访问；浏览器管理界面走 HttpOnly cookie session。若生产仍启用 Cloudflare Access，再附加成对的 Access Service Token，但 Access Service Token 单独不能成为 FlareMo 身份。

先在 Web 界面创建一个有明确用途和过期时间的 PAT，然后连接 `/memory/mcp`（无状态 Streamable HTTP MCP）。它和既有的 `/mcp`、`/api/v1/mcp`（memo 工具子集）是**不同端点**，互不干扰。

## 快速连接

```bash
curl "$FLAREMO_URL/memory/mcp" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $FLAREMO_MEMOS_PAT" \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}'
```

工具发现：

```bash
curl "$FLAREMO_URL/memory/mcp" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $FLAREMO_MEMOS_PAT" \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

## 六个工具

| 工具 | 作用 | 调用时机 |
| --- | --- | --- |
| `memory_bootstrap` | 恢复全局 + 项目的 core 记忆、重要决策/约束、近期教训 | 进入新项目或重要会话时调用一次，不要每轮都调 |
| `memory_recall` | 按自然语言查询召回相关记忆 | 任务涉及历史决策、偏好、约束、过往失败时 |
| `memory_remember` | 存一条原子长期事实 | 发现跨 session 有价值的稳定结论时 |
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
  -H "Authorization: Bearer $FLAREMO_MEMOS_PAT" \
  --data '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memory_bootstrap","arguments":{"agent":"codex","project_key":"github:owner/repo"}}}'

# 记一条决策
curl "$FLAREMO_URL/memory/mcp" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $FLAREMO_MEMOS_PAT" \
  --data '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"memory_remember","arguments":{"content":"FlareMo 用 D1 作为业务数据事实源","type":"semantic","kind":"decision","scope_type":"project","scope_key":"github:owner/repo"}}}'
```

## 权限模型

用户权限永远高于 Agent：

```
locked > confirmed > observed > inferred
```

- Agent 只能以 `observed` / `inferred` 写入，**永远不能 lock 或 confirm** 一条记忆。
- Agent 不能覆盖用户 `confirmed` / `locked` 的记忆；遇到矛盾时应改用 `memory_link` 提出 `contradicts` 关系，或让用户处理。
- Agent 从不硬删除；`memory_forget` 只会归档或标记替代，历史保留。只有用户能在 UI 里物理删除。
- 写入门禁会拒绝凭据（`Authorization` / `cookie` / `memos_pat_` / 私钥 / 密码），并做 SHA-256 指纹精确去重。

## 当前边界（P0）

这些是刻意后置、不是缺陷，设计上已预留扩展位：

- **召回是关键词（FTS5 trigram）不是语义**：schema 已预留 `embedding_status` 等向量字段，但 P0 恒为 `not_indexed`，不接 Vectorize / Workers AI。语义召回见 [语义搜索](./semantic-search.md) 的同一套基础设施规划。
- **不自动固化**：Agent 需要主动调用 `remember` / `checkpoint`；P0 不会在会话结束后自动调 LLM 提炼。
- **`source_agent` 是字符串**：用于来源标注和按 agent scope 隔离，不是注册的身份系统。
- **单用户**：所有查询都带 `user_id`，多用户协作不在当前范围。

## 管理界面

Web 的 `/memory` 页面提供 Core / Projects / Recent / Review / Archive 分栏：查看 AI 记下的每条记忆的来源与可信度，确认、锁定、纠正、归档或删除；Review 分栏汇总 `inferred` 待确认与 `disputed` 冲突项。memo 详情页可「记为 Memory」，memory 卡片可「转为记录」。

导出时 memory 四表纳入 bundle（version 3），fingerprint、访问计数与 embedding 派生字段不导出，导入时重建。
