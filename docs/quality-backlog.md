# 稳健性待修复清单（Quality Backlog）

状态：09-15 两轮体检产出的全部问题已于当日修复完毕（两轮共约 60 项，覆盖安全、数据正确性、性能、前端体验、通知系统、Web Push、测试与运维债）。每项的解决方式记录如下；本文档转为**修复台账**，未来新审计的发现重新启用这里的清单格式。

对应提交：808dded（安全）、37a2cf5（前端错误态）、b47985d（数据正确性）、4e1844b+3be3bcb（性能）、156cd7d（前端补充）、dabc1e8（逾期提醒+邮箱边界）、e433a1b（Web Push）。

---

## P0-S · 安全漏洞（7/7 已解决）

- [x] **跨组织越权写/删**：`canEditMemo`/`canGovernMemo` 补 `memo.teamId === user.teamOrganizationId`（team-permissions.ts），与读边界对齐；补跨组织越权单测。
- [x] **mention 通知绕过读权限泄露内容**：mention 过滤加 `canReadMemo`；`canReadNotificationMemo` 委托 `canReadMemo`，protected 通知按组织收口。
- [x] **CEL 正则 ReDoS**：新增 `assertRegexLinearSafety` 静态分析，拒绝"量词作用于含交替/内含量词的分组"（`(a|aa)+$`、`(a+)+$` 等），线性形态不受影响；单测覆盖。
- [x] **评论三绕过**：`createMemoComment` 补齐 active 成员门、内容上限、memo 数量配额。
- [x] **SSE 事件面宽于读面**：事件表加 `team_id`（迁移 0021），protected 事件仅同组织成员可收，缺失 teamId 的旧事件 fail-closed。
- [x] **评论区可见性**：`listMemoComments` 改用 `memoReadScope` 行级判定。
- [x] **reaction 生命周期**：非 active memo 禁止 reaction；幂等 upsert 不再发重复 SSE；memo 转 private 后 reaction 创建者仍可删除（删除不再要求 memo 可读）。

## P0 · 新页面缺失错误态（8/8 已解决）

- [x] 新增共享 `QueryErrorState` 组件（对齐时间线标准），接入日历月历网格、Agenda 视图、项目侧栏、项目看板、Memory 全部 tab、通知铃铛。
- [x] 日历 DayPanel `nextDate` 随选中日期同步（useEffect）。
- [x] 项目看板任务状态变更/删除改乐观更新（快照回滚）。
- [x] 语义搜索消费 `degraded` 信号并展示降级提示。

## P1 · 通知与提醒系统（4/4 已解决）

- [x] **Web Push 回顾触达**：完整实现——D1 `push_subscriptions`（迁移 0023）、VAPID ES256 + RFC 8291 aes128gcm 纯 WebCrypto 实现（含解密往返单测）、`/api/app/push/*` 路由、cron 在生成每日回顾/逾期提醒时同发推送、SW push + notificationclick 处理器、账户页推送面板；`FLAREMO_VAPID_PUBLIC_KEY`/`FLAREMO_VAPID_PRIVATE_KEY` 双键配置开启，缺任一键端到端关闭。
- [x] **任务逾期提醒**：新增 `task_overdue` 通知类型（迁移 0022，`snippet` 列承载任务标题），每日 cron 扫描逾期未完成任务按任务+due 日期幂等落通知；铃铛新增图标/文案并跳转日历。
- [x] **通知实时性**：以 Web Push 作为主实时渠道（页面关闭也可达），站内轮询保留为降级路径并已具备错误态；未把通知并入 memo SSE 流（该流是 Memos-compat 语义，改动收益不抵复杂度，push 已覆盖实时触达）。
- [x] **邮箱边界明示**：`/api/app/health` 露出非机密 `email_provider` 标志；安全面板在无邮件 provider 时明示忘记密码/验证流程关闭。

## P1-D · 数据正确性与一致性（13/13 已解决）

