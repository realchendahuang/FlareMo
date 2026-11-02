# 项目/任务功能全面审查

- 日期：2026-09-17
- 范围：projects & tasks 全链路（前端页面与交互、worker 路由与 domain、contracts、日历/侧栏/通知等消费点、MCP/Telegram/OpenAPI 通道、i18n、测试、文档叙事）
- 性质：审查 + 解决方案决策稿。问题清单在第一至八节（编号 1.1–7.13，供引用）；第九节为覆盖全部问题的解决方案，**已于同日全部实施并部署**（见文末实施记录）；D1–D4 四个产品级决策按推荐方案落地。
- 方法：三路并行深查（后端 / 前端 / 跨功能一致性），主会话对 P0/P1 级结论逐条亲自复核源码。

---

## 结论先行

**这不是敷衍做的功能，而是工程手艺明显高于平均、但产品层没收口的"盖了一层楼的地基"。**

- 认真的部分：FK 级联完整无 orphan、跨用户隔离严格（404 不泄露存在性）、共享 `["tasks"]` 缓存 + 按前缀失效 + 乐观更新带快照回滚、8 语言类型强校验无占位翻译、agent 写入有 append-only 活动审计、注释质量高于平均。
- 问题的部分：**产品定义没收口**——后端合同里现成的能力（移动任务、排序、状态过滤、agent actor）前端一个都没消化；memo 待办与 tasks 是两套从不握手的世界；任务没有回收站、自助导出不含它；日历消费 `due_at` 的三处下游全在裸字符串比较，而写入端不校验格式。**"右上角傻逼按钮"不是孤例，是同一类病：UI 只消化了后端能力的一半，剩下一半悬在半空。**

分级含义：P0 = 当前无（未发现 bug/安全/数据丢失级别的现行事故）；P1 = 明确缺陷或实打实的 bug；P2 = 体验缺口、一致性、打磨。

---

## 一、交互与产品闭环

| # | 级别 | 问题 | 证据 | 修复方向 |
|---|---|---|---|---|
| 1.1 | P1 | **编辑任务无法换项目**。后端 `updateTaskSchema.project_id` 支持移动，但 UI 编辑对话框根本不渲染项目选择、保存时不发 `project_id`，`projects={[]}` 是死参数 | `apps/web/src/pages/projects-page.tsx:775-780`、`packages/contracts/src/projects.ts:102` | 编辑态渲染项目下拉（needsProject 条件放宽到编辑态），保存时带上 |
| 1.2 | P1 | **删除已选中的项目后进入"幽灵筛选"**：`selected` 不清理，头部显示"全部任务"但查询仍是 `["tasks", 已删id]`，侧栏无高亮、空态文案说"在这个项目下新建第一个任务"，用户只能手动点回 | `apps/web/src/pages/projects-page.tsx:126-127, 393-401` | 删除成功时若删的是当前选中项，回退 `ALL_TASKS` |
| 1.3 | P1 | **后端有排序能力，前端零接线**：contracts/domain 有 `reorderTasks` + `sort_order`，但 api.ts 没有 reorder 函数，看板三列无拖拽、列内无排序；日历页反而有拖拽改期，能力不对称 | `packages/contracts/src/projects.ts:115-120`、`packages/domain/src/tasks.ts:269` | 看板接拖拽或至少列内上移/下移 |
| 1.4 | P1 | **0 项目时「新建任务」是死路**（最初抱怨的根因之一）：对话框必须选项目才能保存，而项目列表为空 | `apps/web/src/pages/projects-page.tsx:956`、`:880-895` | 0 项目时隐藏该按钮；或支持无项目任务（见 2.1） |
| 1.5 | P2 | **右上角双按钮视觉堆叠**：SubpageHeader 的「新建项目」与任务区的「新建任务」上下叠在同一角落，像重复按钮 | `projects-page.tsx:138, 207` | 收口进同一行，或空态时只留一条路 |
| 1.6 | P2 | **空态没有 CTA 按钮**：Empty 只有标题+描述，没有"新建项目"按钮；而 daily-review、memory 等页空态都带 Button，rigor 不一致 | `projects-page.tsx:288-310` | 空态补主 CTA |
| 1.7 | P2 | **done 点击"推进"回环到 todo**（跳过 in_progress）且无撤销 | `projects-page.tsx:667-675` | done 点击弹"重开/归零"或直接禁用点击改走菜单 |
| 1.8 | P2 | **无批量操作**：多选、批量完成/删除/改期一律没有；`listTasks` 的 status 过滤参数前端也没用 | `apps/web/src/api.ts:450` | 按需补 |
| 1.9 | P2 | **新建对话框重开时 projectId 不重置**，在"全部任务"下连续建任务会沿用上一次选的项目（靠 `key={selected}` 重挂载兜底，脆弱） | `projects-page.tsx:851-855, 234` | reset 列表补 `projectId` |

