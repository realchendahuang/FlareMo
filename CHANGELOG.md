# Changelog

FlareMo 使用 SemVer。每个 release 都要写清楚升级影响、Cloudflare 资源变化和 Memos 兼容面变化。

## v0.18.0

交互升级版本：设置类页面的操作表单全面弹窗化——添加成员、品牌外观编辑、修改密码、修改邮箱、删除账户、创建访问令牌、编辑用户名现在都以弹窗（Dialog/AlertDialog）打开；令牌吊销新增确认弹窗。状态展示类面板（传输、用量、令牌列表、品牌当前值）保持平铺。无 API 变化、无数据变化。

### 升级影响

- 无 migration、无资源变化、无 API 变化，直接部署即可。
- 纯前端交互调整；e2e 覆盖更新并新增成员弹窗用例（29 用例）。

## v0.17.1

文案清理版本：删除界面中的装饰性小字——登录页侧栏的 eyebrow、描述段落与特性胶囊，Transfer 面板与品牌外观卡的说明性副标题。功能性文案（确认提示、警告、筛选帮助、空态引导）全部保留。无功能变化。

### 升级影响

- 无 migration、无资源变化、无 API 变化，直接部署即可。

## v0.17.0

设计系统版本：与 KOSX（impact.kosx.ai）设计语言完全对齐——纯 token 级变更，无功能变化。flame 主色相旋转至 KOSX signal 橙（#ff6a00）色系、中性色降饱和至纸墨色系（dark 主题锚定 KOSX paper #0a0a0a / surface #1c1c1e）、全局圆角 0.75rem→0.875rem、字体栈对齐 KOSX（Helvetica Neue / PingFang SC）、动效采用 KOSX 标志性缓动 cubic-bezier(0.22, 1, 0.36, 1)。

### 升级影响

- 无数据库 migration、无 Cloudflare 资源变化、无 API 兼容面变化，直接部署即可。
- 自部署用户升级后界面颜色/圆角/字体会有轻微视觉变化（同一设计语言内的调优），功能与布局零变化。若你在本地覆写过 `index.css` token，需要手动合并。

## v0.16.0

新功能版本：管理员现在可以在后台「团队管理 → 品牌外观」配置实例的产品名称与 Logo（白标能力，面向企业定制与自部署品牌化）。配置存 D1，Logo 图片存 R2（`branding/` 前缀）；未配置时完全保持 FlareMo 默认外观。

### 升级影响

- 无数据库 migration（复用现有 `settings` 表）、无新 Cloudflare 资源（复用 `ATTACHMENTS` R2 bucket），直接部署即可。
- 新增公开只读端点 `GET /api/app/branding`（匿名可访问，返回产品名与 Logo URL）与 `GET /api/app/branding/marks/:variant`（Logo 流式输出，带 ETag 与 300s 缓存）。
- `GET /api/app/health` 的 `product` 字段现在返回配置后的产品名（未配置仍为 `FlareMo`）。
- 管理员专用端点：`GET/PUT /api/app/admin/branding`、`PUT/DELETE /api/app/admin/branding/marks/:variant`（仅 owner；Logo 限 PNG/WebP/SVG，≤512KB）。

## v0.15.4

紧急修复版本：修复 v0.15.3 登录守卫回归——匿名或会话过期的访客在首页永远停留在「加载中…」，无法到达登录页（线上 KosX 实例因此自 0.15.3 部署起不可用）。**v0.15.3 自建用户请立即升级。**

### 升级影响

- 无数据库 migration、无 Cloudflare 资源变化、无 API 兼容面变化，直接部署即可；升级后用原有账号重新登录。

### 修复

- **登录守卫回归**：`AuthenticatedRoute` 此前把 `/` 排除在匿名跳转 `/login` 之外（0.15.3 修路由循环时引入），会话失效的访客在首页无限停留在加载屏。现在任何未登录访问（含首页）都会跳转登录页并保留 `redirect` 回跳；到达 `/login` 后重置一次性标记，登出后回到 `/` 也能再次正确弹跳。
- 新增 e2e 用例覆盖「匿名访问 `/` 必须跳转登录」，防止回归。

## v0.15.3

安全与正确性修复版本：修复语义搜索/记忆召回的 namespace 透传（此前带 namespace 的向量查询必然 0 命中）、封堵管理员经密码重置接管 owner 的路径、修复 Memos 兼容 force 删除的 R2 对象泄漏，并补齐部署护栏、限流默认值与一批文档/站点修正。含一处数据库 migration（附件清理部分索引，向前兼容）。

### 升级影响

- **语义搜索索引布局变更**：memo 向量从「按作者 namespace」迁到单一共享 namespace（metadata 仍携带 `user_id`；查询侧由 N 次 Vectorize 查询变为 1 次，成本不随成员数增长；授权边界不变，仍然回 D1 按 `memoReadScope` 过滤）。**升级后存量向量位于旧 namespace，对新查询不可见**：等已有笔记被再次编辑时自动重建，或用重建工具（`rebuildEmbeddingIndexes`，现亦可经 owner 专用 `POST /api/app/admin/embeddings/rebuild` 触发；恢复演练同一路径）全量重排。Agent Memory 向量不受影响（保持按用户 namespace，recall 本就限定本人）。
- 开源默认 `wrangler.jsonc` 现在绑定 `RATE_LIMITER`（登录等凭证端点的每 IP 限流默认生效）；未部署该绑定的自建配置实例不受影响（限流自动降级为不启用）。`wrangler.jsonc` 不再随仓分发，改由 `wrangler.jsonc.example` 起步。
- 新增数据库 migration `0017_attachments_cleanup_index`，`wrangler d1 migrations apply` 即可，向前兼容。

### 修复

- **记忆语义召回修复（重要）**：`CloudflareVectorIndex.query` 此前把 namespace 误写成 metadata filter——Vectorize 的 `namespace` 是查询顶层选项，`filter` 匹配的是向量 metadata 字段，而没有任何向量存过名为 namespace 的字段，因此凡带 namespace 的查询必然 0 命中；同时恢复 MCP `memory_recall` 召回依赖里丢失的按用户 namespace 传参。两者叠加曾导致配置了向量索引的部署上 `memory_recall` 恒返回空列表且不回退 FTS。domain 层新增按 namespace 分区的 fake index 回归测试。
- 记忆语义召回的降级路径现在记录服务端错误日志（原先静默吞掉一切 provider/index 失败）。
- 团队管理员无法再通过密码重置接口触碰 owner，且非 owner 会话不能重置其他管理员的密码（与角色变更/成员移除一致的接管防护）。
- Memos 兼容 API 的 force 删除改走统一的硬删除助手：先处理附件再删行，R2 对象不再永久泄漏（Web/Memos/MCP 三条硬删除路径收敛为同一实现）。
- 语义搜索结果携带服务端计算的 `can_manage`，前端语义结果恢复编辑/删除操作。
- 成员移除与自助注销的产物清理改走队列执行器（大成员体量可达百万级 vector id，不再占用请求子请求预算；未绑定队列的极简部署保持内联执行）。
- outbox 维护巡检只在变更类请求上触发，读请求不再支付每请求 6-10 条查询的固定税；后台任务失败改为记录服务端日志（原先静默 `.catch(() => undefined)`）。
- 新增 owner 专用 `POST /api/app/admin/embeddings/rebuild`：从 D1 全量重建 memo/memory 向量索引（运维恢复入口）。
- 附件清理 cron 的候选查询补部分索引（原为全表扫描）。
- domain 层 `sql IN ${array}` 写法统一改为 `inArray`。

### 前端

- App.tsx 进一步拆分（983 → 709 行）：memo mutations 与乐观更新收敛为 `use-memo-mutations`，导出/导入流程收敛为 `use-data-transfer`（纯搬移，行为不变）。
- 打破 App.tsx ↔ router-tree.tsx 的循环 import：路由定义移入叶子模块，App 经 lazy 引用，消除潜在 TDZ 崩溃面。
- 登录后回跳登录前目标页（`redirect` search 参数；仅接受同源相对路径，防开放重定向）。
- 死代码清理（未使用的 getMemory/listMemoryRelations）与休眠的 eslint/prettier 第二套 lint 栈移除（web 工作区统一 biome）。
- 测试基建：28 份测试文件各自手写的迁移清单统一为共享 `applyFlaremoMigrations`（按 drizzle journal 顺序应用全部 migration），消除清单漂移。

### 站点与配置

- 公开仓去除作者生产环境标识：`wrangler.jsonc` 不再入库（`.gitignore`），新增 `wrangler.jsonc.example`（占位 `database_id` 与公网 URL），README/部署文档改为 `cp` 示例起步；Deploy Button 一键流程随之移除（配置不再随仓 provision），官网 hero CTA 改指部署指南。
- 默认 `wrangler.jsonc` 补绑 `RATE_LIMITER`：开源部署的登录限流默认生效（此前未绑该限流器的部署登录不限流）。
- 移除官网 Pricing 页（$0 档营销页）及全部定价/层级入口——公开仓零商业痕迹。
- README/ROADMAP/docs 过时的「未实现」声明修正（语义搜索、每日回顾、随机漫步、相关笔记均已上线）；agent-memory 文档的向量索引描述与实现对齐；maintenance.md 移除已拆除的 Workers Builds 自动部署声明。

## v0.15.2

稳定性与安全加固版本。全库系统性审计后的集中清偿：Memos 兼容面的错误信息收敛与隐私收紧、登录限流补齐、列表查询批量化、请求级实例复用、团队模式验收测试补齐，以及前端大文件的结构拆分。无数据库 migration、无 Cloudflare 资源变化。

### 安全与隐私

- 错误信息不再泄露内部细节：Memos 兼容层（current/social/Connect）与 MCP 工具错误只透出领域级错误文案；D1 报错、TypeError 等未预期错误一律返回固定的 "Internal server error" / "Tool call failed."（服务端日志保留完整信息）。
- 用户列表不再泄露成员邮箱：Memos 兼容面 `ListUsers`/`BatchGetUsers`/`GetUser` 与 REST `/api/v1/users(:user)` 对非本人请求改用不含 email 的公开 DTO（用户名与展示字段保留）；本人请求与管理面不受影响。
- 匿名网络探测封堵：`GetLinkMetadata`/`BatchGetLinkMetadata`（服务端代抓任意 URL）从匿名可达改为要求登录，未认证请求返回 401。
- 登录爆破面补齐限流：Connect `AuthService/SignIn` 与 REST `/api/v1/auth/signin` 纳入与 `/api/auth/*` 相同的每 IP 边缘限流桶（`RATE_LIMITER`）。
- 全站统计收敛为管理能力：Memos `UserService/ListAllUserStats` 原先任何成员可触发全站逐用户统计，现要求团队管理员，且由逐用户多次查询的扇出改为两条 GROUP BY 聚合查询。