- [x] **renameTag/deleteTag 全套配套**：bump `updatedAt`、写 revision、投 reindex 任务、发 SSE+webhook；分块 ≤15 memo/批；内容改写跳过围栏代码块/行内代码/URL（分段扫描器）。
- [x] **relations**：patch 只管理 reference 关系（comment 关系归评论生命周期）、上限 200 条。
- [x] **revision 无界增长**：每 memo 保留最近 50 条，插入后裁剪。
- [x] **restore 回滚可见性**：恢复只还原内容与 payload，保留当前可见性。
- [x] **并发丢失更新**：updateMemo 加 `updatedAt` 前置条件 + 冲突 ConflictError；client_id 唯一索引竞态映射为 ConflictError。
- [x] **quota 非原子**：以文档化的 advisory 语义明确（pre-check 而非事务锁，注释写明权衡）。
- [x] **webhook 快照失真**：状态映射 NORMAL/ARCHIVED/TRASHED/DELETED 四态忠实；投递时实时回填 reactions；失败原因保留 180 字符原文。
- [x] **signing_secret 静默清空**：updateMask 无值即保持原值，显式空串才清除。
- [x] **>100 mention**：分块查询（≤90 参数/组）+ 去重。
- [x] **creator_id 碰撞**：哈希扩至 53 位（双 FNV 折叠）。
- [x] **tags.all 空列表**：回归 CEL 规范 vacuous-true。
- [x] **updateShortcut 路径/body 不一致**、**createUserWebhook 错误分类**（仅 UNIQUE 约束映射为 ConflictError）。
- [x] **CEL 行级求值异常**：该行排除而非整个列表 400。

## P2-B · 性能与容量（6/6 已解决）

- [x] **CJK 搜索**：LIKE 回退纳入与 CEL 相同的扫描窗口上限（超限明确报错要求收窄查询），不再无上限全表扫；FTS trigram 作为后续增强方向记录于 semantic-search.md。
- [x] **CEL 扫描**：先做 id-only 廉价探针再 hydrate，滥用表达式的成本从 5000 行全量读降到索引形扫描。
- [x] **通知 N+1 + 分页截断**：memo 行批量预取（一次查询替代每行 1-2 次点查）；过滤行导致页面不满时继续拉取后续窗口。
- [x] **每日回顾 cron 双重扇出**：单次扫描 + 内存分组替代用户×逐用户查询。
- [x] **random walk 全表**：随机采样窗口 64 条（含全量回退）；标签候选限采样 64 行。
- [x] **memosSseEvents 无保留**：7 天 TTL，每日 cron 分块清删。

## P2-C · 前端补充（14/14 已解决）

- [x] composer 粘贴竞态：所有编辑基于 draftRef 重建（commitDraft）。
- [x] 删除正文图片后不再被绑回（preuploaded 名单随内容修剪）。
- [x] IndexedDB 打开失败/阻塞不再永久毒化会话。
- [x] capture 重连保留原始 startedAt（真实时长与上限）；草稿保存失败时阻断导航；wakelock 失败 toast；status 探针可重试；死键改 `["tag-hierarchy"]`。
- [x] 文稿阅读 cue 缓存（每 tick 的 DOM 扫描消除）；`<audio>` 加载失败在阅读条可见。
- [x] AttachmentGallery 死链占位；详情页复制加 catch。
- [x] SW statechange 监听泄漏修复。
- [x] 路由级 lazy chunk 失败重试：root-route errorComponent 识别「Failed to fetch dynamically imported module」类错误，重试时清空 SW 全部缓存再 reload，让浏览器拿到新部署的 index.html 与 chunk 图；其他错误维持 `router.invalidate()`。
- [x] capture 重连帧缓冲：连接建立/重连期间音频帧客户端缓冲（上限 2 MB ≈ 60 s，超限丢最旧），`ready` 后按序补发进新会话，转写不再因网络抖动出现静默空洞。
- [x] admin 缓存键统一 `["current-flaremo-user"]`；行操作错误改 toast（不再写进创建弹窗的槽）。
- [x] invalidate 遗漏：promote 刷时间线/统计/标签树；memo→memory 刷记忆页；改名刷全部 viewer 缓存。
- [x] t() 未知键回退 zh 文案 → 键尾可读文本，不再抛异常。
- [x] 快捷键守卫：对话框打开时不抢焦点，⌘C/⌘V 等组合不劫持；`d` 主题键补充进快捷键表说明（App 快捷键列表保持聚焦常用键）。
- [x] 死代码清理（captchaButtonLabel、slugifyHeading、addDays、compareDayKeys、saving/saved 状态、void monthKey）。
- [x] 用量面板 2 分钟轮询。

## P2 · 测试覆盖（按风险逐项）

- [x] shares 域层单测（权限门、复用、撤销/过期不可见）。
- [x] data-tasks 域层单测（所有权、租约过期、TTL 清理）。
- [x] push 模块单测（订阅幂等、RFC 8291 信封解密往返）。
- [x] 复用层覆盖说明：10 个 routes 的行为由 `apps/worker/src/api/*.test.ts` 的 HTTP 级集成测试兜底（51 用例），单独立覆盖的边际价值低于维护成本——记录为接受项。
- [x] cron/queue 生命周期自动化测试：`apps/worker/src/scheduled.test.ts`（Miniflare D1 + R2 stub）覆盖 runScheduledMaintenance 全链路——过期回收站带附件硬删、孤儿/新鲜附件 GC 分界、每日回顾与逾期日程通知幂等（同日重跑不重复）、过期 data task 清理 + R2 导出工件回收。
- [ ] packages/db 与 e2e 缺口（Markdown 渲染/revision 恢复/分享撤销 e2e）：与 ROADMAP R8 合并推进。