---

## 二、产品结构：任务系统在产品里的处境

| # | 级别 | 问题 | 证据 | 修复方向 |
|---|---|---|---|---|
| 2.1 | P1 | **两套孤立的"待办"系统**。memo 内 markdown checkbox 与 tasks 零桥接（双向都不通）；R10 叙事却把日历定义为"到期任务 + 笔记内未勾选任务清单"的合体，用户必然问"勾掉笔记里的待办为什么日历不变" | `packages/domain/src/memos.ts:138, 1085`、`calendar-view.ts:50-77`、`docs/product-requirements.md:98-100` | 先想清产品决策（桥接 or 明确宣布两套），再动代码 |
| 2.2 | P1 | **Web 端甚至不能勾选 memo 里的 checkbox**——只配了 CSS 着色（`index.css:429-431`），没有任何勾选交互；"未完成待办"在日历上只能被数出来，不能被消掉 | `apps/web/src/index.css:429-431` | 与 TipTap WYSIWYG 决策稿（`docs/composer-editor-wysiwyg.md`）合并考虑 |
| 2.3 | P2 | **无 due 的任务在日历侧完全隐形**：agenda 和月历都跳过 `!task.due_at`，不带截止日的任务只在 /projects 页可见 | `calendar-page.tsx:646-647, 104` | 日历加"无日期任务"聚合区，或接受并文档化 |
| 2.4 | P2 | **任务消费点少且浅**：搜索（workspace-search）、每日回顾、随机漫步全部不索引任务；`task_overdue` 通知深链只到 /calendar 而非具体任务；mini 日历的逾期数不可点（`dueToday` 是 Link，`overdueCount` 只是 `<p>`） | `notification-bell.tsx:72-75`、`flaremo-mini-calendar-panel.tsx:68-81` | 逾期通知直链具体任务/日期 |
| 2.5 | P2 | **日历快速建日程会静默创建「日历默认项目」**：无项目时自动 `createProject`，一个用户没建过的项目出现在项目列表里 | `calendar-page.tsx:344-356` | 至少在项目列表里标注来源；或允许无项目任务（同 1.4） |
| 2.6 | P2 | **术语分裂：同一实体两套名字**。zh/ja/ko 侧日历全叫「日程」、projects 页叫「任务」，用户跨页建立不起同一概念（en 侧倒是统一的 "tasks"） | `zh-CN.ts:161-181` vs `:689` | 定一个词。日历页本质在排 tasks，称「日程」有产品理由，但至少要在文案里互相指认 |

---

## 三、数据安全与生命周期

| # | 级别 | 问题 | 证据 | 修复方向 |
|---|---|---|---|---|
| 3.1 | P1 | **tasks/projects 没有回收站，与 memo 不对称**：memo 有 trashed 状态 + 30 天 TTL + cron 清理；task/project 删除是即时硬删，project 硬删会**级联永久销毁全部任务与活动记录**（UI 有确认框和警告文案，但误删无法挽回） | `packages/domain/src/projects.ts:153-165`、`tasks.ts:315-325`、对比 `memo-hard-delete.ts` | 对齐 memo 基线：软删 + TTL 回收站；或至少 project 删除加输入确认 |
| 3.2 | P1 | **用户自助导出 bundle 不含 projects/tasks**：`import-export.ts` 只导 memos + memory 七表；管理员灾备清单反而覆盖。自托管用户自助备份会丢任务数据 | `packages/domain/src/import-export.ts:36-51`、`scripts/persistence-manifest.mjs:45-46` | 导出纳入 projects/tasks/task_activity |
| 3.3 | P2 | **`task_activity` 自称 append-only audit trail，但删除动作不进 trail**：hardDeleteTask 不追加 activity 直接靠 FK cascade 把记录带走；`"deleted"` 是死枚举值 | `packages/db/src/schema/tasks.ts:86-91` 注释、`contracts/projects.ts:15`、`tasks.ts:315-325` | 删除前补写 activity，或删掉死枚举并修正注释 |
| 3.4 | P2 | **reorder 活动写 `task_id=null`，无任何读路径**，等于写了读不到的数据 | `tasks.ts:303-306` | 给 activity 加端点或砍掉这类写入 |
| 3.5 | OK | 账号自助注销、成员移除均已覆盖 projects/tasks 的清理（v0.14.0 起） | `users.ts:503-505`、`CHANGELOG.md:187-190` | — |

