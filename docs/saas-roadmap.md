# FlareMo SaaS 化路线图

> 状态：本文档是规划而非承诺。具体任务在选定后拆到 GitHub Issues。
>
> Phase 0（官网与文档镜像）见 [`docs/site/prd.md`](./site/prd.md)。

## 商业模式

两条产品线共用一套代码：

| 维度 | 自部署（Deploy Button） | 托管（Hosted SaaS） |
| --- | --- | --- |
| 谁运维 | 用户自己（fork + Deploy Button） | FlareMo 团队（共享 Worker） |
| 数据位置 | 用户自己的 D1 / R2 | 共享 D1 / R2，按 `tenant_id` 行级隔离 |
| 域名 | 用户自己绑（`memo.example.com`） | 默认 `username.hosted.flaremo.app`，可绑自定义域 |
| 计费 | 免费（Apache-2.0） | Freemium：免费额度 + 会员升档 |
| 目标用户 | 折腾型个人开发者、有合规自托管需求 | 想直接用、不想部署的个人 |

### Freemium 档位

| 档位 | 月费 | 核心额度 |
| --- | --- | --- |
| Free | $0 | memo 1000 条 / 附件 1GB / Vectorize 关闭 / 1 设备 |
| Pro | $4/月 或 $36/年 | memo 50000 条 / 附件 25GB / 语义搜索开 / 5设备 / 自定义域 |
| Team | $9/席位/月 | Pro 全部 + 多用户共享 workspace |

### 关键商业约束

**Free 档的真实成本必须 ≤ 收到的边际利润**。Cloudflare 免费层下，10000 个 Free 用户的固定成本（D1/R2/Workers 共享）约几百美元/月，撑得住。**真正烧钱的是 Vectorize embedding 推理**——这是把 Free 档默认关闭语义搜索、Pro 档才能用的根本原因。

## Phase 1：自部署解锁（4 周）

不破坏现有 self-host 用户的前提下，给自部署一条「可以多人用」的扩展路径。

### 任务

- **T1.1 Better Auth 多用户 + magic link**：`magic-link` 插件 + 多用户表 + `FLAREMO_ALLOW_SIGNUP` env 开关（默认 `false` 保持兼容）
- **T1.2 D1 schema**：users 表加 `tenant_id`（自部署恒为 `null`）；不影响现有 memo IDs
- **T1.3 邀请注册**：新增 `/invite/:token` 路由；admin 生成邀请 token；登录页加 magic link tab
- **T1.4 文档翻译**：补齐 11 篇 docs/en/ 缺失翻译（按重要度排序：deploy > architecture > tech-stack > maintenance > semantic-search > release > product-requirements > memos-ecosystem > agent-ingestion > agent-memory > design-system > deploy-button-test）

### 不在 Phase 1 范围

- 不接 Stripe
- 不引入 Hosted 域名
- 不动 Better Auth cookie / PAT Origin 校验
- 不创建新 Worker

## Phase 2：Hosted PoC（4 周）

新 Worker `name: flaremo-hosted`，与 `flaremo` Worker 共用 `apps/web` + `apps/worker` 代码。

### 任务

- **T2.1 多租户数据隔离**：
  - D1 schema：所有业务表加 `tenant_id` 列；query 层强制 `where tenant_id = ?` 中间件
  - R2：按 `tenant_id/...` 前缀组织 key
  - Vectorize：namespace 按 `tenant_id`（CF 原生支持 metadata filter）
- **T2.2 Hosted Worker**：
  - 新 `wrangler.hosted.jsonc`，`main: apps/worker/src/index.ts`
  - `FLAREMO_PUBLIC_URL=https://hosted.flaremo.app`
  - Better Auth 多用户 + magic link 启用
- **T2.3 域名系统**：
  - `hosted.flaremo.app` → 默认登录入口
  - `*.hosted.flaremo.app` → Worker Custom Domains + Cloudflare for SaaS Custom Hostnames
  - SSL 自动通配证书
- **T2.4 配额执行**：
  - memo 数 / 附件字节 / embedding 调用次数
  - 月度 cron 重置配额（已存在的 `17 3 * * *` 可复用）
  - 超额返回 402 Payment Required，提示升级
- **T2.5 邮件**：
  - 接入 Resend 或 Cloudflare Email Workers（magic link 必需）
  - 营销站 `/hosted` 占位接成真注册流程（接 KV/D1 持久化）

### 不在 Phase 2 范围

- 不接 Stripe
- 不做团队 workspace（Phase 3）
- 不做自定义域付费（Phase 3）

## Phase 3：计费 + 增长（4 周）

### 任务

- **T3.1 Stripe**：
  - subscriptions / usage_records / invoices 表
  - webhook 路由 `/api/app/billing/webhook`
  - Stripe Customer Portal 自助升降级
  - 30 天退款策略
- **T3.2 配额 → 升级**：
  - quota middleware 检测到超额 → 返回 upgrade CTA
  - 触发 Stripe Checkout 跳转
- **T3.3 营销站升级**：
  - `/pricing` 接真 Stripe 价格
  - `/hosted` 占位改成真注册流程
  - `/changelog` 镜像（CHANGELOG.md 自动渲染）
- **T3.4 自定义域付费**：
  - CF for SaaS Custom Hostnames API
  - Pro 档可绑 1 个，Team 档可绑 3 个

### 不在 Phase 3 范围

- AI 回顾付费能力
- 推荐系统

## Phase 4：生态（持续）

- 文档站 SEO 深度优化
- 推荐链接 → 免费额度
- Discord / 微信群 onboarding
- AI 回顾（Workers AI / 外部模型）
- AI 洞察（多视角笔记分析）
- 团队 workspace 高级功能（审计、SSO、SCIM）

## 关键决策（待定）

1. **AI 模型放哪**：Cloudflare Workers AI（国内可达性一般）vs 外部模型（DeepSeek / OpenAI 走应用层令牌）
2. **每日回顾触达**：站内通知（已有 notification 表，成本最低）vs Web Push
3. **语音输入**：Workers AI speech-to-text 质量与国内体验待评估
4. **Stripe vs Creem / Paddle**：是否切到对国内开发者友好的支付平台

## 与现有架构的边界（再强调）

- 不复制 Memos Go server
- 不做 VPS / Docker / Postgres 部署主路径
- 不把 KV / R2 / Vectorize 当主数据库
- 不在应用里重造实例级 Bearer token 登录
- 不把未实现功能放进前端入口（Hosted 占位不是开放）
- 不把 Better Auth / PAT Origin 校验当可选项
- 不把 `BETTER_AUTH_SECRET` / `FLAREMO_BOOTSTRAP_SECRET` / 初始密码 / cookie / `memos_pat_` 写进代码、文档、migration、issue、PR、日志