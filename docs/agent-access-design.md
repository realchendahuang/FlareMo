# Agent 与第三方客户端接入设计

> 状态：设计已定，待实现（2026-11-08 拍板）
> 决策来源：用户确认「配对码就配对码吧」，并要求按本文方案落地。
> 关联文档：`docs/agent-ingestion.md`（Agent 写入契约）、`docs/architecture-notes.md`（认证边界）、`docs/semantic-search.md`（派生索引用例）。

## 0. 结论摘要

FlareMo 要长出一套**通用的第三方客户端接入层**，而不是给某个客户端做定制：

1. **授权方式按客户端类型分流**：本地 Agent/桌面/CLI 用设备授权（配对码），有回调地址的 Web 应用将来用 OAuth 授权码 + PKCE，无交互脚本用手动 PAT。
2. **配对码不是协议名**，它是设备授权（RFC 8628）里 `user_code` 的界面叫法；协议层保持标准形状，将来加 OAuth 不推翻重来。
3. **首次授权发短期 access token + refresh token**，之后静默续期，不要求用户反复配对。
4. **用户有一处能看见「谁连了我的库」**：已连接应用列表，带应用名、创建时间、最后使用、一键撤销。
5. **AI 洞察契约化**：FlareMo 定义洞察任务的输入/输出与存储，AI 执行器外置（DSH、Workers AI、其他 agent 都可实现），产品不内置模型、不养对话 AI。
6. DSH 是第一个接入的客户端，但协议不绑定 DSH。

## 1. 背景

- FlareMo 现在是「人类 Web/PWA + Agent 通过 MCP 读写笔记」的形态，第三方接入只有一种手段：用户在浏览器里手动创建 `memos_pat_`。
- 这带来三个问题：用户要理解并复制 40 位令牌；令牌没有应用身份，用户看不出「谁在用」；每个新客户端都要教用户重复一遍。
- 产品路线图已经把「AI 原生第二大脑」「Agent 通过 MCP 读写同一份笔记」列为主线，但「AI 洞察」未实现，且待决策问题明确写「洞察的模型放哪」。
- 结论：接入层与能力层要一起设计，否则每个客户端都会各自造一套。

## 2. 设计原则

1. **协议标准优先**：设备授权按 RFC 8628 实现，不自创协议。
2. **客户端类型分流**：不为所有客户端硬塞同一种流程。
3. **人在环上**：所有授权都要用户显式批准；Agent 不能自我授权。
4. **可撤销、可看见**：任何令牌都有归因（哪个应用）、最后使用时间、撤销入口。
5. **产品不养 AI**：FlareMo 不做对话型 AI、不存 AI 记忆；只定义派生能力的契约与存储。
6. **兼容面不动**：`/api/v1/*` 与 MCP 既有形状不变，新能力只增不改。

## 3. 客户端类型与授权方式

| 客户端类型 | 首次授权 | 续期方式 | 典型客户端 |
| --- | --- | --- | --- |
| 本地 Agent / 桌面 / CLI（无回调地址） | 设备授权（配对码） | refresh token 静默续期 | DeepSeek Harness、Raycast、本地脚本 |
| 有回调地址的 Web 应用（第二阶段） | OAuth 2.1 授权码 + PKCE | refresh token | 第三方笔记面板、浏览器扩展 |
| 无交互脚本 / CI | 手动 PAT | 到期手动轮换 | 定时任务、部署脚本、Bot |

**第一版只实现「设备授权 + 手动 PAT」两条。** OAuth 授权码 + PKCE 留到出现真实的 Web 第三方客户端再做，但数据模型与令牌模型按可扩展设计。

## 4. 设备授权（配对码）

### 4.1 用户视角

1. FlareMo Web → 设置 → 集成 →「连接应用」→ 生成配对码（8 位、5 分钟、一次性）。
2. 在客户端（如 DSH 插件）里粘贴配对码。
3. 客户端后台完成兑换，显示「已连接：实例 + 账号」。
4. 之后在「已连接应用」里随时可撤销。

### 4.2 协议流程（RFC 8628）

```
客户端                          FlareMo                       用户浏览器
  │ POST /connect/device           │                               │
  │  {client_name, client_type,    │                               │
  │   scopes}                      │                               │
  │───────────────────────────────>│ 生成 user_code + device_code   │
  │<───────────────────────────────│ {user_code, device_code,       │
  │                                │  expires_in, interval}         │
  │                                │                               │
  │                   用户在 FlareMo 设置里输入 user_code            │
  │                                │<──────────────────────────────│
  │                                │ POST /api/app/connect/approve  │
  │                                │  {user_code, scopes}           │
  │                                │  → 标记 approved               │
  │                                │                               │
  │ POST /connect/token（轮询）     │                               │
  │  {device_code}                 │                               │
  │───────────────────────────────>│ 校验 approved                  │
  │<───────────────────────────────│ {access_token, refresh_token,  │
  │                                │  expires_in, scope}            │
```