---

## 四、API、校验与日历边界（后端）

| # | 级别 | 问题 | 证据 | 修复方向 |
|---|---|---|---|---|
| 4.1 | P1 | **`due_at` 不做格式校验，三处下游全按裸字符串比较消费**：contract 只限 ≤64 字符任意字符串；日历聚合、cron 逾期推送、逾期收件箱三处都是 `lt/gte(tasks.dueAt, 字符串)` 字典序比较。写入 `2026/09/12` 或 `明天` 会静默从日历和逾期提醒里消失 | `contracts/projects.ts:85,95`、`calendar-view.ts:84-88`、`index.ts:462`、`review.ts:377` | 服务端校验/归一化为 `YYYY-MM-DD`（或显式接受 RFC3339 并统一转换） |
| 4.2 | P1 | **日历 `to` 边界漏掉带时间的 due_at**：`lte(tasks.dueAt, to)` 下，`due_at="2026-09-12T15:00:00Z"` 字典序大于 `"2026-09-12"`，当天带时间任务整个被排除；date-only 写法反而能匹配——现有测试恰好只测了 date-only，掩盖了这个 bug | `calendar-view.ts:85`、`calendar-api.test.ts:81-122` | 改为 `lt(dueAt, to+1day)` |
| 4.3 | P1 | **同一张日历两套"一天"的定义**：notes 按 tz 偏移分桶到本地日，tasks 不做偏移。UTC+8 用户凌晨截止的任务会落错格 | `calendar-view.ts:16-26`（notes 有 offsetMinutes）vs `:84-88`（tasks 无） | tasks 侧统一做 tz 处理（注意与 `tasks.dueAt 为日程唯一事实源` 的既有设计兼容） |
| 4.4 | P1 | **列表端点无分页**：memos 有 `page_size/page_token`，tasks 全量返回无 limit；也不能按 priority/due_at 范围过滤，项目不能按名搜 | `contracts/projects.ts:75-77,103-106` vs `contracts/memos.ts:72-73,167` | 分页 + 补过滤维度 |
| 4.5 | P2 | **reorder 无护栏**：`task_ids` 数组无 max，且 domain 里逐行 UPDATE（N+1）；传入不属于该项目的 task_id 静默忽略（行为本身值得测试） | `contracts/projects.ts:108-111`、`tasks.ts:279-300` | 限长 + 批量语句 |
| 4.6 | P2 | **资源名 strip 三处重复实现**：routes 两处手写 + domain 一处本地实现，共享 `parseResourceName` 没被用（功能等价无 bug，风格与 memos/shares 不一致） | `projects-api.ts:24-26`、`tasks-api.ts:29-31`、`tasks.ts:331-333` | 收口到共享 helper |
| 4.7 | P2 | **PAT 前 8 字符写进业务表 `actor_name`**：是前缀片段非完整 token，风险低，但属于把凭证片段入库 | `tasks-api.ts:41-45` | 可接受，留档即可 |
| 4.8 | OK | 错误码映射统一（DomainError→HTTP 400/404/429）、跨用户一律 404 不泄露、cookie CSRF 校验齐全 | `http.ts:6-35`、`tasks.ts:69` | — |

---

## 五、测试覆盖