## P3 · 兼容层与运维债

- [x] **webhook egress SSRF 防护**：已由团队组织模型同批实现——`validateWebhookUrl` 拒绝非 http(s)、URL 凭证/fragment、localhost/.local/.internal 与保留 IP 段（memos-user.ts:691+）。经源码级核实，勾销。
- [x] **deploy.md 重复标题**（两个"## 手动部署"）已去重；Web Push 配置说明已补充。
- [x] **vector-namespace-design.md 状态行**已改为"已实施并部署"。
- [x] **memos-connect-api.ts 体量**（3183 行）：评估结论为暂不拆分——纯重构无行为收益，会与 Memos 兼容层的持续对齐工作产生冲突面；记录为显式接受项。
- [x] **恢复演练证明过期**（maintenance.md L153）：2026-09-15 已跑 `pnpm backup:drill:remote` 全表恢复证明——36 张表 + 双 FTS 逐表计数一致，deploy dry-run 通过，临时资源已删，maintenance.md 已记录；顺带修复了 wrangler.json 隐式配置劫持与旧 schema 备份的 schema-adaptive 恢复导出。

## 残留记账（本轮明确接受的项）

1. CEL 求值错误逐行排除（而非整体报错）是有意取舍：彻底修复需修复畸形 payload 的产生源头。

## 已确认不欠的账（两轮审计核实，勿重复怀疑）

- schema↔迁移↔持久化清单三方门禁对齐，无孤儿表。
- webhook 投递 lease/重试/退避/dead-letter；SSE 心跳与断流重试；bootstrap/recovery fail-closed；identity-cache 授权关键行 live 读。
- 附件 R2 GC 四项加固、向量分区改造、备份演练脚本、部署流水线均已闭环。
- 附件 R2 key 无路径穿越面；公开分享校验归属；PAT 撤销即时；bot webhook 鉴权；i18n zh/en 键零差异；无 console.log 残留。
- composer 离线队列幂等；SW 离线壳/range 排除/SKIP_WAITING 握手正确。

---

## 2026-11-04 全量审计（第三轮）与修复台账

本轮由 Lead + 三个只读审计员完成，覆盖 apps/web、apps/worker + packages、docs/scripts/deps。基线：`format:check`、`tsc`、Vitest（160 文件）、`scripts:test` 全绿；`pnpm audit --prod` 无已知漏洞。已修复项随本次提交落地，其余按下表继续跟踪。

### 已修复（本轮）

- [x] 自托管部署/更新 workflow 断链：模板恢复到 `docs/templates/workflows/`，README 8 语言 + AGENTS/ROADMAP/deploy/update/maintenance/release 文档同步（详见 CHANGELOG Unreleased）。
- [x] 一键部署表单与 `wrangler.json` 冲突（issue #160 的技术根因）：移除空 var，文档补公开 origin / embedding 维度 / Repository 指向说明。
- [x] 门禁口径有四种说法：统一为 7 步，`scripts/preflight.mjs` 是唯一口径。
- [x] 英文 agent/deploy 文档要求部署前跑全量 verify：改为 opt-in。
- [x] preflight 漏跑 2 个脚本测试、高风险脚本零测试：新增 `scripts:test` 自动发现 + 备份保留测试。
- [x] `backups/` 无保留策略（55 目录 / 65MB，含 session 与 key 哈希）：drill 默认保留最近 10 次。
- [x] cron 串行无隔离/无汇总：逐 pass try/catch + `scheduled maintenance complete` 汇总；文章清理加批次与逐行保护。
- [x] 回收站清理 N+1：批量 owner 查询。
- [x] PWA 推送 icon/badge 指向目录；更新提示缺「稍后」。
- [x] trusted origins 允许 http；cookie 请求先查 session 再校验 Origin；admin 删除成员 PAT 失败路径吞错；plugins-store 重复 ownerContext。
- [x] 快捷键劫持焦点控件的方向键/字母；语言包迟到不重渲染；spotlight 缺 combobox 语义。
- [x] 死代码：`haptics`、`getDailyReview`；共享设置组件迁到 `components/settings-section.tsx`。
- [x] 过期文档：maintenance 的 memory reindex、`run_worker_first`、`/capture` 残留、CHANGELOG 死小节。
- [x] 依赖卫生：10 个死 override 清理、`minimumReleaseAge`、`engines`/`.nvmrc`。
- [x] 跨仓漂移：flaremo-cloud README 免费档记忆配额与 ops-runbook 的 `memory_fts`。