### 4.3 端点

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| POST | `/connect/device` | 无（限速） | 申请设备码与用户码 |
| POST | `/connect/token` | 无（凭 device_code/refresh_token） | 轮询兑换；也用于刷新 |
| POST | `/api/app/connect/approve` | 浏览器会话 | 用户批准配对码 |
| GET | `/api/app/connect/apps` | 浏览器会话 | 已连接应用列表 |
| DELETE | `/api/app/connect/apps/:id` | 浏览器会话 | 撤销某个应用的全部令牌 |

约定：

- `/connect/*` 是公开端点，必须限速（按 IP + 按实例），失败返回统一错误码。
- 浏览器批准端点复用 `getBrowserRequestContext`（cookie 会话），不接受 `authorization` 头。
- 撤销复用 Better Auth api-key 的 `updateApiKey({enabled:false})`，不新建令牌体系。

### 4.4 数据模型（实现）

实际实现是三张表（migration `0046_agent_access`），令牌本身继续用 `auth_apikeys`（Better Auth api-key 插件），不另起炉灶；时间戳沿用 domain 表的 ISO text。

| 表 | 作用 |
| --- | --- |
| `app_clients` | 客户端身份：`name`、`client_type`、`redirect_uri`（OAuth 预留）、`created_by_auth_user_id`、`last_seen_at` |
| `device_authorizations` | 一次性的设备授权请求：`user_code_hash` / `device_code_hash` 只存 SHA-256；`auth_user_id` 在浏览器批准前为 NULL |
| `device_refresh_tokens` | 可轮换的 refresh token：`token_hash`、`access_key_id`（指向 `auth_apikeys.id`）、过期与撤销时间 |

关键点：

- `device_authorizations.auth_user_id` **可空**——生成时还没有用户，浏览器批准时才绑定。
- access token 就是一条 `auth_apikeys` 行，现有 PAT 校验路径（`verifyApiKey` + scope 判定）不需要改动。
- refresh token 每次刷新轮换：旧的 access token 置为 disabled、旧 refresh token 撤销、发新的一对。
- `auth_apikeys.lastRequest` 就是「已连接应用」里的最后使用时间。

### 4.5 安全要求

- `user_code`：高熵（≥ 8 位 Base32，去掉易混字符）、一次性、5 分钟过期。
- `device_code`：32 字节随机、只存哈希、与 `user_code` 分离。
- 轮询间隔：`interval` 秒（默认 5），客户端必须遵守，服务端对超频返回 `slow_down`。
- 生成与兑换都限速；同一实例单位时间最多 N 次。
- 兑换成功把设备授权标记为 `redeemed`；重放返回 `invalid_grant`，过期返回 `expired_token`。
- 配对码只能由浏览器会话生成，且用户能在「已连接应用」里看到来源。

## 5. 手动 PAT（保留并升级）

保留现有 `POST /api/app/account/personal-access-tokens`，增强：

- 创建时可选 `client_name`（应用名），写入 `metadata.client_id` 或独立字段，让「已连接应用」能显示来源。
- 列表返回 `lastUsedAt`（已有 `lastRequest`）、`scopes`、`clientName`。
- 有效期规则不变：默认 365 天，notes-only 可显式永久，admin 必须有限期。

## 6. 令牌生命周期

| 项 | 决定 |
| --- | --- |
| access token | 短期（建议 7–30 天），设备授权返回 |
| refresh token | 长期（建议 90 天闲置过期），静默续期 |
| 续期 | `POST /connect/token` 带 `grant_type=refresh_token` |
| 过期 | access 过期由客户端自动刷新；refresh 过期才需要重新配对 |
| 撤销 | 撤销应用 = 该应用全部 refresh/access 失效；单项撤销也可做 |
| 轮换 | 每次刷新轮换 refresh token：旧 access token 禁用、旧 refresh 撤销，降低泄漏窗口 |

实现：access token = `auth_apikeys` 行（14 天）；refresh token = `device_refresh_tokens` 行（90 天，轮换即重建）。

**体验红线**：正常使用下，用户只在首次配对时输一次码；此后不得要求重复配对。

## 7. 「已连接应用」页

位置：设置 → 集成 → 已连接应用。

字段：应用名、类型、连接时间、最后使用、权限范围、状态、撤销。

行为：

- 撤销前二次确认，文案说明「撤销后该应用立即失去访问权限」。
- 最后一列显示「上次使用」；长期未使用的连接标灰（可选，后续）。
- 只展示第三方客户端（有客户端身份归属的设备令牌）；手动创建的 PAT 仍只出现在「个人访问令牌」列表，避免两处重复。撤销后的应用直接从列表消失。

## 8. 多实例（客户端侧约定）

FlareMo 是自托管产品，用户可能连接多个实例（SaaS、自托管、本地开发）。服务端不需要感知多实例，但客户端应遵守：

1. **具名连接**：每个实例一个 alias（`kosx`、`saas`、`local`），显示名可改。
2. **一个默认**：AI 工具、快捷记录、命令默认落到默认实例。
3. **切换器**：工作台顶部切换后，时间线/搜索/详情全部跟随。
4. **工具带 `instance` 参数**：`flaremo_search_notes(q, instance?)`；另提供 `flaremo_list_instances`。
5. **不做聚合视图**：不同实例的笔记不混排，避免 id 冲突、排序语义与写入歧义。
6. **每实例独立缓存与凭据引用**，凭据存客户端的安全存储，配置只存引用。
7. **写回跟随来源**：洞察结果写回笔记所在实例，不是默认实例。
8. **断开双向**：客户端清凭据 + 缓存，并提示用户到实例侧撤销应用。