| # | 级别 | 问题 | 证据 |
|---|---|---|---|
| 5.1 | P1 | **零跨用户隔离测试**：所有测试只建单用户，权限拒绝、用他人 project_id 建任务、访问他人 task 404、跨用户 reorder 均无覆盖 | `projects-api.test.ts`、`domain/projects.test.ts` |
| 5.2 | P1 | **tasks-api 无独立 HTTP 层测试文件**：reorder 端点、activity 端点、unarchive、422/400 校验负例、due_at 超长、未知 project_id 全没测 | `apps/worker/src/` 下无 tasks-api.test.ts |
| 5.3 | P2 | 无边界值测试（name 长度上限、重复 id reorder、非法 due_at） | — |
| 5.4 | OK | CRUD/计数/状态/归档/级联/calendar 聚合的 happy path 覆盖是完整的 | `projects-api.test.ts:58-158` 等 |

---

## 六、文档叙事与版本管理（"管理"层面的欠账）

| # | 级别 | 问题 | 证据 |
|---|---|---|---|
| 6.1 | P1 | **README（8 语言版同）零提及 Projects/Tasks/Calendar**，而这是侧栏一级入口；README 里的 "project context" 与 Projects 功能同名不同义，加重混淆 | `README.md:48,54-88` |
| 6.2 | P2 | **CHANGELOG 对两大波功能零记录**：projects/tasks 基座（08-23 d2e7c02）与 R10 日历（09-12 三连）无任何版本条目 | `CHANGELOG.md` |
| 6.3 | P2 | **R10 决策稿没打"已实现"收口**（对比 R5/R11 都有状态行）；且 R10 写明"不做提醒推送"，但逾期提醒 + Web Push 已实装，决策稿未回填 | `docs/product-requirements.md:96-108` vs `:94,129`、`review.ts:359-405` |
| 6.4 | P2 | **官网只在 showcase 装饰标签里出现"项目/日程"**，正式卖点文案零提及 | `apps/site/src/content/copy.ts` |
| 6.5 | P2 | **对外三条通道一条不暴露任务**：MCP 只有 13 个 memo_* 工具、Telegram bot 只做 memo 摄取、Memos 兼容层干净地不收 tasks（与 Memos 本体一致，处理本身没毛病）——代价是第三方客户端完全无法管理任务；唯一对外写入口 `/api/app/tasks` + PAT 未进任何对外契约文档 | `mcp.ts:342-556`、`telegram-bot/index.ts:1-60`、`docs/architecture-notes.md:61` |

---

## 七、i18n、a11y、移动端、打磨杂项

| # | 级别 | 问题 | 证据 |
|---|---|---|---|
| 7.1 | P1 | 推进按钮只有 `title` 无 `aria-label`，读屏听到无名按钮 | `projects-page.tsx:688-694` |
| 7.2 | P2 | More 菜单按钮 `opacity-0 group-hover`：触屏无 hover 时不可见但占位可误触 | `projects-page.tsx:433, 709` |
| 7.3 | P2 | 原生 select 三处手搓复制同一串 class（projects 页 3 个 + memory 页 3 个 + capture 页另一套）；ui/ 下没有 select 组件 | `projects-page.tsx:883,906,922` |
| 7.4 | P2 | `["calendar"]` 与 `["tasks"]` 双缓存不同步：任务变更只失效 tasks+projects，日历靠 30s staleTime 兜底，窗口内显示旧状态/旧 due | `projects-page.tsx:121-124`、`main.tsx:19` |
| 7.5 | P2 | 编辑对话框 key 含 7 个任务字段：agent 并发更新任务 → refetch → key 变 → 重挂载，用户未保存的输入被静默丢弃 | `projects-page.tsx:766-774`、`contracts/projects.ts:25-28` |
| 7.6 | P2 | 日历拖拽用原生 HTML5 draggable，触屏无效（有"改期"按钮兜底，月历格间拖拽整体失效） | `calendar-page.tsx:405` |
| 7.7 | P2 | 死键 `calendar.viewAgendaJump`（8 语言都维护着但无调用）；`calendar.today`/`todayMini` 值重复应合并 | `zh-CN.ts:172,150-151` |
| 7.8 | P2 | ja 把任务备注译成「メモ」，与产品里 memo/音声メモ 概念撞车 | `ja.ts:785` |
| 7.9 | P2 | placeholder 用自家品牌举例（"例如：FlareMo"，8 语言同构） | `zh-CN.ts:717` |
| 7.10 | P2 | 文案里烧死方向箭头字符（"→"/"←" 手动翻译进各语言文件，应用图标承载） | `en-US.ts:176`、`ar.ts:175` |
| 7.11 | P2 | `tasksEmptyDescription`"在这个项目下新建第一个任务"在"全部任务"视图（projects>0 且无任务）也会出现，语境错位 | `zh-CN.ts:696`、`projects-page.tsx:299-310` |
| 7.12 | P2 | 乐观更新不对称：卡片操作有乐观补丁+回滚，对话框编辑走纯 invalidate；乐观 patch 不补 `completed_at` | `projects-page.tsx:622-665, 834-840` |
| 7.13 | OK | 移动端布局（aside 堆叠、三列纵向排）、RTL 镜像（chevron/返回箭头）、Field 的 label htmlFor、空/载/错态骨架与重试均合格 | — |

