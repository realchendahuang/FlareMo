# UX 差异化决策稿：在熟悉的骨架上做得更精细

> 2026-09-17 · 状态：P0–P3 全部实施完毕，已合 main 并部署（`bf7dad9`，kosx 已滚） · 验收：biome / tsc / vitest 122 绿 / pnpm build 通过

## 背景与结论

用户观察：FlareMo 与 flomo 的界面对比（flomo 官网展示 vs 本仓真机截图）相似度过高，第一印象是"flomo 平替"，盖住了团队/语义/语音/自部署四张独有牌。

**定调（Kim 2026-09-17）**：不避讳 UI 相似——卡片流 + composer + 标签的品类骨架保留；也不为了"不像"牺牲好用的形式。方向是：**文案层面去掉与 flomo 撞车的词，体验层面把每个相似元素做得比它更精细、更人性化**。

## 一、相似度盘点

| 界面元素 | flomo | FlareMo 现状 | 判断 |
|---|---|---|---|
| 左栏统计三格 | MEMO / 标签 / 天数 | 记录 / 标签 / 天 | 换维度（P3） |
| 热力图 | 绿色格子墙（签名元素） | 84 天 7 行橙色格子墙 | 保留，补交互（P3） |
| 每日回顾 | PRO 功能，同名 | N 年前的今天 + 推送 | 机制不同，**改名** |
| 随机漫步 | PRO 功能，纯随机抽卡 | 图谱游走 + 路径徽章 + 明信片 | 实现已领先，**改名** |
| composer placeholder | "此刻在想什么？" | "此刻在想什么？记下来…" | **改文案** |
| 标签树 / #tag chip / 卡片流 | 有 | 有 | 品类惯例，保留 |
| composer # 补全 | 有 | 无（只插入 `#` 字符） | **补齐并做好** |
| 语义搜索 / 语音 / 日历 / 团队空间 | 无 | 有 | 独有牌，打进高频路径 |

品牌面核查：全语言包无「浮墨/MEMO/贴心提示」痕迹，问题集中在个别 key。

## 二、文案去撞名（P0，8 语言同步）

| key | 现（zh-CN） | 改为（zh-CN） | en-US |
|---|---|---|---|
| `nav.dailyReview` | 每日回顾 | 往年今日 | On this day |
| `nav.randomWalk` | 随机漫步 | 记忆漫游 | Wander |
| `review.postcardTitle` | 漫步明信片 | 漫游明信片 | Wander postcard |
| `composer.placeholder` | 此刻在想什么？记下来… | 写点什么，留给以后的自己 | Write something for your future self |

其余 6 语言按 en-US 语义本地化。推送通知文案若引用旧名一并联动。语言包：`apps/web/src/i18n/messages/*`。

## 三、体验分期

### P1 · Composer 打磨（本批实施）

1. **`#` 标签自动补全**：输入 `#` 或 tag 词中段时弹出补全下拉（来源 `getMemoStats().tags`，含条数），Enter/点击选中补全，Esc/失焦关闭，方向键导航。这是日常输入最高频的缺失项。
   —— 已实施：`lib/tag-autocomplete.ts`（token 提取 + 候选过滤，带单测）+ composer 内嵌候选面板（↑↓ 导航、Enter/Tab 选中、Esc 关闭、IME 安全、点击 # 按钮直接弹候选）。
2. **语音入口进 composer**：工具条加麦克风按钮，点击展开紧凑录音面板（复用 `lib/audio-capture`），录完转写文本插入草稿光标处；独立的 `/capture` 录音页已在 v0.24.0 删除，语音只走这一个入口。
   —— 已实施：composer 工具条麦克风按钮（仅实例配置了 ASR 时显示），紧凑录音面板（计时 + 实时 partial + 停止并插入/取消），停止后最终句子经 `joinFinalSentences` 追加进草稿；录音中发送按钮禁用。
3. **任务/日程入口**：清单按钮插入 `- [ ]`；记录里的待办可「转为任务」，任务带日期即上日历。
   —— 已实施（收口）：composer 清单按钮插入 `- [ ] `；卡片 checkbox 对编辑者可点（`lib/memo-tasks.ts` 定位源行改写，走 memo 更新的乐观更新链，点击即时回显）；任务行（对编辑者）悬停出现「转为任务」入口，点击建任务并以 `source_memo_id` 回链原记录（任务卡显示来源入口）。对应关系按 D2 定稿：**勾选 ≠ 建任务**——勾选只改正文，只有显式转化才产生任务；任务侧不回写正文。决策与实施记录见 `projects-tasks-audit.md`（D2）与 [docs/concept-model.md](./concept-model.md)。

### P2 · 卡片与回顾的人性化（已实施）

4. 时间线顶部插入「往年今日」特殊卡（有则显示），回顾从"要去的地方"变成"会遇见的惊喜"。
   —— 已实施：复用 daily-review 查询缓存（与回顾页同 key），无筛选的时间线顶部渲染 `review.onThisDayBanner` 横条，整卡可点直达 `/review/daily`。
5. 音频卡 footer 内联 mini 播放条（复用 `reading-audio-bar`）。
   —— **核查后无需实施**：`AttachmentGallery` 本来就在卡片内联渲染 `<audio controls>`，音频卡可直接播放，此前盘点有误。
6. 关键词搜索无结果时主动提示并一键切换语义搜索。
   —— 已实施：关键词搜索空结果且实例支持语义搜索时，时间线顶部出现提示条 + 一键切换按钮。

### P3 · 统计区换自己的表达（已实施）

7. 第三格「天」→「连续 N 天」streak（激励导向），可与语音分钟数轮换。
   —— 已实施：第三格改为 `currentStreak()`（今天未写不断签，昨天及之前断档才清零）；`explorer.days` key 全语言删除，新增 `explorer.streak`。语音分钟数轮换暂不做。
8. 热力图可交互：hover 显示当日条数，点击跳当天。
   —— 已实施：hover tooltip 原有保留；格子升级为按钮，点击以 `after:D before:D+1` 日过滤直达当天时间线（顺带清 tag/untagged 筛选）。

## 验收标准

- UI 验收 = `tsc` + 定向 vitest + `pnpm build` + dev 目检（不跑 Playwright，不跑全量 verify）
- 8 语言 key 全部齐备（TranslationKey 类型强制对齐会兜底）
- 阿语 RTL 下补全下拉与录音面板不破版

## 红线

- 主检出 `/Users/kim/code/fm/FlareMo` 有并行会话未提交改动（audio-capture / capture 页），worktree 内**尽量不动这些文件**；确需改动时先在本文档登记，收口时人工合并
- 不引入 flomo 词汇（同「文案卫生标准」：不出现竞品功能词表）