### 性能与稳健性

- 请求路径实例复用：Hono 应用（全部中间件与路由表）按 Worker 生命周期构建一次；Better Auth 实例与 D1 wrapper 按 isolate 缓存（`getFlareMoRuntime`），不再每请求重建；需要非默认选项的路径（bootstrap 注册等）仍按需构建。
- Memos 原生 access token 的 subject 解析不再每请求全表扫描 `auth_user_links`（按 D1 实例短 TTL 缓存；成员移出仍然立即失效）。
- 列表页水合批量化：兼容面 memo 列表、评论列表与公开列表的附件、表情回应改为每页两条批量查询（原先每条 memo 至少 2 次往返，pageSize 上限 1000 时单请求可达数千条 D1 查询）。
- 语义搜索：作者 namespace 清单按实例缓存；向量候选回读下沉为 domain 函数（`getSemanticSearchMemos`），路由层不再直查 memos 表。
- 数据导出的 base64 转换分块处理（原先逐字节字符串拼接，32MiB 级附件内存放大明显），并复用 bundle 已有附件信息去掉逐附件重复查询。
- Cron 附件清理改单条 IN 批量更新；成员移除队列的畸形消息直接丢弃，不再毒化整批重试。
- 内容尺寸上限下沉 domain：`createMemo`/`updateMemo` 统一强制 content ≤ 100,000 字符、payload 序列化 ≤ 100,000 字符（与 Web/MCP 路径既有 contracts 上限对齐），Memos 兼容写路径不再无上限。
- 内联 owner 判断收敛为 domain `isOwner`。

### 前端

- 列表 DTO 下发服务端计算的 `can_manage`（`canEditMemo` 为唯一规则来源），前端删除手写的角色×可见性规则副本。
- Agent Memory、通知、导出重试等 mutation 补齐失败 toast；导出重试按钮不再产生 unhandled rejection。
- 时间线编辑与可见性切换同步失效 memo-context、memo-related 查询，详情页不再闪旧数据。
- 修订历史与回顾 tab 补错误分支（失败不再被当成空态）。
- 结构拆分（纯搬移、行为不变）：App.tsx 1519 → 983 行（路由树移至 `router-tree.tsx`，纯工具函数移入 lib），账户页 1107 → 397 行（五个面板组件拆至 `pages/account/`）。
- 更新检查优先使用 `/api/app/health` 返回的 `update_repository`，fork/自部署不再指向写死的上游仓库。
- 死代码与重复工具函数清理（formatBytes、资源名剥离、错误文案助手收敛进 lib）。

### 团队模式测试

- 补齐 docs/team-mode.md 验收矩阵中此前无覆盖的断言：最后一位有效管理员守卫（domain + admin API 双层）、成员移出后 PAT 失效、移除操作重放幂等且不误删团队/公开内容、旧 `protected` 数据升级转 `private`、默认关闭注册被拒、跨成员全文搜索隔离。

### Memos 兼容面变化

- 未认证的 `GetLinkMetadata`/`BatchGetLinkMetadata` 由 400（参数校验）变为 401（要求认证）。
- 非本人的用户 DTO 不再包含 `email` 字段。
- `ListAllUserStats` 需要团队管理员，成员调用返回 403。
- 写路径新增内容尺寸上限，超限返回 400。
- memo 列表 DTO 新增可选 `can_manage` 布尔字段，存量客户端可忽略。

### 升级影响

- 无数据库 migration、无 Cloudflare 资源变化；自托管直接 `pnpm deploy` 即可。
- 若依赖未认证链接预览或成员可见全站统计的第三方 Memos 客户端，需要改为登录会话 / 管理员凭据。
- 错误响应文案有变化但协议结构不变；依赖具体报错字符串的自动化请改按状态码判断。
- update 检查：配置了 `FLAREMO_DEPLOY_REPOSITORY` 的部署会在健康检查返回后查询自己的仓库 release。

## v0.15.1

CI 部署回归修复版本。让 `pnpm deploy:preflight` 不再阻断 CI 构建环境的自动化首次部署，并合入两个依赖更新。

### 修复

- 自动部署环境回归修复：`pnpm deploy:preflight` 在 CI 构建环境（`CI=true`，Workers Builds / Deploy to Cloudflare）中降级为警告不阻断。自动部署环境不携带操作者 secrets，正式 secret 由部署者通过 `wrangler secret put` 配置；本地手动发布仍强制校验 `BETTER_AUTH_SECRET`。v0.15.0 中该门禁曾让一键部署新用户的首次部署必失败。

### 升级影响

- 自托管行为不变：本地手动 `pnpm deploy` 仍强制校验 `BETTER_AUTH_SECRET`（≥32 字符）。
- 依赖更新：hono 4.13.5、vitest 4.1.11；`pnpm-lock.yaml` 经 `minimumReleaseAge` 供应链策略重新解析（electron-to-chromium、node-releases、obug、seroval 回落到合规版本；dev 依赖 wrangler 等随 SemVer 范围小幅前移）。
- 无数据库 migration、无 Cloudflare 资源变化、Memos 兼容面不变。

## v0.15.0

团队模式版本。为多用户部署补齐团队协作闭环：owner/admin/member 角色、管理员成员管理、三档可见性权限矩阵、可重试的成员移除清理；同时发布 Worker 生命周期工厂 `createFlareMoWorker`（HTTP routes、请求后 outbox、Queue 消费与 Cron maintenance 同一入口）和灾备持久化清单，自托管配置新增两个 Queue。

### 新增能力

- 完整 Worker 生命周期工厂：公开导出 `createFlareMoWorker(options)`。它将同一份 `FlareMoAppOptions` 同时用于 HTTP routes、请求后的 webhook/embedding outbox、Queue 消费和 Cron maintenance；外部组合壳不再需要复制 default handler 的内部实现，也不会因只导出 `fetch` 而漏跑 durable work。
- 团队角色与成员管理：`owner`（初始化账号，不可删除或降级）/ `admin`（团队管理员）/ `member` 三角色，成员状态 `active`/`removed`。「团队管理」界面支持查看有效成员、添加成员、设置/取消管理员、移出成员、为成员生成一次性密码重置链接。添加成员只需姓名 + 邮箱：服务端创建账号并签发 1 小时一次性激活链接（`/reset?token=…`），成员自设密码，管理员不经手也不可知晓密码；邮箱仅作唯一登录标识（不发邮件、不做邮箱验证，`FLAREMO_EMAIL_PROVIDER=none` 语义）。
- 可见性权限矩阵：`private` 仅作者、`protected` 团队可见（有效成员只读）、`public` 全网公开（匿名只读）；管理员可管理团队与公开内容，但不能读取成员私密内容。权限判断统一收敛在 domain 层，Web、Memos-compatible API、MCP、附件、全文/语义搜索与 SSE 共用同一矩阵；语义搜索 Vectorize 只出候选，最终结果回 D1 按当前成员过滤。
- 成员移除闭环：移出立即禁止访问并撤销全部 session、PAT 与随机分享链接；其私密笔记与附件、个人项目/任务/Agent Memory、R2 对象与 Vectorize 派生向量被删除；团队与公开内容及历史作者名保留。操作落 `member_removal_jobs`（记录操作人/阶段/尝试次数/错误，可安全重试），经 `flaremo-member-removal` Queue 异步执行，未绑定 Queue 的部署回落 scheduled maintenance 兜底，且两条路径共用同一幂等执行器。
- 灾备持久化清单：`scripts/persistence-manifest.mjs` 是所有 D1 `sqliteTable` 的唯一分类来源。恢复演练覆盖 memo/SSE/webhook/通知、数据任务、成员移除任务、Agent Memory、用量、项目/任务等事实源表，逐表比较恢复计数，并在恢复后把 Vectorize 的 `embedding_tasks` 重建为待处理 reindex 工作。
- 前端 hashed 静态资源（`/assets/*-hash.*`）响应加 `cache-control: public, max-age=31536000, immutable`；HTML 与应用路由维持正常 revalidation。
- `pnpm deploy:preflight`：发布前校验 `BETTER_AUTH_SECRET` 已配置、非占位值且字符多样性足够。

### Memos 兼容面变化

- 多用户部署的 `protected` 语义收紧：由「任何登录用户可见」改为「同实例有效成员可见」；`private`（仅作者）与 `public`（匿名只读）语义不变，单用户部署无感知。
- 未由兼容接口显式开启注册时，公开注册继续拒绝（默认关闭不变）。注册开关（`GET/PATCH /api/app/admin/settings`）保留为兼容端点且仅 owner 可用；团队模式下加成员走管理员接口。

### Cloudflare、数据库与认证影响

- D1 migration 0014–0016：`users.status` 列 + role/status 复合索引；`memos` 查询索引；`member_removal_jobs` 表。0014 同时把存量 `protected` 笔记转为 `private`（见升级说明）。
- 自托管 wrangler 配置新增两个 Queue（producer + consumer）：`flaremo-member-removal`（max_batch_size 10 / max_retries 5）与 `flaremo-data-export`（5 / 5）。Queue 需要 Workers Paid 计划；不绑定时成员移除与数据导出仍可经 cron 兜底执行，但清理有延迟。
- 新增管理端点（团队管理员 cookie session，受 Origin allowlist 约束）：`POST /api/app/admin/users`、`PATCH /api/app/admin/users/:id/role`、`DELETE /api/app/admin/users/:id`、`POST /api/app/admin/users/:id/reset-password`、`GET /api/app/admin/member-removal-jobs(/:id)`、`POST /api/app/admin/member-removal-jobs/:id/retry`。

### 升级影响

- **升级会把存量 `protected` 笔记自动改为 `private`**（0014 迁移），避免升级后旧「登录可见」内容被新团队语义意外共享；升级完成后再按需改为团队可见。`public` 笔记保持公开。
- 自托管升级顺序：先在目标账户创建两个 Queue（`wrangler queues create flaremo-member-removal`、`wrangler queues create flaremo-data-export`）并在 wrangler.jsonc 增加 bindings，然后 `pnpm deploy`（自动应用 migration）。迁移完成后在管理员页确认成员移除任务可正常领取。
- 既有 `owner` 自动成为团队管理员，既有成员初始化为 `active`；不允许移出或降级最后一位有效管理员。
- 自托管 Worker 的 default export 行为不变。高级 host 若需要完整生产生命周期（含 Queue 消费），应从 `createFlareMoApp` 迁移到 `createFlareMoWorker`；前者仍保留给测试和只需路由装配的场景。
- 灾备流程在新 Vectorize index 上恢复时，必须使用新建或明确清空的 index，再让重建 outbox 执行；不能复用旧 D1 的 `indexed` 状态作为向量存在证明。Queue 消息是可重放的 job ID，恢复 D1 后先确认 Queue 资源与 migration 状态，再放行后台清理。