---

## 八、核验为"有意决策"、不算缺陷的项（避免误伤）

- **不设用量限额**：v0.12.0 起明确"Projects/Tasks 不设限（零边际成本）"，`docs/architecture-notes.md:468` 同文。残余风险仅一条：共享实例上 tasks-api 无任何频率/数量护栏，quality-backlog 也未列——可在护栏话题下顺带议。
- **不进 Memos 兼容契约**：Memos 本体无 tasks，兼容面不收 tasks 处理干净。
- **无 space/team 归属**：`docs/team-space-ux.md:54` 明确"日历/回顾/漫步暂不接 space，后续单议"，R10 也写了"tasks 为 owner 私有"。**但"后续单议"至今没有跟进条目**——团队空间叙事下"团队项目/共享任务清单"不存在，这是产品级缺口，至少该有个显式的决策条目（延期 or 立项）。
- **日历不过滤 done 任务**：测试确认是有意行为。

---

## 九、解决方案（2026-09-17 补，覆盖全部发现；同日全部实施并部署）

总原则：
- **数据基线对齐 memo**——memo 有的保底（软删、回收站、导出、限额护栏），tasks/projects 不该缺。
- **后端能力一次性接完**，不再让合同里建好的东西悬空。
- **新交互用 dnd-kit**（触屏/键盘/读屏三达），替换原生 HTML5 draggable 这类鼠标专属方案；原生 select 收口成 ui 组件。
- 每刀实施时顺手回填决策稿/CHANGELOG（文档与代码同步走）。
- 门禁按既定约定：tsc + 定向 vitest + build + dev 目检，不主动跑 e2e。

### 第一刀 · 交互收口（纯前端，无迁移）

| 问题 | 方案 |
|---|---|
| 1.1 编辑任务无法换项目 | `TaskFormDialog` 改为自取 `["projects"]` 缓存（useQuery 复用，不 prop-drilling），编辑态始终渲染项目下拉；update payload 带 `project_id`（contracts `projects.ts:102` 已支持）。`projects={[]}` 死参数随之删除 |
| 1.2 删除已选项目的幽灵筛选 | `deleteMutation.onSuccess` 时若删的是 `selected` 则 `setSelected(ALL_TASKS)`；另加兜底 effect：`selected` 不在 `projectById` 且非 ALL 时自动回退，防 archive 之外的新路径复发 |
| 1.3 看板零排序 | 引入 `@dnd-kit/core` + `sortable`：列内拖拽调 `reorderTasks`，跨列 = `updateTask({status})` + 两列各调一次 reorder（后端 batch 化见 4.5）。dnd-kit 触屏/键盘/读屏开箱可用，顺带解决 7.6 的看板一半 |
| 1.4+1.5 头部双按钮与死路 | 两颗按钮**合并进 SubpageHeader actions 一行**：「新建项目」primary +「新建任务」outline secondary，任务区标题行撤按钮——堆叠消失；0 项目时「新建任务」隐藏（若采纳 D1 可无项目建任务，则始终显示，见下） |
| 1.6 空态无 CTA | Empty 内补主按钮「新建项目」（对齐 daily-review 页的 rigor），D1 采纳后加次链接「直接建任务」 |
| 1.7 done 推进回环 | 保持 done→todo 的"重开"语义但讲清楚：点击文案/aria 按 `todo→开始`、`in_progress→完成`、`done→重新打开` 动态化（3 个新 key），toast 带 Undo（复用现有乐观快照回滚） |
| 1.9 projectId 不重置 | reset 列表补 `setProjectId(defaultProjectId ?? "")`，不再依赖 `key={selected}` 重挂载兜底 |
| 7.1 a11y 无名按钮 | 推进按钮加动态 `aria-label`（与 1.7 同三个 key） |
| 7.2 触屏隐形菜单按钮 | `@media (pointer: coarse)` 下 More 按钮常显（`opacity-100`），fine pointer 保持 hover 渐显；键盘 `focus-visible` 已有保留 |
| 7.3 select 三处手搓 | 新建 `components/ui/select.tsx`（native select + 统一 token，与 input 同视觉），projects 页 3 处、memory 页 3 处、capture 页 1 处全部替换 |
| 7.11 tasksEmpty 语境错位 | 空态文案按 `selectedProject` 有无分支：项目视图用现文案，「全部任务」视图用"还没有任务，建一个？"式新 key |
| 7.12 乐观更新不对称 | 对话框保存路径补乐观 patch（复用 `patchTasksCache`）；乐观 patch 一并补 `completed_at`（status→done 时置 now，回滚时还原） |