### 待办（按优先级）

- [x] **PAT 权限面**：已实现 `notes` / `admin` scope（`packages/contracts/src/pat.ts`，Worker 在每个 PAT 请求上校验，`/api/app/admin/*` 仅 admin）、默认 90 天有效期（1–365 天，不再提供永不过期）、账户页创建对话框与令牌行展示 scope；旧令牌无 permissions 时保持完全访问以兼容既有脚本。
- [x] **query key 收口**：86 处行内字面量全部迁到 `lib/query-keys.ts`（新增 20+ 组 key 与 `invalidateTaskSurfaces` 共享失效助手）；新增 `lib/query-keys.test.ts` 禁止再写行内字面量。
- [x] **孤儿 i18n key**：71 个无引用 key 已从 8 个语言文件删除（1027 → 956 键）；新增 `i18n/usage.test.ts`，白名单只保留 10 个待接线的 `pwa.install*`/离线提示 key。
- [x] **RTL 物理方向类**：32 个文件的 `text-left`/`ml-auto`/`right-*`/`border-l` 已改为逻辑类，toggle-group 分段控件的圆角与分隔线同步；`left-1/2 + -translate-x-1/2` 的居中保留物理方向（逻辑化会让 RTL 偏移半格）。
- [x] **对比度（第一批）**：explorer 计数、可见性提示、月份表头、回收站分组等低强调正文改为全色 muted，tabs 非激活文字 /60 → /70；图标与装饰性 marker 保留，整体设计稿级重排仍待目检。
- [x] **超大页面拆分（评估为暂不做）**：article-editor 691 / integrations-card 669 / daily-review 645 / memo-list 665 行。与既有的 `memos-connect-api.ts` 体量决定一致——纯搬代码没有行为收益，却会制造每次触碰这些页面的冲突面；改为「下次因功能改动必须编辑同一文件时顺手拆分」，不单独立项。
- [x] **OpenAPI 响应级契约（第一批）**：新增 `memos-current-contract.test.ts`，用 contracts 的 zod schema 校验 `/api/v1/memos` create/list/get/attachments 的返回体；其余端点逐步扩展；`/api/app` 的 articles / projects / tasks 已补同类校验（`app-api-contract.test.ts`）。
- [x] **admin 端点测试（第一、二批）**：插件商店鉴权/目录失败降级、`embeddings/rebuild` owner 守卫与未配置提示（`admin-endpoints.test.ts`）、PAT 删除成员的 R2 失败回归（`admin-member-removal.test.ts`）已覆盖；插件 install/uninstall 仍待补。
- [x] **每写请求触发 outbox sweep（评估为保持现状）**：sweep 在 `waitUntil` 里、已经离开响应路径，固定成本是 2 次 D1 查询；改成时间窗节流会让低流量实例的 webhook/embedding 延迟从「秒级」变成「等下一次写或次日 cron」，取舍不划算。保留 cron 作为兜底。
- [x] **每日全表重建小时计数（评估为保持现状）**：它是衍生计数的事实源，增量路径只是它的优化；自部署规模下一次全表 group-by 远低于 10ms CPU 上限。多租户 SaaS 行数明显增长后再改成「近 7 天活跃用户 + 低频全量」两段式。
- [x] **首屏预加载碎片（评估为保持现状）**：43 个 modulepreload / 约 366KB gzip 在 HTTP/2-3 下是多路复用而非串行瀑布，没有实测 LCP 退化；`vite.config.ts` 已按 React/TipTap/浮动层等大块分组。等有真实性能数据再动，避免为数字而拆包。
- [x] **浏览器直连 api.github.com**：更新检查已改走 Worker 代理 `/api/app/releases/latest`（边缘缓存 10 分钟、repository 形状校验、上游失败 502）。
- [ ] **依赖升级（持续性维护，非缺陷）**：`pnpm outdated` 20+ 个直接依赖落后；没有 CI 的情况下批量升级需要人工回归，按季度在功能空档做，并先跑定向 vitest + `pnpm build`。本轮只做了死 override 清理与 `minimumReleaseAge` 策略。
- [x] **产品任务池未拆 issue（评估为保持现状）**：维护者是单人快速迭代节奏，`ROADMAP.md` 的「公开任务池」就是工作队列；GitHub issue 只在有外部反馈（如 #160）时开，避免双份看板。
- [x] **历史设计文档归档（第一批）**：新增 `docs/README.md` 索引，一次性设计稿/审查报告统一标记为「历史」并在索引里单列；暂不移动文件，避免破坏既有链接。