## v0.14.0

邮件生命周期闭环 + 账号自助注销 + 可选限频版本。把 v0.13.0 引入的注册邮件验证补成完整闭环（重发、找回密码、换邮箱验证新地址），补上多用户部署的合规底线（自助注销），并为凭据端点提供厂商中立的 per-IP 限频（呼应「不要验证码」的决策：不接验证码平台，用 Cloudflare 原生 rate limiting binding 防刷）。

### 新增能力

- 重发验证邮件（#118）：`POST /api/auth/flaremo/resend-verification`。未知地址与已验证身份返回同一成功形态（防账号枚举）；注册完成页新增「重新发送验证邮件」。
- 自助找回密码（#118）：`POST /api/auth/flaremo/forgot-password` 发送 1 小时有效的重置邮件，链接走既有 `/reset` 页面 + Better Auth 原生 `/api/auth/reset-password`（重置成功自动撤销全部 session）。响应不区分地址是否注册。登录页「忘记密码」入口改指新 `/forgot-password` 页；自托管（无邮件 provider）在该页引导使用恢复密钥（`/recover`），原路径不变。
- 换邮箱验证新地址（#118）：配置邮件 provider 后，改邮箱先验证当前密码 + 新地址占用（auth 与 domain 两处），向新地址发送 24h 确认邮件，点击 `/verify-email-change` 后才切换登录邮箱（auth + domain 同步）。确认前旧邮箱继续有效，打错地址不再锁死后续邮件流。provider 为 `none` 的自托管保持立即生效。
- 账号自助注销（#124）：`DELETE /api/app/account`（当前密码确认）。domain 新增 `deleteFlaremoAccount`：逐表显式删除该用户全部 D1 数据（memos/attachments/revisions/tags/relations/reactions/shares/webhooks/notifications/shortcuts/usage counters/embedding outbox/projects/tasks/task activity/settings + Better Auth 身份/session/PAT），children-first、不依赖运行时外键级联；R2 附件对象与 Vectorize 向量（确定性 ID 枚举，幂等）同步清除，未绑定 R2/Vectorize 的部署自动跳过。owner 账号不可通过此入口注销（403）。账户页新增危险区（仅成员可见）。
- 凭据端点可选限频（#122）：部署绑定 Cloudflare rate-limiting binding `RATE_LIMITER` 后，`/register`、`/resend-verification`、`/forgot-password` 与 Better Auth 的 sign-in/sign-up/forget-password/reset-password 路径按客户端 IP 分桶节流（超限 429）；session 读取不受影响。未绑定该 binding 的部署行为完全不变；binding 故障 fail-open（放行并记 error 日志）。

### Memos 兼容面变化

- 配置邮件 provider 的部署上，Memos 客户端注册路径（current `/api/v1/auth/signup`、Connect `AuthService.SignUp`）返回 403（#120）：这些兼容面无法完成邮箱验证，为防绕过闸门不再创建未验证账号。未配置 provider 的自托管行为不变。
- 其余 `/api/v1/*` 兼容面不变。

### Cloudflare、数据库与认证影响

- 无数据库 migration、无新增必需资源。
- 新增可选 binding：`RATE_LIMITER`（rate-limiting binding，如 `namespace_id = "1001"`、`limit = 30`、`period = "60"`）。自托管默认不绑定，行为与 v0.13.0 一致。
- 新增端点：`POST /api/auth/flaremo/resend-verification`、`POST /api/auth/flaremo/forgot-password`、`GET /api/auth/flaremo/verify-email-change`、`DELETE /api/app/account`。全部受既有 Origin allowlist 契约约束（非安全方法必须携带精确 Origin）。
- 换邮箱语义变化（仅 provider 非 none 时）：`POST /api/app/account/email` 响应新增 `verification_sent: true`，邮箱在确认前不切换。

### 升级说明

- 自托管直接 `pnpm deploy`，零配置，行为不变（provider `none` 时所有新端点要么 400 要么维持原路径）。
- 多用户部署：建议绑定 `RATE_LIMITER`；`admin` 与 Memos current 的既有用户删除入口本次未改动（仍为 v0.13.0 语义），如需彻底删除请走新的自助注销。

## v0.13.0

注册邮件验证版本。公开注册的人机防线从验证码改为邮件验证（按 Kim 拍板：不要验证码，用 Cloudflare Workers Paid 计划的 Email Sending，不接第三方发信商）。

### 新增能力