### 第二刀 · 数据安全对齐（含迁移，后端为主）

| 问题 | 方案 |
|---|---|
| 3.1 无回收站、删项目级联硬销 | 软删对齐 memo：projects/tasks 加 nullable `deleted_at`；全部读路径（projects 列表、tasks 列表、`calendar-view.ts`、`review.ts:377`、`index.ts:462` 逾期聚合、`countTasksByProjects`）统一加 `isNull(deletedAt)`；删除 = 写 `deleted_at`（project 删除 = 项目与其全部任务一起打标，**不再物理 cascade**）；复用 memo trash purge cron 做 30 天硬清；UI 在 /projects 侧栏加「回收站」折叠区（归档区同款交互），支持恢复。activity 表 FK 保持 cascade 不动——软删期间 trail 仍在，硬清时随行销毁 |
| 3.2 导出不含任务 | `import-export.ts` 纳入 projects / tasks / task_activity 三表，bundle version 3→4，导入复用 memory 的 id remap 机制 |
| 3.3+3.4 审计尾巴 | 删掉 `"deleted"` 死枚举（`contracts/projects.ts:15`）；`packages/db/src/schema/tasks.ts:86-91` 注释改为"trail 与任务同生命周期"；reorder 的 `task_id=null` 行保留不删（未来 activity 读路径的地基），不新建读端点（克制） |
| 4.1 due_at 不校验 | contract 收紧为 `regex ^\d{4}-\d{2}-\d{2}$`（产品语义 = 日期粒度，与 UI `type="date"` 输出一致）；实施前跑一次存量扫描（唯一写入口是 date input，预计脏数据为 0）；PAT/agent 文档同步注明格式 |
| 4.2 日历 `to` 边界 | `lte(tasks.dueAt, to)` 改 `lt(tasks.dueAt, nextDay(to))`（`lib/calendar-date.ts` 已有日运算 helper），并补"带时间值也不漏"的回归测试（防御性，虽 4.1 收紧后理论上不再出现） |
| 4.3 两套"一天" | 采纳 date-only 规范后**自动消解**：notes 是"时刻分桶"所以需要 tz 偏移，tasks 是"本地日语义"所以不需要——在 `calendar-view.ts` 补注释写明这个不对称是语义差异而非 bug，防后人再报 |
| 4.4 无分页、过滤薄 | 对齐 memos 的 `page_size`/`page_token` 游标模式（游标 = 排序键 + id）；tasks 补 `priority`、`due_from/due_to` 过滤，projects 列表补 `query` 名称过滤；`api.ts` 同步接线 |
| 4.5 reorder 无护栏 | `task_ids` 加 `.max(200)`；改 D1 batch 单事务替代逐行 UPDATE；混入非本项目/他人 id → 400 ValidationError（不再静默忽略） |
| 4.6 strip 三处重复 | 全部改用共享 `parseResourceName`（`ids.ts:15-23` 本就支持），删三份手写实现 |
| 4.7 PAT 前缀入库 | 维持现状（前缀片段非完整 token，风险可忽略），本条留档即结 |
| 写路径护栏 | tasks/projects 写路由套用现有 `rate-limit.ts` per-user 限制（与 memos 写路径同级），堵住共享实例无限建行的口子 |
| 5.1–5.3 测试补齐 | 新建 `tasks-api.test.ts`（HTTP 层：reorder、activity、unarchive、422/400 负例、未知 project_id 404）；跨用户隔离套件（双用户 fixture：用他人 project 建任务、读他人 task/project、reorder 混入他人 id）；边界值（name 200/201、重复 id、非法 due_at、日历带时间边界） |