## 9. AI 洞察契约（外置执行器）

### 9.1 为什么外置

- FlareMo 不内置模型、不做对话 AI（沿用产品边界）。
- 模型可达性与成本因部署而异（Workers AI 国内一般、外部 API 需要 key），外置让执行器可选。
- DSH 只是第一个执行器，不是唯一。

### 9.2 资源模型

```sql
CREATE TABLE memo_insights (
  id          TEXT PRIMARY KEY,        -- 'insights/<uuid>'
  user_id     TEXT NOT NULL,           -- FK users.id, cascade
  kind        TEXT NOT NULL,           -- 'note' | 'digest' | 'map'
  input       TEXT NOT NULL,           -- JSON：memo_ids / tag / query
  status      TEXT NOT NULL,           -- 'pending' | 'running' | 'done' | 'failed'
  result      TEXT,                    -- JSON：结构化洞察，≤ 64 KB
  executor    TEXT,                    -- 'dsh' | 'workers-ai' | 'external' | null
  error       TEXT,
  created_at  TEXT NOT NULL,           -- ISO 8601
  updated_at  TEXT NOT NULL
);
```

派生数据：可删除、可重建，不进 D1 事实源，不进入导出包（除非用户显式选择）。

### 9.3 端点

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/app/insights` | PAT / 浏览器 | 创建任务 `{kind, memo_ids?, tag?, query?}` |
| GET | `/api/app/insights?status=pending&limit=50` | PAT / 浏览器 | 执行器拉 pending；浏览器可列自己的历史（只读自己的行） |
| GET | `/api/app/insights/:id` | PAT / 浏览器 | 读取结果 |
| PUT | `/api/app/insights/:id` | PAT | 写回结果（幂等，按 id + status 校验） |
| DELETE | `/api/app/insights/:id` | 浏览器 | 删除派生结果 |

### 9.4 状态机

`pending → running → done | failed`；`failed → pending` 允许重试（清空上一轮的 result/error/executor）。

- `done` / `failed` 为 first-write-wins：重复写回原样返回当前行（幂等）。
- 非法迁移返回 400。
- 只有 PAT 能写回结果（`PUT`）；浏览器会话只能创建、读取、删除自己的洞察。

### 9.5 权限

- `notes` scope 可创建、拉取、写回洞察；浏览器会话可创建、读取、删除，但不能写回结果。
- 洞察内容继承笔记的可见性；跨用户不可见。
- 后续是否加只读 `read` scope，见第 12 节。

## 10. DSH 作为第一个客户端

| 层 | 实现 |
| --- | --- |
| 接入 | 设备授权：插件设置页输入配对码；token 存 DSH 凭据服务 |
| 界面 | 全局面板（工作台）+ 左栏入口 + 会话右栏 tab |
| 数据 | host 代理（client 不直连，绕开 CORS），typert RPC |
| AI | 工具（`flaremo_*`）+ 选中注入会话（`agent.followup`）+ 面板预览（`ctx.llm`） |
| 洞察 | 插件 host 作为执行器：拉 pending → 用 DSH 模型生成 → 写回 |
| 多实例 | 按第 8 节实现连接列表与切换 |

协议不绑定 DSH：任何实现设备授权的客户端都可接入。

## 11. 实施阶段

| 阶段 | 内容 | 预估 |
| --- | --- | --- |
| P1 | 设备授权（表 + 三个端点）+ 已连接应用页 + PAT 元数据增强 | 3–4 天 |
| P2 | 洞察契约（表 + CRUD + 状态机）+ web 展示入口 | 3–5 天 |
| P3 | DSH 插件（工作台 + 连接 + 工具 + 洞察执行器） | 4–5 天 |
| P4 | 文档、CHANGELOG、发版 | 1–2 天 |

## 12. 边界与不做

- **不做身份提供商**：FlareMo 不给第三方应用当登录源。
- **不做开放匿名注册**：客户端身份要有归属，动态注册需限流 + 用户可见。
- **不做对话型 AI、不做记忆账本**：沿用 2026-11-02 的决定。
- **不做聚合视图**：多实例只切换，不混排。
- **scope 保持粗粒度**：`notes` / `admin`（加 `read` 是后续项，见开放问题）。
- **不引入邮件/短信验证**：项目无 email provider。

## 13. 开放问题

1. `read` 只读 scope 是否 P1 就加？（影响 PAT 权限模型与客户端安全）
2. access token 有效期取 7 / 14 / 30 天哪个？
3. 「已连接应用」是否给手动 PAT 也标来源（创建时让用户填应用名）？
4. 洞察结果的保留期与清理策略（默认永久还是 90 天滚动）？
5. 设备授权是否要支持「同一客户端多设备」聚合展示？