- Email provider seam（#117）：\`FLAREMO_EMAIL_PROVIDER\` = \`none\`（默认，自托管注册行为不变）/ \`cloudflare\`（\`env.EMAIL.send()\`，Workers Paid 计划）。\`FLAREMO_EMAIL_FROM\` 指定已验证发件地址。
- 注册流程：配置 provider 后，注册成功即 mint 单次 24h 验证 token（\`auth_verifications\`，\`email-verify:\` 命名空间，与密码重置同一机制）并发送验证邮件；发送失败返回 502（fail-closed，不产生静默未验证账号）。
- \`GET /api/auth/flaremo/verify-email?token=\`：消费 token、置 \`auth_users.email_verified\`，单次使用（消费即删）。
- \`/register/status\` 暴露 \`email_verification_required\`；注册页成功后显示「查收邮件」状态；新增 \`/verify-email\` 页（成功/过期两态，zh/en）。

### Memos 兼容面变化

- \`/api/v1/*\` 兼容面不变。邮件验证仅影响浏览器注册流程；Memos 客户端注册路径（current/Connect）暂不强制验证（后续迭代）。

### Cloudflare、数据库与认证影响

- 无数据库 migration。新增可选变量：\`FLAREMO_EMAIL_PROVIDER\` / \`FLAREMO_EMAIL_FROM\`；启用 \`cloudflare\` 需在 wrangler 配置 \`send_email\` binding（EMAIL）并在 Cloudflare 控制台开通 Email Sending、验证发件域名（SPF/DKIM）。
- 未配置 provider 时行为与 v0.12.0 完全一致。

### 升级说明

- 自托管直接 \`pnpm deploy\`，零配置，行为不变。
- 多用户部署（app.flaremo.app）：开通 Email Sending + 验证域名后配置 provider 即可启用注册邮件验证。

## v0.12.0

按条计费与注册防护版本。共享多用户实例的免费档主货币从字节换成条数（`maxMemosPerUser` / `maxMemoryItemsPerUser`），并新增厂商中立的注册验证码 seam（`none` / `http` / `tencent`），为公开注册铺路。

### 新增能力

- Per-user 存量条数限额（#115）：`UserPlanLimits` 新增 `maxMemosPerUser`（memo 按 normal+archived 计，回收站不算）与 `maxMemoryItemsPerUser`（memory 按 active+archived 计）。检查在 domain `createMemo` / `createMemory` 内部（`QuotaScope` 沿 checkpoint / createMemoryFromMemo / promoteMemoryToMemo 透传），全部 9 条创建路由 + 两条导入路径（按 bundle 条数预检）已接线。恰好满额允许、超出 429；`plan.user` 段与账户面板新增「笔记条数 / Agent 记忆条数」两行。
- `parseUserPlanLimits` 放宽：缺键解析为 null（回落到部署级限额），仅当载荷无任何有效键才视为未配置——null 从不等于 unlimited。
- 注册验证码 seam（#116）：`FLAREMO_CAPTCHA_PROVIDER` = `none`（默认）/ `http`（POST {ticket,randstr,ip} 到 `FLAREMO_CAPTCHA_VERIFY_URL`，任意平台可经此接入）/ `tencent`（腾讯云验证码 2.0，TC3-HMAC-SHA256 签名调 DescribeCaptchaResult，国内可达）。site key 走变量、secret 走 Wrangler secret；配置缺失 fail-closed。覆盖 Web / Memos current signup / Connect SignUp 三条注册路径；bootstrap 与管理端建号豁免。注册页按 `/register/status` 返回的 provider 动态加载腾讯控件（懒加载）或阻塞提交直至 ticket 头存在。
- Projects/Tasks/引用关系/回顾/导入导出/MCP 接入**不设限**（零边际成本，设限只添摩擦）。

### Memos 兼容面变化

- `/api/v1/*` 兼容面不变。429/403 仅在部署显式配置 per-user 条数限额或验证码时出现。

### Cloudflare、数据库与认证影响

- 无数据库 migration、无新增必需资源。新增可选变量：`FLAREMO_CAPTCHA_PROVIDER` / `FLAREMO_CAPTCHA_SITE_KEY` / `FLAREMO_CAPTCHA_VERIFY_URL`；新增可选 secrets：`FLAREMO_CAPTCHA_SECRET_ID` / `FLAREMO_CAPTCHA_SECRET`（tencent 用）。
- 启用验证码后，浏览器注册必须携带 ticket（Web 页自动处理）；无验证码配置时行为与 v0.11.0 完全一致。

### 升级说明

- 自托管直接 `pnpm deploy`，零配置，行为不变。
- 多用户部署（app.flaremo.app）建议配置 per-user 限额与验证码后再开放注册。

## v0.11.0

Per-user 限额版本。为「公开注册、多用户共享一个部署」的形态补上按用户计量的限额层：在部署级 PlanLimits 之上新增 `UserPlanLimits`（存储 / embedding tokens / 语义搜索三个维度），生效优先级 per-user → 部署级 → 不限量。自托管不配置 per-user 载荷时行为与 v0.10.0 完全一致。

### 新增能力

- `UserPlanLimits` 注入层（#114）：`createFlareMoApp` 新增 `resolveUserPlanLimits(env, userId)` 选项，或直接用 `FLAREMO_USER_LIMITS_JSON` 环境变量（严格解析：畸形/缺键载荷视为「未配置」，绝不部分生效成不限量）。成员数上限保持部署级，不做 per-user 形态。
- #109 的全部执行点（上传、导入、语义搜索、memory_recall、embedding outbox）按 scope 生效：per-user 限额生效时按该用户的用量判断（`usage_counters` 本就按 user 分桶，附件存储按 userId 求和）；outbox 按任务归属用户逐任务判断，一个用户预算耗尽不影响其他用户。
- `/api/app/usage/vector` 的 `plan` 段在配置 per-user 限额时附带 `user` 子段；账户用量面板新增「个人限额」分组（部署限额分组改名「部署限额」）。

### Memos 兼容面变化

- `/api/v1/*` 兼容面不变。新增的 429 仅在部署显式配置 per-user 限额且该用户超限时出现。

### Cloudflare、数据库与认证影响

- 无数据库 migration、无新增 Cloudflare 资源、无必需的 secret 变化。
- 需要按用户限额的部署：给 Worker 增加 `FLAREMO_USER_LIMITS_JSON` 变量（非 secret）；不需要则什么都不用做。

### 升级说明

- 自托管直接 `pnpm deploy`，无需任何步骤，行为不变。
- 多用户部署（app.flaremo.app）升级后建议配置 per-user 限额再继续开放注册。

## v0.10.0

开放内核与计划限额版本。这个版本为可组合内核打下地基：AGPL-3.0-only 许可证、`createFlareMoApp` 组装工厂、可注入的 `PlanLimits` 在内核四个执行点被真正执行（附件存储 / 月度 embedding tokens / 月度语义搜索 / 成员数），并新增内核导入边界架构测试。自托管部署行为完全不变（限额全 null = 不限量）；多用户部署的差异化从这一版起纯粹是注入限额的数字差异。

### 新增能力

- 许可证从 MIT 切换为 **AGPL-3.0-only**（#103）：全部 9 个包 SPDX 更新，README/CONTRIBUTING 写明版权人双许可权利与商标条款。
- `createFlareMoApp(options)` 工厂（#105）：worker 路由表不再挂模块级常量，每次调用返回全新 Hono 实例；接受可选 `resolvePlanLimits(env)`，默认恒返回 `SELF_HOST_UNLIMITED`，解析结果经中间件写入 Hono Variables 并随请求上下文 `limits` 字段可用。
- 计划限额真实执行（#109，`packages/domain/src/quotas.ts`）：
  - 附件存储总量：三条上传路径 + 两条导入路径在写入 R2 前预检，超限返回 429；
  - 月度 embedding tokens：outbox 每次 embed 成功后按估算 token（`ceil(chars/4)`）写入 `usage_counters`；预算耗尽时 sweep 暂停认领（任务保持 pending、不消耗重试次数，次月自动恢复）；全量重建只计量不阻断；
  - 月度语义搜索：新增 `search_queries` 指标，`/api/app/search/semantic` 与 `memory_recall` 语义路径在 embed 前检查，超限 429；
  - 成员数上限：Web 注册 / 管理员建号 / Memos 注册路径统一预检，注册在 Better Auth 身份创建之前预检以避免孤儿身份；429 在四套错误映射中透传。
- `/api/app/usage/vector` 响应新增 `plan` 段（四维度 used/limit），账户用量面板渲染限额进度条（limit 为 null 不渲染）。
- 内核导入边界架构测试（#107）：机械约束支付依赖不得进入内核、第三方导入必须注册在 workspace package、禁止非 registry 依赖声明。

### 营销站与文档镜像（apps/site）

- 新增 `apps/site` 包：FlareMo 官方营销站与文档镜像，部署到 `flaremo.app`，与主 Worker `flaremo` 完全解耦。
- 技术栈与 `apps/web` 完全同构：React 19 + Vite + TanStack Router（code-based）+ Tailwind CSS 4；构建期 SSG，每个路由产出完整静态 HTML，客户端 hydrate。
- 首页 / 定价页 / 文档镜像 / 完整 SEO（sitemap、JSON-LD、hreflang、OG image）。

### Memos 兼容面变化

- `/api/v1/*` 兼容面不变；新增的 429 仅在部署显式注入限额时出现，自托管（不注入）永远不会触发。
- 认证与 Origin 校验语义不变：cookie session 状态变更仍要求精确 Origin 匹配，PAT 请求语义不变。

### Cloudflare、数据库与认证影响

- 无数据库 migration、无新增 Cloudflare 资源、无新增 env var 或 secret 要求。
- `apps/site` 为独立 Worker `flaremo-site`，用 `pnpm deploy:site` 单独部署，不触发主 Worker。
- Better Auth 配置不动；`FLAREMO_PUBLIC_URL` / `FLAREMO_TRUSTED_ORIGINS` 语义不变。

### 升级说明

- 自托管用户直接 `pnpm deploy` 即可；无需任何迁移步骤，行为与 v0.9.0 一致。
- `pnpm release v0.10.0` 与 Deploy Button 用户仓库的升级 PR 自动消费本 Release。

## v0.9.0

账户邮箱自助修改版本。这个版本在无邮件基础设施的前提下，为账户设置页新增"修改邮箱"能力：修改登录邮箱前必须验证当前密码（避免裸改登录标识），改邮箱不引入邮件服务，验证步骤集中在 route 层，未来接入邮件 OTP 时可替换而不改路由契约。

### 新增能力

- 修改邮箱：账户设置页 security tab 新增"修改邮箱"卡片，输入新邮箱 + 当前密码提交。
- 后端 `POST /api/app/account/email`：经 `getBrowserRequestContext` 校验 cookie session 与 Origin allowlist；用 `auth.api.verifyPassword` 校验当前密码（错误返回 400）；随后更新 Better Auth `auth_users` 登录凭据（标记 `email_verified=true`、刷新当前会话），再同步 FlareMo 业务 `users` 表的 email。
- 邮箱唯一性保护：两张 unique email 表都做查重，冲突返回 409；domain `updateFlaremoUserEmail` 负责业务表同步、大小写归一与冲突检查。

### Cloudflare、数据库与兼容影响

- 无数据库 migration、无 Cloudflare 资源变化、无新增 env var。
- `/api/v1/*` Memos 兼容面不变；`/mcp` 语义不变。
- 认证与 Origin 校验语义不变：cookie session 状态变更仍要求精确 Origin 匹配，PAT 请求语义不变。

### 升级说明

- 执行标准的 `pnpm verify`、`pnpm deploy:dry-run` 和 `pnpm deploy`。
- 保持现有 `FLAREMO_PUBLIC_URL`、`FLAREMO_TRUSTED_ORIGINS`、`BETTER_AUTH_SECRET`、`FLAREMO_BOOTSTRAP_SECRET` 和已创建 PAT 配置；不要把任何 secret、cookie 或 PAT 写入 Git、release notes、日志或聊天。
- 改邮箱会同时更新 Better Auth 登录凭据与 FlareMo 业务用户表；当前会话保持登录，其他已登录会话不受影响。

## v0.8.0

语义搜索与向量用量版本。这个版本给 memo 和 Agent Memory 接入语义检索（D1 仍是唯一事实源，Vectorize 只存可重建的派生索引），默认使用 Cloudflare 内置 embedding 模型 `@cf/qwen/qwen3-embedding-0.6b`（1024 维），做成可插拔 provider（`workers-ai` / `http` / `none` 三档），并在账户页新增向量用量面板。数据库新增 `embedding_tasks` 与 `usage_counters` 两张表、`memos` 表补 embedding 状态列，全部是新增/加列，向后兼容。

### 新增能力

- 可插拔 embedding provider：`workers-ai`（默认，零外部 key）、`http`（外部 REST，API key 走 Wrangler secret）、`none`（关闭语义搜索，退回 FTS5 关键词）。由 `FLAREMO_EMBEDDING_PROVIDER` 选择，模型与维度可配置。
- memo 语义搜索（"找一找"）：时间线搜索框新增语义切换，`GET /api/app/search/semantic` 用自然语言召回相关 memo；Vectorize 只返回候选 id，命中后回 D1 校验 owner/status，未索引或 provider 不可用时返回 `degraded=true` 并退回关键词搜索。
- Agent Memory 语义召回：`recallMemories` 优先走 Vectorize 相似度（`matched_by=semantic`），失败或未提供 provider 时退回 FTS5（`matched_by=fts`）；`/memory/mcp` 的 `memory_recall` 工具 schema 不变。
- 增量索引 outbox：memo/memory 写路径在 D1 batch 内原子入队 `embedding_tasks`，`dispatchEmbeddingOutbox` 异步 embed + Vectorize upsert/delete，`ctx.waitUntil` 与 cron 双驱动，带 lease/claim/backoff/prune 崩溃恢复。
- 全量重建：`rebuildEmbeddingIndexes` 从 D1 幂等重建两个 Vectorize index（首次回填、换模型/改维度、索引损坏恢复）。
- 向量用量面板：`GET /api/app/usage/vector` 聚合 `Vectorize describe()` 的存储维度 + D1 `usage_counters` 的查询维度，账户页展示自测消耗 vs 配置的免费额度，附 Cloudflare Dashboard 兜底说明。

### Cloudflare、数据库与兼容影响

- 新增 D1 migration `0012_slow_nick_fury.sql`：`memos` 加 `embedding_status/embedding_version/embedded_at/embedding_error` 四列，新增 `embedding_tasks`、`usage_counters` 两张表；纯新增，向后兼容。
- 新增 Vectorize binding（`flaremo-memos`、`flaremo-memories`，1024 维 cosine）与 Workers AI binding（`AI`）。
- 新增 env var：`FLAREMO_EMBEDDING_PROVIDER/MODEL/DIMENSIONS`、`FLAREMO_EMBEDDING_API_URL/API_KEY`（http 档可选）、`FLAREMO_VECTORIZE_STORED_LIMIT/QUERIED_LIMIT`（默认 Workers Free 500 万存储 / 3000 万查询维度）。
- `/api/v1/*` Memos 兼容面不变；`/mcp`、`/api/v1/mcp`、`/memory/mcp` 语义不变（memory_recall 仅召回方式升级）。
- 认证与 Origin 校验语义不变；语义搜索与召回复用 cookie session 与 `memos_pat_` PAT。

### 升级说明

- 执行标准的 `pnpm verify`、`pnpm deploy:dry-run` 和 `pnpm deploy`；`pnpm deploy` 会在发布 Worker 前自动应用 0012 migration。
- 首次接入后存量 memo/memory 不会自动回填向量，需手动触发一次全量重建；此后增量自动同步。
- 保持现有 `FLAREMO_PUBLIC_URL`、`FLAREMO_TRUSTED_ORIGINS`、`BETTER_AUTH_SECRET`、`FLAREMO_BOOTSTRAP_SECRET` 和已创建 PAT 配置；不要把任何 secret、API key、cookie 或 PAT 写入 Git、release notes、日志或聊天。
- 语义搜索是可降级能力：任何 embedding/Vectorize 失败只影响召回，不影响写、导出、分享与 Memos 兼容；`FLAREMO_EMBEDDING_PROVIDER=none` 时行为与 v0.7.0 完全一致。

## v0.7.0

Agent Memory 中枢与回顾体系版本。这个版本补齐 flomo 回顾体系（R3 第一批），落地 Agent Memory（AI 长期记忆中枢，P0：四张 D1 表 + FTS5 + `/memory/mcp` 六工具 + `/memory` 管理 UI + Memo↔Memory 双向连接 + 导入导出纳入），并完成 lint 零告警与文档收口。数据库新增 memory 四张表，全部是新增表，不影响既有数据。

### 新增能力

- 每日回顾：新增 `/review/daily` 页面，按「N 年前的今天」分组展示往年今日创建的 memo；后端 `GET /api/app/review/daily?date=YYYY-MM-DD`（时区由前端传本地日期规避）。
- 随机漫步：新增 `/review/walk` 页面，从随机 memo 出发沿共享标签、引用关系游走（无关联时大跨越），支持漫步历史回看；「结束漫步」输出明信片式总结（经过条数、总字数、时间跨度）；后端 `GET /api/app/review/random`、`GET /api/app/review/walk`，返回 `via`（tag/relation/jump）标记路径来源。
- 侧边栏 explorer 新增「回顾」区，含每日回顾与随机漫步入口。
- Agent Memory（AI 长期记忆）：新增 `memory_items` / `memory_revisions` / `memory_relations` / `memory_resource_links` 四张 D1 表，配 `memory_fts` FTS5 虚表（trigram 分词）与增删改触发器。D1 仍是唯一事实源，FTS 只作检索索引，可随时重建。
- 记忆写入门禁：内容归一化、SHA-256 指纹精确去重、4000 字上限、凭据安全检测（命中 `Authorization`/`cookie`/`memos_pat_`/私钥/密码直接拒绝）。Agent 只能以 `observed`/`inferred` 写入，永远不能覆盖用户 `confirmed`/`locked` 的记忆，冲突进入 Review。
- 记忆召回：scope 隔离（global + 当前 workspace/project + 当前 agent，禁止跨 project）+ FTS5 + 权威/重要度/置信度/recency 排序；episodic 记忆随时间衰减，semantic/procedural/decision 不衰减。
- Agent Memory MCP：新增 `/memory/mcp` 无状态 Streamable HTTP 端点，暴露 `memory_bootstrap` / `memory_recall` / `memory_remember` / `memory_checkpoint` / `memory_link` / `memory_forget` 六个 tool，policy 内联进 tool description，复用 `memos_pat_` PAT 认证。
- Memory 管理 UI：新增 `/memory` 页面（Core / Projects / Recent / Review / Archive 分栏），支持查看、确认、锁定、归档、删除、历史版本与来源展示；memory 卡片新增「编辑」入口（内容 / type / kind / scope / importance，走 `PATCH /api/app/memory/:id`）。
- Memo ↔ Memory 双向连接：memo 详情可「记为 Memory」（`derived_from`），memory 可「转为记录」（`promoted_to`），memo 上下文与导出均返回相关 memory。
- 导出导入纳入：导入导出 bundle 升到 version 3，纳入 memory 四表；fingerprint、access counter 与 embedding 派生字段不导出，导入时重置为 `not_indexed`。
- 文档：新增 [docs/agent-memory.md](./docs/agent-memory.md) 接入 runbook；product-requirements、ROADMAP、README、llms.txt 同步 Agent Memory 定位与后续方向（语义召回、自动固化）。

### 修复与清理

- 删除 13 个未使用的 i18n 死文案 key（中英双语）与重复 key `update.open`（统一为 `update.title`）。
- 接上已定义但未使用的文案：删除标签现在弹确认对话框（`explorer.tagDeleteConfirm`）；导入任务创建后提示 `toast.importStarted`，导出轮询提示 `toast.taskPending`（按 toast id 去重）。
- 本地化硬编码字符串：标签树「展开/折叠」aria-label、Dialog/Sheet 的 sr-only Close、memo 详情页置顶徽章（新增 `memo.pinnedBadge`）。
- 删除死代码：`DialogFooter` 永不渲染的 Close 按钮、`apps/web/src/api.ts` 中 7 个无调用方的导出函数。
- 清理零信息增量的内部腔文案：登录/初始化页删除「登录状态仅保存在 HttpOnly Cookie…」安全说明和「原生访问」眉标（账户页同步移除）；简化初始化不可用、初始化密钥说明、改密影响说明和 PAT 描述的措辞。
- lint 零告警：删除未使用 import，导出任务收尾与 API 测试的 non-null assertion 改为显式守卫。

### Cloudflare、数据库与兼容影响

- 新增 D1 migration `0011_daffy_ultron.sql`：新增 `memory_items`、`memory_revisions`、`memory_relations`、`memory_resource_links` 四张表及 `memory_fts` FTS5 虚拟表与增删改触发器；全部是新增表，向后兼容上一正式版本，不需要回填。
- Worker 路由新增 `/memory/mcp`（Agent 无状态 MCP，PAT 认证）与 `/api/app/memory`（浏览器 cookie session 管理面）；`assets.run_worker_first` 增加 `/memory/*`。
- 无 R2 命名空间变化、无 cron 变化、无 Cloudflare 资源绑定变化。
- `/api/v1/*` Memos 兼容面不变：`/mcp`、`/api/v1/mcp` 行为与 v0.6.0 一致，memory 走独立的 `/memory/mcp` 前缀，不撞既有 MCP。
- 认证与 Origin 校验语义不变：memory 复用 Better Auth cookie session 与 `memos_pat_` PAT，不新增第二套令牌。

### 升级说明

- 执行标准的 `pnpm verify`、`pnpm deploy:dry-run` 和 `pnpm deploy`；`pnpm deploy` 会在发布 Worker 前自动应用 0011 migration（memory 四张表 + FTS5，纯新增）。
- 保持现有 `FLAREMO_PUBLIC_URL`、`FLAREMO_TRUSTED_ORIGINS`、`BETTER_AUTH_SECRET`、`FLAREMO_BOOTSTRAP_SECRET` 和已创建 PAT 配置；不要把任何 secret、密码、cookie 或 PAT 写入 Git、release notes、日志或聊天。
- 部署后重新验证登录页、bootstrap status、受保护 API 的 JSON `401`、可信/不可信 Origin、公开分享、`/mcp`、`/memory/mcp`（PAT 认证）、`/memory` 管理页（确认/锁定/编辑/归档/删除）、Memo↔Memory 双向连接和导入导出。若启用 Cloudflare Access，它只能作为额外 policy，客户端仍必须提供 FlareMo 应用层 session 或 PAT。

## v0.6.0

标签体系与大数据迁移版本。这个版本补齐了多级标签树和标签管理（R5），并落地大型导入导出任务管道（R6）：超过内联导出上限（32 MiB）的数据改走 R2 对象包 + 任务状态轮询，替代直接 413。数据库新增 `data_tasks` 一张表，全部是新增表，不影响既有数据。

### 新增能力

- 多级标签（R5）：内容提取支持 `#父/子` 层级路径和中文标点边界，`ListMemos` 的 `tag` 参数按前缀匹配（`工作` 命中 `工作/*`），统计返回去重层级树（同一 memo 不重复计数）。
- 标签管理（R5）：explorer 侧边栏渲染可折叠层级标签树，标签 hover 提供重命名/移动（含子树，`工作` → `知识/工作` 会连后代一起移动）和删除；新增「无标签」筛选。改动同步更新 `memo_tags`、memo 的 `payload.tags` 和 memo 正文中的 `#标签` 文本（大小写不敏感）。
- 大型导出任务（R6）：`POST /api/v1/export/tasks` 创建任务，分页读 D1（每 500 条）流式产出 NDJSON chunk 写入 R2 `exports/<task-id>/`，附件经认证端点逐个流式下载，`GET /api/v1/export/tasks/:id/manifest` 返回自包含校验清单（记录数、分块、附件清单）；前端导出改为任务流 + 轮询。
- 导入任务（R6）：`POST /api/v1/import/tasks` 接收 JSON bundle，复用 domain 导入逻辑，返回 `202 {task, result}`；小型 bundle 仍走同步 `GET /api/v1/export` / `POST /api/v1/import`。
- 32 MiB 判断修正（R6）：内联导出按完整序列化 JSON 大小（TextEncoder 估算，含 base64 膨胀）判断，不再只按附件原始字节。
- 任务生命周期（R6）：`data_tasks` 表记录 kind/status/phase/attempts/lease/expiry，每日 cron 兜底把 stale `queued/running` 任务标记 `failed`、回收超过 7 天的任务行并清理对应 R2 导出产物。

### Cloudflare、数据库与兼容影响

- 新增 D1 migration `0010_deep_gateway.sql`：新增 `data_tasks` 表及三个索引（user+created、status+lease、expires）；全部是新增表，向后兼容上一正式版本，不需要回填。
- R2 新增 `exports/<task-id>/` 和 `imports/` 命名空间：导出清单、NDJSON 分块和导入附件暂存对象使用独立前缀，与业务 `attachments/` 前缀隔离；`exports/` 前缀由每日 cron 清理。
- 无 Worker 路由破坏性变化；`/api/v1/*` 新增 `export/tasks`、`import/tasks` 端点，全部需要认证。
- Memos 兼容面不变：仍是已记录的 current camelCase REST、Better Auth-backed auth facade、PAT、legacy wire、Connect JSON/protobuf/gRPC-Web unary 子集、有限 SSE、无状态 `/mcp` 和 bounded webhook outbox。标签层级前缀筛选是对既有 `tag` 查询参数的语义增强。
- Better Auth 认证边界不变：cookie session、`memos_pat_` PAT、native access/refresh JWT facade 和 Origin 校验语义与 v0.5.0 一致。

### 升级说明

- 执行标准的 `pnpm verify`、`pnpm deploy:dry-run` 和 `pnpm deploy`；`pnpm deploy` 会在发布 Worker 前自动应用 0010 migration。
- 保持现有 `FLAREMO_PUBLIC_URL`、`FLAREMO_TRUSTED_ORIGINS`、`BETTER_AUTH_SECRET`、`FLAREMO_BOOTSTRAP_SECRET` 和已创建 PAT 配置；不要把任何 secret、密码、cookie 或 PAT 写入 Git、release notes、日志或聊天。
- 部署后重新验证登录页、bootstrap status、受保护 API 的 JSON `401`、可信/不可信 Origin、公开分享、`/mcp`、标签树与标签管理、小型内联导出、大型导出任务（`/api/v1/export/tasks`）和导入任务。若启用 Cloudflare Access，它只能作为额外 policy，客户端仍必须提供 FlareMo 应用层 session 或 PAT。

## v0.5.0

Memos 兼容扩展版本。这个版本把 Memos-compatible 面从 memo/auth/shortcut 基础子集扩展到单用户 UserService 的 webhook/notification 资源、Attachment 的 bounded CEL 过滤和分页元数据，并把附件文件 URL 正式接入 Worker 路由。数据库新增通知、webhook 和 webhook 投递三张表，全部是新增表，不影响既有数据。

### 新增能力

- UserService 接入 webhook 与 notification 资源：webhook CRUD、signing-secret reveal、notification list/update/delete，以及 comment/mention notification payload 生成。
- 四类 memo 事件（create/update/delete/comment）通过 D1 outbox 做有界异步 webhook 投递与重试；本版本仍是 FlareMo 的有界实现，不是完整上游 webhook 事件/egress 语义。
- AttachmentService 的 `ListAttachments` 从 ad-hoc 正则过滤升级为共享 bounded CEL 运行时：支持 `filename` / `mime_type` / `create_time` / `memo_id` / `memo` 谓词、`contains` / `startsWith` / `endsWith` / `matches`、`in` 列表和 `now` / `duration` 时间算术；AST 节点数与长度受限，Worker 侧内存过滤有 10,000 行扫描上限。
- comments、reactions、attachments 列表分页返回真实 `totalSize`，并同步到 REST、Connect、contracts schema、protobuf codec 和 OpenAPI。
- Shortcut List/Create 的 `parent` 改为必填，`UpdateShortcut` 的 `updateMask` 支持 FieldMask 对象，与上游资源语义一致。
- 附件文件 URL 桥接入 Worker 路由：`/file/attachments/{id}/{filename}` 支持 Better Auth/PAT/native access JWT 私有读取和 `share_token` 绑定的公开读取。
- Memos 兼容实现改用 pinned 上游 proto 生成的 `@bufbuild/protobuf` descriptor runtime，覆盖 Memo/Auth/Shortcut/Attachment/User/Instance/IdentityProvider/AI 的普通 unary 编解码；手写 codec 只保留给历史 alias 和错误/status framing。
- 认证 golden fixture 外置：native access/refresh JWT 增加段级 SHA-256 字节校验，refresh token 轮换字节确定性有独立 fixture。
- 评论列表可见性：认证用户可见 owner + public + protected 评论，匿名仍只读 `PUBLIC + NORMAL`。

### Cloudflare、数据库与兼容影响

- 新增 D1 migration `0008_legal_scarecrow.sql` 和 `0009_neat_iron_fist.sql`：新增 `memos_notifications`、`memos_webhooks`、`memos_webhook_deliveries`、`memos_webhook_events` 表及索引；全部是新增表，向后兼容上一正式版本，不需要回填。
- Worker 路由调整：`/file/*` 明确优先进入 Worker，不被 SPA 静态资源回退吞掉；`/api/*`、`/mcp`、`/openapi.json` 的行为保持不变。
- 无 R2 或 Access 资源变化。Cloudflare Access 仍是可选外层 policy，不是应用身份来源。
- Better Auth 认证边界不变：cookie session、`memos_pat_` PAT、native access/refresh JWT facade 和 Origin 校验语义与 v0.4.3 一致。
- Memos 兼容面扩大为：current camelCase REST、Better Auth-backed auth facade、PAT、legacy wire、Connect JSON/protobuf/gRPC-Web unary 子集、有限 SSE、无状态 `/mcp`、单用户 UserService webhook/notification 资源子集和四类 memo 事件的 bounded outbox 投递/重试。不宣称完整 Memos Server parity、完整上游 webhook 事件/egress 语义、完整多用户 ACL、原生 JWT parity 或第三方客户端已验证。

### 升级说明

- 执行标准的 `pnpm verify`、`pnpm deploy:dry-run` 和 `pnpm deploy`；`pnpm deploy` 会在发布 Worker 前自动应用 0008/0009 migration。
- 保持现有 `FLAREMO_PUBLIC_URL`、`FLAREMO_TRUSTED_ORIGINS`、`BETTER_AUTH_SECRET`、`FLAREMO_BOOTSTRAP_SECRET` 和已创建 PAT 配置；不要把任何 secret、密码、cookie 或 PAT 写入 Git、release notes、日志或聊天。
- 部署后重新验证登录页、bootstrap status、受保护 API 的 JSON `401`、可信/不可信 Origin、公开分享、`/mcp`、附件文件读取和 webhook/notification 资源。若启用 Cloudflare Access，它只能作为额外 policy，客户端仍必须提供 FlareMo 应用层 session 或 PAT。

## v0.4.3

生产 Worker 路由收口补丁。这个版本把 Better Auth 和 Memos-compatible 入口在 Cloudflare Workers 静态资源回退下的路由边界正式收口，确保原生鉴权不依赖 Cloudflare Access 才能工作。

### 已修复

- `/api/*`、根 `/mcp` 和根 `/openapi.json` 明确优先进入 Worker；不会被 SPA 静态资源回退吞掉。
- 未认证访问 `/api/app/health`、`/api/v1/openapi.json` 和 `/mcp` 返回 JSON `401`，而不是边缘路由导致的 `500` 或 HTML。
- 根 OpenAPI 文档和 Streamable HTTP MCP 入口在生产自定义域名上保持 Worker 响应，继续复用 Better Auth cookie session、session bearer 或 `memos_pat_` PAT 的应用层身份边界。

### Cloudflare、数据库与兼容影响

- 本版本不新增 D1 migration，不改变 D1/R2 资源绑定；已完成 bootstrap 的实例不需要重新初始化。
- Cloudflare Access 仍是可选的外层 policy，不是应用身份来源；生产主域名已通过 Better Auth 原生鉴权完成匿名 `401`、可信 Origin 和登录后的私有资源验证。
- Memos 兼容面没有扩大：仍是已记录的 current camelCase REST、Better Auth-backed auth facade、PAT、legacy wire 和 `/mcp` 无状态 MCP 子集；不宣称完整 Memos Server parity、原生 JWT/refresh parity 或所有第三方客户端已验证。

### 升级说明

- 执行标准的 `pnpm verify`、`pnpm deploy:dry-run` 和 `pnpm deploy`；远端 D1 应显示没有待执行 migration。
- 保持现有 `FLAREMO_PUBLIC_URL`、`FLAREMO_TRUSTED_ORIGINS`、`BETTER_AUTH_SECRET`、`FLAREMO_BOOTSTRAP_SECRET` 和已创建 PAT 配置；不要把任何 secret、密码、cookie 或 PAT 写入 Git、release notes、日志或聊天。
- 部署后重新验证登录页、bootstrap status、受保护 API 的 JSON `401`、可信/不可信 Origin、公开分享和 `/mcp`。若启用 Cloudflare Access，它只能作为额外 policy，客户端仍必须提供 FlareMo 应用层 session 或 PAT。

## v0.4.2

Better Auth 与 Memos-compatible 集成收口版本。这个版本不新增 D1 migration，重点修复 partial bootstrap、current auth facade 和渠道 Worker 的应用层认证边界。

### 已修复

- bootstrap status 只有在 `auth_bootstrap` 的完成状态、owner IDs 和精确 `auth_user_links` 映射全部一致时才报告 `complete`；未来用户 link 或 partial write 不会误开放 setup。
- 增加默认关闭的 `POST /api/auth/flaremo/recover-bootstrap` operator recovery，只协调唯一既有 Better Auth 身份与 `users/owner`，不接受用户名/密码、不创建第二个认证用户；多身份或歧义映射 fail closed 返回 `409`。
- current Memos `auth/refresh` 的 session bearer 统一经过共享认证 context，补齐过期、PAT 拒绝和 trusted Origin 校验；无 Origin 的机器 session bearer 仍可用。
- credential-bearing current signin/refresh 与 PAT 创建响应设置 `Cache-Control: no-store`；current signout 在同时收到 bearer 和 cookie 时会同时撤销 session 并清理 cookie。
- Telegram Worker 改为必须使用 Better Auth `memos_pat_` PAT；Cloudflare Access headers 仅在成对配置时追加，缺失/半配置 fail closed，FlareMo 目标 URL 强制为 HTTPS origin。
- bootstrap secret 最少 32 个字符；生产 `FLAREMO_PUBLIC_URL` 强制 HTTPS，本地 `.test`/localhost HTTP 仅用于开发测试。

### Cloudflare、数据库与兼容影响

- 本版本不新增 D1 migration；现有认证表和 PAT 仍必须纳入备份、恢复和演练范围。
- Cloudflare Access 仍是可选外层 policy，不能替代 Better Auth cookie/session bearer 或 PAT。公开分享是否能穿过 Access 仍取决于 Cloudflare 控制面的精确 bypass policy。
- 登录、bootstrap 和 operator recovery 的跨 edge 失败/请求限流需要在 Cloudflare WAF/Rate Limiting 配置；Worker 内置限流只是单 isolate 补充。
- 继续提供已记录的 Memos-compatible 子集，不宣称完整 Memos Server parity、原生 JWT parity 或所有第三方客户端已验证。

### 升级说明

- 保持现有 `FLAREMO_PUBLIC_URL`、`FLAREMO_TRUSTED_ORIGINS`、Better Auth secrets 和已创建的 PAT 配置；不要把任何 secret、密码、cookie 或 PAT 写入 Git、release notes、日志或聊天。
- 尚未 bootstrap 的实例需要使用不少于 32 个字符的 bootstrap secret；生产 canonical URL 必须是 HTTPS。
- 若 bootstrap status 为 `recovery_required`，仅在批准的 operator recovery 窗口临时配置 recovery secret，调用 `recover-bootstrap` 后立即轮换或删除该 secret。
- Telegram Worker 新增必需的 `FLAREMO_MEMOS_PAT` secret；生产仍启用 Access 时，再配置成对的 Access client ID/secret。

## v0.4.1

鉴权安全收口补丁。这个版本把 Better Auth、operator recovery 和 Memos-compatible auth facade 的安全边界收紧，同时不改变 D1 schema。

### 已修复

- Better Auth 的危险 cookie 请求（包括直接 Better Auth endpoint、bootstrap/recovery 和 current Memos signin/refresh）统一要求携带并精确匹配 trusted Origin；缺失或不可信 Origin 返回 `403`。
- 增加独立、默认关闭的 `FLAREMO_RECOVERY_SECRET` operator recovery：只重置已完成 bootstrap 的既有 owner，复用 Better Auth 的一次性 reset/password hashing/session 撤销流程，并撤销所有 `memos_pat_`；不创建第二个 owner。
- current Memos facade 的 PAT signout 现在会验证 PAT，随机/无效 PAT 不再得到假成功响应；Access headers 仍不能单独成为应用身份。
- 明确记录当前没有 email provider，Better Auth 忘记密码邮件流程保持关闭；恢复能力与普通“知道当前密码时修改密码”不再混淆。

### Cloudflare、数据库与兼容影响

- 本版本不新增 D1 migration；已有 Better Auth 认证表仍必须包含在 D1 备份、恢复和演练范围内。
- Cloudflare Access 仍只是可选外层 policy；Access headers 或 Service Token 不会成为 FlareMo 应用身份。
- 本版本继续提供已记录的 Memos-compatible 子集，不宣称完整 Memos Server parity、原生 JWT parity 或第三方客户端已验证。

### 升级说明

- 保持现有 `FLAREMO_PUBLIC_URL`、`FLAREMO_TRUSTED_ORIGINS`、`BETTER_AUTH_SECRET` 和 `FLAREMO_BOOTSTRAP_SECRET` 配置；不要把 secret、密码、cookie 或 PAT 写入 Git、release notes、日志或聊天。
- `FLAREMO_RECOVERY_SECRET` 默认不配置；只在批准的 operator recovery 窗口临时配置，成功后立即轮换或删除。
- 升级后重新验证 trusted Origin、cookie session、PAT 创建/访问/撤销、旧 session/PAT 失效和公开分享；生产 authenticated smoke 若仍被 Cloudflare Access 拦截，必须通过已授权 Access session/token 验证，不能把 Access headers 当作应用身份。

## v0.4.0

Memos current 兼容与原生认证生态版本。这个版本把 FlareMo 从“有 Better Auth/PAT 基础的 Memos-compatible API”推进到默认 current camelCase REST、Better Auth-backed auth facade 和根 `/mcp` 无状态 Streamable HTTP MCP 子集，同时保留旧 wire 供已有客户端迁移。

### 已包含

- 接入 Better Auth + D1/Drizzle adapter：用户名/密码、HttpOnly cookie session、一次性 owner bootstrap，并关闭正常公共 signup。
- 保留既有 `users/owner`、memo、attachment、R2 object key 和 share token，通过 `auth_user_links` 做认证身份到业务用户的桥接。
- 增加 `memos_pat_` Personal Access Token 基础：由 cookie session 创建，明文只在创建时返回一次，可以列出元数据和撤销；PAT 可用于 current `/api/v1/*`、旧式 `/api/v1/mcp` 和根 `/mcp` 子集。
- 新增 `FLAREMO_PUBLIC_URL`、可选 `FLAREMO_TRUSTED_ORIGINS` 两个公开 Worker vars；`BETTER_AUTH_SECRET` 和 `FLAREMO_BOOTSTRAP_SECRET` 必须通过 Wrangler secret 或 Cloudflare 控制台配置。
- 增加按凭据区分的 Origin 安全契约：cookie session 的 `POST`、`PATCH`、`DELETE` 等状态变更必须携带并精确命中 allowlist；PAT 可以无 Origin，但携带 Origin 时也必须命中，否则返回 `403`。Access headers 不替代应用层 Origin 校验。
- 默认 `/api/v1` 增加 current Memos camelCase / protobuf-JSON wire adapter，包括 current memo、attachment、relation、share、user、PAT DTO、current 大写枚举、有限 filter/order、分页、`updateMask`、nested relation/share 和标准错误。
- 增加 Better Auth-backed current auth facade：`/api/v1/auth/me`、`signin`、`refresh`、`signout`。`accessToken` 是 opaque session-backed token，不是 Memos 原生 JWT。
- 增加根 `/mcp` 无状态 JSON Streamable HTTP MCP 子集，支持 `initialize`、`notifications/initialized`、`tools/list` 和 `tools/call`；保留 `/api/v1/mcp` 旧式 JSON-RPC 工具名。
- 增加 current OpenAPI 文档和显式 legacy wire negotiation；FlareMo Web 内部客户端明确选择 legacy wire，外部 `/api/v1` 调用默认选择 current wire。
- 增加 current contracts、adapter、OpenAPI、MCP 和 Worker/E2E 测试，并记录第三方客户端仍需真实 smoke test 的兼容边界。

### Cloudflare、数据库与兼容影响

- 本版本不新增 D1 migration；已有 Better Auth 认证表仍必须包含在 D1 备份、恢复和演练范围内，包括 `auth_users`、`auth_sessions`、`auth_accounts`、`auth_verifications`、`auth_apikeys`、`auth_user_links` 和 `auth_bootstrap`。
- 第一轮生产部署建议保留 Cloudflare Access。Access Service Token 只通过外层 policy，不自动成为 FlareMo 应用用户身份；启用 Access 时，机器请求仍需 FlareMo PAT。
- 本版本不承诺完整 Memos Server parity、完整 CEL、Connect/gRPC、SSE、Memos 原生 JWT 字节级 parity、comments/reactions/shortcuts 或第三方客户端已验证。完整兼容矩阵见 `docs/memos-compatibility.md`。

### 升级说明

- 设置 `wrangler.jsonc` 中的 `FLAREMO_PUBLIC_URL`，并通过 `wrangler secret put` 配置两个 Better Auth secrets；不要把真实值写进仓库、release notes、issue、日志或聊天。
- 本版本不需要新的 D1 migration；尚未 bootstrap 的实例仍需由部署者在生产 HTTPS 的 `/setup` 页面手动完成一次 owner bootstrap。bootstrap secret、用户名、邮箱和初始密码不进入 shell、Agent 输出、release notes、Git 或日志。
- 验证 cookie session、密码修改后的其他 session 撤销、PAT 创建/访问/撤销、公开分享匿名访问和无凭据 `401`；同时验证 cookie mutation 的 trusted Origin、无 Origin 的 PAT，以及不可信 Origin 的 `403`。
- 在认证与备份脚本完成远端演练前，不要关闭 Access，也不要把本次变更宣称为完整生产认证/恢复验收。生产入口仍可保留 Access 作为外层防线；Better Auth 是应用层身份来源。

## v0.3.0

自托管更新体验版本。这个版本让 Deploy Button 创建的 GitHub 仓库可以发现上游稳定 Release、准备可审查的升级 PR，并在合并后继续使用 Cloudflare Workers Builds 发布。

### 已包含

- 前端侧栏增加“系统更新”入口，显示当前版本、最新稳定版本、发布日期和 Release notes。
- `/api/app/health` 增加版本元数据，支持把部署仓库配置为 `FLAREMO_DEPLOY_REPOSITORY`，从应用直接进入该仓库的更新 workflow。
- 新增 `flaremo-update.yml`：每天或手工检查最新稳定 Release，根据两个 Release 之间的差异在用户部署仓库中创建升级 PR；它不依赖上游提交历史，检测到自定义代码冲突时停止且不覆盖 `main`。
- `pnpm deploy` 会在 Worker 发布前自动应用远端 D1 migrations，使 Deploy Button 首装和后续 Workers Builds 更新使用同一条部署链路。
- 增加中英文更新指南，并把 GitHub Actions 例外收窄为用户部署仓库的 Release 同步；它不承担项目 CI，不持有 Cloudflare 凭据，也不直接部署。
- root、Web、Worker、contracts、db、domain、memos、OpenAPI 和 MCP 版本统一到 `0.3.0`。

### Cloudflare、数据库与兼容影响

- 不新增 D1 migration，不改变 D1、R2、Access、Cron 或 Memos-compatible `/api/v1/*` 行为。
- 新增普通变量 `FLAREMO_DEPLOY_REPOSITORY`；值为用户部署仓库的 `owner/repository`。留空不影响笔记功能，只会让系统更新入口退回升级指南。
- 从本版本起 `pnpm deploy` 自动执行 `pnpm migrate:remote`；已有 migration 会由 Wrangler 跟踪，不会重复应用。
- 更新分支使用 Cloudflare 默认的 non-production `wrangler versions upload` 命令创建 preview；只有合并到 production branch 后的 `pnpm deploy` 才执行远端 migration。
- GitHub Action 只使用当前部署仓库临时的 `GITHUB_TOKEN` 创建分支和 PR。Cloudflare Workers Builds 仍是唯一生产部署器。

### 升级说明

- v0.2.1 或更早实例需要最后手工升级一次到 v0.3.0。
- 在生成的部署仓库中启用 Actions 的仓库写入和创建 PR 权限。
- 把 `FLAREMO_DEPLOY_REPOSITORY` 设置为该 GitHub 仓库，例如 `octocat/flaremo`。
- 以后可在 FlareMo 的系统更新入口运行更新 workflow，合并生成的 PR 后由 Cloudflare 自动部署。
- GitLab 部署继续使用手工升级流程。

## v0.2.1

开发工具链安全补丁。这个版本把已经合并到 `main` 的依赖修复纳入正式发布，不改变 v0.2.0 的生产功能、数据模型或 Cloudflare 资源。

### 已修复

- 使用 pnpm parent-scoped override，将 `drizzle-kit` 旧加载器链中的传递依赖从受影响的 `esbuild@0.18.20` 固定到已修复的 `0.25.12`。
- 重新生成 lockfile，移除旧 esbuild 及其平台二进制包；GitHub Dependabot 未解决告警恢复为 0。
- 放宽 Miniflare hook 和 Playwright 本地服务器/单测试超时，避免低性能或多任务开发机上的发布门禁被环境启动速度误判为回归。
- root、Web、Worker、contracts、db、domain、memos、OpenAPI 和 MCP 版本统一到 `0.2.1`。

### Cloudflare、数据库与兼容影响

- 不新增 D1 migration，不改变 D1、R2、Access、Cron 或 Worker 运行逻辑。
- 不改变 `/api/app/*`、Memos-compatible `/api/v1/*`、OpenAPI 或 MCP 的行为合同。
- 生产部署可以直接覆盖 v0.2.0，无需调整资源绑定或执行数据库迁移。

### 升级说明

```bash
pnpm install
pnpm verify
pnpm deploy:dry-run
pnpm deploy
```

## v0.2.0

完整知识管理与数据可靠性版本。这个版本把搜索、附件、分享、关系、历史版本、导入导出和前端详情页一起补齐，并继续保持 Workers + D1 + R2 + Cloudflare Access 的原生架构。

### 已包含

- 增加 D1 FTS5 全文索引、规范化 `memo_tags` 表、稳定置顶游标分页和 SQL 聚合统计；不适合 FTS 查询语法的输入自动回退到安全模糊匹配。
- 增加 `memo_revisions`，编辑时保存旧版本，并提供版本列表与恢复接口。
- 增加 memo 上下文接口，一次返回附件、有效分享、正向关系、反向链接和历史版本；App 侧使用 D1 batch 收敛查询。
- 分享支持复用、列出和撤销；公开分享继续校验 token、过期时间和 memo 状态，不暴露私有附件。
- R2 附件增加 25 MiB 限制、ETag、Range、内联预览、安全 Content-Disposition、上传补偿、硬删除清理和每日孤儿清理 Cron。
- 导入导出升级为 v2，保留时间、来源和关联数据，支持 `duplicate`、`skip`、`overwrite` 冲突策略，并清理被替换或未使用的 R2 对象。
- 前端增加 Markdown/GFM、安全外链、图片与音频预览、独立 memo 详情路由、关系与反向链接、历史恢复和分享生命周期管理。
- 搜索、标签和视图状态进入 URL；编辑、归档、恢复和删除使用带回滚的 TanStack Query 乐观缓存更新。
- OpenAPI、MCP serverInfo、所有 workspace package 版本统一到 `0.2.0`；TypeScript 统一为 5.9，并更新 Workers types、Wrangler 和 Miniflare。
- Worker 集成测试覆盖全文检索、历史恢复、反向链接、分享撤销、Range、硬删除和计划清理；E2E server 增加强制退出兜底。

### Cloudflare 与数据库影响

- 新增 migration `0002_wooden_professor_monster.sql`：创建 `memo_tags`、`memo_revisions`、FTS5 虚拟表与触发器，并给附件、分享和反向链接补索引及生命周期字段。
- `wrangler.jsonc` 新增每天 `03:17 UTC` 的 Cron Trigger，用于清理超过 24 小时未绑定或处于删除中的附件。
- 不新增 D1、R2、KV、Vectorize 或 Workers AI 资源；D1 仍是唯一事实源，R2 仍只保存对象。
- 生产访问边界仍是 Cloudflare Access；不新增应用内 Bearer token 登录。

### 升级说明

```bash
pnpm install
pnpm verify
pnpm deploy:dry-run
pnpm migrate:remote
pnpm deploy
```

- 必须先完成远端 migration，再让新 Worker 接受写请求。
- 部署后检查 Cron Trigger 已创建，并抽查全文搜索、附件 Range/预览、公开分享和历史恢复。
- 大于 32 MiB 的内联导出会返回 `413`；请使用元数据导出并单独备份 R2。
- 本版本不包含 Vectorize 语义搜索、AI 回顾或平台专用聊天机器人。

## v0.1.5

前端性能、交互可靠性和移动端可用性优化版本。这个版本把列表查询、统计和附件元数据收敛为服务端分页合同，同时补齐失败恢复、危险操作确认和响应式验收。

### 已包含

- 首页从多列表请求和逐条附件查询收敛为当前视图分页请求与独立统计请求，附件元数据随 Memo 批量返回。
- 增加 `/api/app/stats`，提供状态计数、标签统计、活跃天数和最近 84 天活动数据。
- 列表改为服务端分页、搜索和精确标签过滤，修复复合游标的稳定排序，并增加“加载更多”交互。
- 保存和附件上传失败时保留编辑器草稿，并对已上传对象执行补偿清理，避免半成品 Memo 或孤立附件。
- 永久删除只在回收站提供，并使用确认对话框；移除点击时间戳归档的隐藏交互。
- 移动端侧栏增加独立滚动区域，确保标签较多或屏幕较短时仍能访问导入、导出入口。
- 活动热力图按周排列，月份和时区计算改为动态值，并将重复读屏信息收敛为一个摘要。
- 增加错误、重试和非法导入反馈；优化深色品牌色、滚动条、首屏主题闪烁和长列表渲染。
- E2E 使用隔离的 `.wrangler-e2e` 数据库，并覆盖请求瀑布、失败草稿、永久删除确认、分页与移动侧栏溢出。
- Web 类型改为复用 `@flaremo/contracts`，减少前后端合同漂移。

### 约束

- 不新增 Cloudflare 资源。
- 不新增 D1 migration。
- 不改变 `/api/v1/*` Memos 兼容 API 合同。
- 不引入 GitHub Actions。
- 生产访问边界仍是 Cloudflare Access。

### 升级说明

- 自托管升级按常规流程执行 `pnpm verify`、`pnpm migrate:remote` 和 `pnpm deploy`。
- 本次没有数据库结构变更，远端 migration 预期为 no-op。
- 前端会改用新的 `/api/app/stats` 和分页参数，部署时应同时更新 Worker 与静态资源。

## v0.1.4

开源项目成熟度补强版本。这个版本不改变部署架构，重点是补齐公开协作、双语入口、工程门禁、Memos 生态兼容记录和 GitHub 仓库治理。

### 已包含

- 增加 `CODE_OF_CONDUCT.md`、`SUPPORT.md` 和 `CODEOWNERS`，补齐社区治理和支持入口。
- 增加 `README.en.md`、`docs/en/deploy.md`、`docs/en/agent-deploy.md` 和 `docs/en/memos-compatibility.md`，提供最小英文入口。
- 增加 `docs/memos-ecosystem.md`，公开记录 Memos 第三方客户端、脚本和 MCP 工具的兼容验证状态。
- 根目录增加 `pnpm lint`、`pnpm format`、`pnpm format:check`，并把 `pnpm format:check` 纳入 `pnpm verify`。
- Playwright E2E 扩大到创建/搜索、编辑/分享、归档/恢复、回收站/恢复/彻底删除和移动端导航。
- Playwright 本地 webServer 启动前自动执行 `pnpm migrate:local`，避免 E2E 依赖本机残留 D1 schema。
- Memos-compatible contract test 增加 OpenAPI 版本断言和公开分享附件隔离测试。
- OpenAPI 版本同步到 `0.1.4`。
- GitHub 仓库启用 main/tag rulesets、Dependabot security updates、vulnerability alerts、secret scanning 和 push protection。

### 约束

- 不新增 Cloudflare 资源。
- 不新增 D1 migration。
- 不改变 Memos 兼容 API 路径。
- 不引入 GitHub Actions。
- 生产访问边界仍是 Cloudflare Access。

### 升级说明

- 代码部署不需要额外 Cloudflare 操作。
- 自托管升级按常规流程执行 `pnpm verify`、`pnpm deploy:dry-run` 和 `pnpm deploy`。
- 如果本地 E2E 曾依赖旧的 `.wrangler` 状态，现在会在测试启动前自动应用本地 D1 migrations。

## v0.1.3

Deploy Button 文档修正版本。这个版本不改变运行时代码，只把实测得到的 Cloudflare Git provider 前置条件写进 README 和部署文档。

### 已包含

- README 的一键部署段落增加 GitHub/GitLab provider 连接说明。
- `docs/deploy.md` 增加 `Connect a Git account to continue.` 的原因说明。

### 约束

- 不新增 Cloudflare 资源。
- 不新增 D1 migration。
- 不改变 Memos 兼容 API。

### 升级说明

- 代码部署不需要额外操作。
- 如果使用 Deploy Button，需要先在 Cloudflare Dashboard 连接 GitHub 或 GitLab provider。

## v0.1.2

Deploy Button 实测记录补强版本。这个版本不改变运行时代码，只把 Cloudflare Dashboard 真实创建页的验证结果写进仓库。

### 已包含

- 更新 `docs/deploy-button-test.md`，记录 Chrome 登录态下进入 Workers `deploy-to-workers` 创建页的实际结果。
- 记录 Cloudflare 能解析 FlareMo 的项目名、D1/R2 binding、环境变量、构建命令和部署命令。
- 记录测试时如何把 D1/R2 从现有生产资源切到独立新建测试资源，避免误连生产数据。
- 记录完整部署当前被 `Connect a Git account to continue.` 挡住，需要先在 Cloudflare Dashboard 连接 GitHub/GitLab provider。

### 约束

- 不新增 Cloudflare 资源。
- 不新增 D1 migration。
- 不改变 Memos 兼容 API。
- 不静默执行 Git provider OAuth 授权。

### 升级说明

- 代码部署不需要额外操作。
- 如果要完整跑通 Deploy Button，需要先在 Cloudflare Dashboard 连接 GitHub 或 GitLab provider。

## v0.1.1

开源项目基础设施补强版本。这个版本不改变部署架构，重点是让仓库首页、验证脚本、备份演练、兼容测试和发版流程更可信。

### 已包含

- README 增加真实桌面端和移动端截图，截图由 `pnpm screenshots` 从本地 Worker 实例生成。
- 增加 `pnpm release <version>`，本地完成工作树、远端 main、tag、`pnpm verify`、`pnpm deploy:dry-run` 和 GitHub Release 检查。
- 增加 `pnpm backup:drill`，覆盖本地 D1 导出、隔离恢复、恢复后 schema 查询、远端 migration 检查和 R2 bucket 检查。
- 增加 Memos-compatible Worker contract test，覆盖 memo DTO shape、附件 export/import roundtrip 和 OpenAPI 路径。
- `POST /api/v1/import` 返回值增加 `imported_attachments`，导入结果不再只统计 memo、relation 和 share。
- README、维护文档、发版文档补齐截图、备份演练、发版脚本和兼容测试说明。

### 约束

- 项目仍不使用 GitHub Actions 作为 CI。
- D1 仍是事实源，R2 仍只保存附件、导出包和对象文件。
- Cloudflare Access 仍是生产访问边界，不增加应用内 Bearer token 登录。

### 升级说明

- 不需要新增 Cloudflare 资源。
- 不需要执行新的 D1 migration。
- 从旧版本升级代码后执行 `pnpm verify` 和 `pnpm deploy:dry-run`，确认通过后再部署。

## v0.1.0

首个公开可部署版本。这个版本把 FlareMo 收口成 Cloudflare-native、Memos-compatible 的自托管笔记系统，并补齐开源项目所需的部署、协作、Agent、发版和安全文档。

### 已包含

- Cloudflare Worker + Workers Static Assets 一体部署。
- D1 schema 和 Drizzle migrations。
- R2 附件存储。
- memo、user、attachment、relation、share、setting 基础领域服务。
- Memos 兼容 `/api/v1` 子集。
- Flomo 风格的快速记录和时间线 UI。
- 搜索、标签筛选、归档、回收站、活动热力图。
- Memos 数据导入导出。
- OpenAPI 输出。
- MCP 端点。
- 中英文界面。
- Cloudflare Access 作为生产访问边界。
- Deploy to Cloudflare 按钮。
- 人工部署文档和 Agent 部署 runbook。
- 维护、备份和恢复手册。
- Memos 兼容矩阵。
- 发版规则、贡献指南、安全策略、issue template 和 PR template。
- `pnpm verify`、`pnpm migrate:local`、`pnpm migrate:remote`、`pnpm deploy:dry-run` 质量门禁。
- 本地 Vitest 配置排除 `dist`，避免构建产物重复进入测试。
- Playwright E2E 覆盖创建 memo 和标签筛选主路径。

### 约束

- 项目不使用 GitHub Actions 作为 CI。
- 发布前由维护者在本地执行 `pnpm verify` 和 `pnpm deploy:dry-run`。
- D1 是主数据事实源；R2 只存对象文件。
- 生产访问边界由 Cloudflare Access 处理。

### 升级说明

- 生产部署前执行 `pnpm migrate:remote`。
- 生产实例建议放在 Cloudflare Access 后面。
- 脚本、Memos-compatible 客户端和 MCP 使用 Access Service Token。