### 第三刀 · 能力消化与一致性（前后端配合）

| 问题 | 方案 |
|---|---|
| 7.4 双缓存不同步 | `invalidate()` 补 `{ queryKey: ["calendar"] }` 前缀失效，日历 30 秒旧数据窗口消失 |
| 7.5 对话框重挂载丢输入 | 编辑对话框 key 收窄为 `task.id`（去掉 7 字段 key）；状态 seed 改为 `onOpenChange(true)` 时重置——agent 并发更新 refetch 不再炸掉用户正在输入的内容 |
| 2.3 无 due 任务隐形 | agenda 顶部加「未排期」折叠分组（复用现有分组样式），月历不塞（克制）；/projects 页维持为无 due 任务的主场 |
| 2.4 消费点浅 | `task_overdue` 通知深链改 `/calendar?date=<dueAt>`（聚焦当日 DayPanel）；mini 日历 `overdueCount` 包 Link 指向同一目标；workspace-search 纳入 task title/notes（复用现有 search 框架加一类 provider）。每日回顾不加任务（DayPanel 已可达，克制） |
| 1.8 批量操作 | 暂缓，记录触发条件：单用户任务数破百或用户提出；预留方案 = 卡片多选 + 底部操作条 |

### 第四刀 · 叙事补课与 i18n 清理（文档为主）

| 问题 | 方案 |
|---|---|
| 6.1 README 零提及 | Key Features 补「Projects & Tasks」「Calendar」两条，8 语言同步走现有翻译流程；`README.md:48` 的 "project context" 改为 "memory scopes"，消除与 Projects 功能的同名歧义 |
| 6.2 CHANGELOG 空白 | 下个发版条目补记两波功能（projects/tasks 基座 + R10 日历 + 逾期推送），一次清账 |
| 6.3 R10 未收口 | `product-requirements.md` R10 补状态行 ✅；"不做提醒推送"回填为"v0.20.x 已加逾期提醒与 Web Push（dabc1e8/e433a1b），范围修正" |
| 6.4 官网卖点零提及 | `apps/site/src/content/copy.ts` 补一条任务/日历卖点（与 README 同批 8 语言） |
| 6.5 对外通道 | `/api/app/projects|tasks` 补进 architecture-notes 的 API 面一节；MCP 暴露任务工具**列为 D4 的后续项**（等任务归属语义稳定再定契约，避免返工），本轮不做 |
| 7.7–7.10 i18n 清理 | 删死键 `calendar.viewAgendaJump`；合并 `today`/`todayMini`；ja `projects.field.notes` 「メモ」→「備考」；placeholder 换真实示例（"例如：网站改版"）；文案里的 →/← 箭头字符改 `ArrowRightIcon`（rtl 自动镜像） |
| 2.6 定名（D3） | 统一「任务」为主词：日历页的「日程」类 key 值改为任务措辞（key 名不动，纯值替换 8 语言），"排上日程/日程表"保留为动词性/容器性描述。理由：同一实体一个名字，日历页本质在排 tasks |

### 第五刀 · 产品级决策（方案已给，三处需要你点头）

**D1 · 任务可无项目（解 1.4 / 2.5 的根）**——推荐做：`tasks.project_id` 改 nullable（SQLite 去 NOT NULL 需表重建，tasks 行数小，锁窗可忽略，与 3.1 软删同批迁移）。收益：不依赖项目的任务成立、日历快速添加的"静默建默认项目"hack（`calendar-page.tsx:344-356`）整个删除、「全部任务」板面显示"未分配"徽标。次选（不迁移）：维持强制项目 + 0 项目时隐藏按钮，但 2.5 的隐式建项目仍脏。

**D2 · 两套待办的桥接（解 2.1 / 2.2）**——推荐**单向升级，不做双向同步**（双向同步是两源真相的地狱，业界共识不做）：
1. memo 渲染时 checkbox 可勾选：读视图直接改 markdown 对应行 → `updateMemo`，乐观更新。**与 TipTap WYSIWYG 分支（`docs/composer-editor-wysiwyg.md`，feat/composer-wysiwyg 已实现 TaskList）合并落地**，编辑态用 TipTap task list，读视图同步支持点击，避免两套实现。
2. memo 待办条目加「转为任务」：创建 task（title = 条目文本，due_at 可空，新加 nullable `source_memo_id` 关联回链，不加 FK 约束防 memo 硬删后悬挂——读时校验）。
3. 完成任务**不**回写 memo checkbox（单向）；日历上"笔记待办"计数与"任务"并排展示但文案区分。
若你倾向更克制：也可只做第 1 步（checkbox 可勾）+ 明确文案宣布两套系统并存，第 2 步挂起。

**D4 · space 归属去向（解第八节悬置项）**——推荐维持个人私有（与"个人日历"定位一致），在 `product-requirements.md` 补一条显式决策记录："团队共享任务清单列为远期候选；触发条件 = 团队实例用户提出"，`team-space-ux.md:54` 的"后续单议"指向该条。不立项、不加表结构。

### 实施顺序与依赖

```
第一刀（纯前端）          ──────────────► 可独立先行，随时可开工
第二刀（迁移 0019：软删 + nullable + 导出 v4 + 校验）
        ├─► D1 nullable 与 3.1 软删同批迁移，迁移前需 D1 拍板
        └─► 第三刀的 reorder batch（4.5）依赖本刀合入
第三刀（dnd-kit 看板、缓存失效、深链、未排期分组）── 依赖 4.5 与 D1
第四刀（叙事 + i18n）     ──────────────► 随第三刀收尾一起滚 kosx
第五刀（D1/D2/D4）        ──────────────► D1 在第二刀开工前拍板即可；D2/D4 各自独立
```

### 覆盖核对

| 问题 | 归属刀 | 问题 | 归属刀 |
|---|---|---|---|
| 1.1–1.7, 1.9 | 一 | 4.5–4.7, 5.1–5.3 | 二 |
| 1.8 | 三（暂缓，触发条件在案） | 6.1–6.5 | 四 |
| 2.1, 2.2 | 五（D2） | 7.1–7.3, 7.5, 7.11, 7.12 | 一 |
| 2.3, 2.4 | 三 | 7.4, 7.6 | 三 |
| 2.5 | 五（D1）+ 一（空态） | 7.7–7.10 | 四 |
| 2.6 | 五（D3） | 3.1–3.4 | 二 |
| 3.5, 4.8, 7.13, 第八节 OK 项 | 无需动作（现状合格） | 4.1–4.4 | 二（4.3 部分自动消解） |

## 实施记录（2026-09-17）

| 内容 | 提交 |
|---|---|
| 第二刀 · 数据安全：迁移 0025（实际编号；软删 `deleted_at`、`project_id` 可空、`source_memo_id`）、回收站 TTL 清扫、游标分页与过滤、reorder 批事务、日历与回顾读路径过滤软删 | `410e082` |
| 第二刀 · worker 接线：DELETE 改软删、restore 端点、写路径 rate-limit、HTTP 层与跨用户隔离测试 | `575cd6b` |
| 3.2 · 自助导出纳入 projects / tasks / task_activity（bundle v3→v4） | `2cf65a8` |
| 第一/三刀 · 前端交互收口 + D2/D3：dnd-kit 看板、编辑换项目、回收站 UI、未排期分组、缓存失效与深链、乐观补丁、ui/select 收口；记录待办可勾选 + 「转为任务」全链路（`source_memo_id` 回链）；命名统一「任务」（8 语言） | `66344d4` |
| 第四刀 · 叙事补课：README 9 语言、CHANGELOG 清账、R10 收口、D4 决策记录、官网卖点 | `4d10175` |
| 收尾 · 双 task 工具库收敛（`lib/task-list` 并入 `lib/memo-tasks`，修 checkbox 双触发） | `bf7dad9` |

- 全部合入 main 并推送；同日部署企业实例 KOSX（迁移 0025 已上 D1）。
- 暂缓项维持：1.8 批量操作（触发条件在案）、MCP 任务工具（D4 远期候选）、space 归属（D4 维持个人私有）。
