# FlareMo 设计系统（Ember 2）

**产品设计原则：简约不简单，克制不放肆。**

FlareMo 的视觉语言叫 Ember：界面保持安静，暖调中性色承担约 90% 的表面，品牌火焰色只出现在关键动作和状态上。克制是高级感的主要来源。

Ember 2（2026-10）在此基础上收紧了三件事：**墨色是默认、火焰色是强调**（默认按钮、激活的筛选 chip 用墨色，每屏唯一的主 CTA 才用火焰色）；**纸张层级代替彩色高亮**（侧栏/设置的激活项是一张浮起的纸片：卡片底 + 发丝环 + xs 阴影，图标染火焰色，不再整行铺品牌浅底）；**更精确的形状**（圆角整体收小，控件 10px、卡片 14px、弹窗 18px）。

Ember 3（2026-10-31）把这套规则落到基础层，让组件不必各自记住：

- **`accent` 是中性色**：菜单焦点、命令面板选中、行 hover、空状态图标底都用它（暖灰，不再是品牌浅底）。需要品牌暗示的地方直接用 `primary/10` 一类的 tint，并且只用在小面积状态上。
- **页面标题图标是墨色**：`WorkspacePageHeader` 会把传入的图标统一染成 `muted-foreground`。位置由侧栏激活行的火焰色图标表达，标题不再重复。
- **热力图数字保持墨色**：活跃度只由底色深浅表达，只有最高一档是实色加 `primary-foreground`。
- **空状态图标是一张小纸片**：`EmptyMedia variant="icon"` 为 40px、`rounded-xl`、卡片底、发丝环、`shadow-sm`，图标 18px 墨灰。页面不要再覆盖它的底色（错误态的 destructive tint 除外）。
- **键帽统一用 `Kbd`**（`components/ui/kbd.tsx`），不要手写 `<kbd>` 样式。
- **页头搜索框统一用 `HEADER_SEARCH_FIELD_CLASS`**（`components/search-field-styles.ts`）。
- **发送按钮统一用 `SendButton`**（`components/composer/send-button.tsx`），时间线、全屏书写、记忆三处一致：没内容时是灰色圆盘，有内容时点亮渐变。
- **中英混排**：`html` 开启 `text-autospace: normal` 与 `text-spacing-trim: normal`，汉字与拉丁字母、数字之间自动留出细空（作者手打的空格不会叠加），行首全角标点自动挤压。不支持的浏览器保持原样。

## 产品结构（Ember 3 同期定案）

- **搜索只有一个入口**：⌘K 命令面板。宽屏页头是一个输入框形状的按钮，窄屏是放大镜图标，两者打开同一个面板；已生效的查询显示在输入框里（窄屏图标上有一个小圆点），并由时间线上方的筛选条承担清除。时间线里不再放第二个搜索框。
- **文章只从「文章」页开始写**。输入框的全屏按钮（`composer.longform`，「全屏书写」）打开的是同一条记录的全屏版本，没有标题栏，也不提供「转成文章」。
- **侧栏决定「去哪」，页头决定「看哪些」**。侧栏是页面：记录、回顾、记忆、待办、文章，以及沉在底部的归档、回收站（它们是去处，不是时间线的筛选）。页头左侧是页面标题，右侧只放缩小当前列表的条件：空间筛选（`ScopeSwitcher`，只在有共享团队时出现，选项为全部空间 / 个人空间 / 团队空间，可与归档、回收站组合）和搜索。新增入口先按这条判断放哪边：长期存在、会「去」的放侧栏；临时缩小当前列表、用完即清的放页头。

## 色彩

所有 token 定义在 `apps/web/src/index.css`，用 oklch 书写，`.dark` 类切换暗色。

- 品牌色阶 `--flame-50` ~ `--flame-700` + `--flame-coral`(Tailwind 类 `flame-*`)。`--flame-500` 是亮色模式主行动色（白底对比度达标），暗色模式用 `--flame-400`。
- 中性色带暖调（hue 60–80，小 chroma)，不要用纯灰。
- 语义色：`primary` / `secondary` / `muted` / `accent` / `destructive` / `success` / `warning` / `info` 及各自的 `-foreground`。
- 状态色有两种文字 token：`-foreground` 只用于**实心底**上的文字（暗色下是深色）；**浅色底（10% 左右 tint）**上的文字用 `success-emphasis` / `warning-emphasis` / `info-emphasis`，两套主题都保证可读。提示条用 `Alert` 的 `warning` / `success` / `info` / `destructive` 变体，状态徽标用 `Badge` 的 `success` / `warning` / `info` 变体；不要再手写 `amber-*` / `emerald-*` / `blue-*` 等原始色板类。原始色板只允许出现在纯装饰处（头像哈希配色、外观设置的主题预览色块）。
- 品牌渐变 `--gradient-brand`(Tailwind 类 `bg-brand-gradient`）只允许出现在：logo、composer 发送按钮（`Button variant="gradient"`）、置顶记录的内嵌指示条、认证页品牌区的短横线。其余主 CTA 一律用实色 `brand`。
- hover 用暖调 `muted`；`accent` 在 Ember 3 已是中性色（见上），可以放心用于 hover 与选中。

## 纸张质感（Paper）

整个产品是一叠纸：

- **纸色**：亮色背景是奶白纸（`--background` hue 82、chroma 0.0075），卡片是略亮的米白而非纯白；暗色是「台灯下的纸」，表面保持暖调（hue 70），不走中性灰。
- **纸纹**：`--paper-grain` 是一张内联 SVG 分形噪声贴图（约 400 字节，无网络请求），亮色约 6% 暖墨、暗色约 3.5% 亮斑。`body` 全局铺一层；纸面元素加 `.paper` 再铺一层并得到「受光的顶边」（`--paper-edge`，通过 Tailwind 的 `--tw-inset-shadow` 槽位叠加，不会吃掉 ring 和投影）。
- **哪些是纸**：记录卡、composer、`Card`、设置分组、侧栏统计卡与日历画布。浮层（Dialog、菜单、Toast）是玻璃，不加纸纹。
- **图标笔画**：lucide 默认 2px 全局降为 1.75px（只覆盖默认值，显式 `strokeWidth` 仍生效），与 Geist 在 UI 字号下的笔画重量一致。

### 公开阅读页（分享 / 文章）

`/share/:token` 与 `/article/:slug` 是 Worker 渲染的零 JS 文档，样式统一在 `apps/worker/src/routes/paper-page-styles.ts`：

- 一张带纸纹的纸放在稍深的「书桌」上，下面压着一张微微旋转的纸（窄屏隐藏）。
- 正文用衬线：拉丁 Iowan Old Style / Palatino / Georgia，汉字按 `<html lang>` 选宋体 / 明朝 / 明朝体韩文，17px / 1.9。
- 唯一的颜色是一枚火焰色「印章」圆点（刊头）和链接下划线；引用是一条火焰色细线；分隔线是「· · ·」。
- 刊头是邮戳式日期 `2026 · 10 · 29`，结尾是信笺式落款 `— 作者　写于 2026年10月29日`，页脚一行「在 FlareMo 里，安静地记下想法」。
- 失效页是一张微斜的小纸条：「这张纸条已经被收回，或从未寄出。」

## 字体与排版

- 字体栈：Geist Variable + CJK 回退，**按语言域分派**——`--font-cjk` 与 `--font-cjk-serif` 在 `:root` / `:root:lang(ja)` / `:root:lang(ko)` 三处分别定义，日韩各拿自己的字形。新增 UI 文本不要绕过 `font-sans`；分享卡插件另可选 `sans` / `heading` / `serif` / `mono` 四档。
- **全站统一排版阶梯（Type Scale）**：
  - **Display / 统计大数**：`text-2xl leading-none font-semibold tabular-nums`
  - **页面大标题 (H1)**：`text-lg sm:text-xl font-semibold tracking-tight`。例外：`WorkspacePageHeader` 是 h-14 吸顶工具栏，标题保持 `text-sm sm:text-base`，与工具栏控件同一视觉重量。
  - **弹窗/区域大标题 (H2)**：`text-base font-semibold tracking-tight`
  - **分组标签 (H3/Label)**：`text-xs font-medium text-muted-foreground`（去除全大写与非拉丁宽字距）
  - **侧边栏与设置导航项**：`h-8 rounded-lg px-2.5 text-[13.5px]`，图标 `size-4` 且为 `text-muted-foreground`；未激活 `text-foreground/70 hover:bg-muted/70`；激活为纸片：`bg-card shadow-xs ring-1 ring-border/70 font-medium`，图标转 `text-primary`（暗色用 `bg-muted`）。主侧栏（`NAV_ITEM`/`NAV_ACTIVE`）、标签树、设置侧栏共用这一套，严禁实心大橙块或五彩图标徽章。
  - **正文与描述**：笔记正文 15px / leading-7(`.memo-markdown` 已固化）；UI 说明文案 `text-sm leading-relaxed`。
  - **辅助信息/时间戳/徽标**：`text-xs`，严禁低于 12px 的翻译文本。
- **字号下限：12px（`text-xs`）用于一切会被翻译的文案。** 10px/11px 只允许承载纯数字、计数徽标与键盘符号（`<kbd>` 里的 `↑↓` / `↵` / `esc`）——汉字在 12px 以下笔画开始粘连，而中文是主力语言，这条是硬线（`typography.test.ts` 会扫源码拦截）。
- **字距**：`tracking-tight` 只对拉丁语系成立。汉字字面几乎占满 em 框、两侧留白极小，负字距会让笔画多的字粘连；因此 `[dir="rtl"]` 与 `:lang(zh/ja/ko)` 各有一条归零规则。**这两条必须写在 `@layer base` 之外**——它们要覆盖 `@layer utilities` 里的 `.tracking-*`，而 CSS 分层规则中后声明的层永远胜过前一层、与特异性无关，写在 base 里会被工具类无声盖掉（历史上这两条都因此失效过，测试已加回归守卫）。

## 形状与层级

- 圆角基准 `--radius: 0.625rem`（Ember 2 从 0.875 收紧），阶梯按倍数推导：`md` 8px（sm/xs 按钮、菜单项、日历格）、`lg` 10px（按钮、输入框、下拉）、`xl` 14px（卡片、记录卡、设置分组）、`2xl` 18px（Dialog、AlertDialog）；筛选 chip 全圆角，标签 chip 用 `rounded-md`。
- 层级规则：页面 `bg-background` → 卡片 `bg-card + shadow-xs` → 浮层 `bg-popover + shadow-lg`（DropdownMenu、AlertDialog、composer 建议列表、Spotlight 统一 `shadow-lg` + 发丝线）。`shadow-2xs` / `shadow-xl` / `shadow-2xl` 已在 `@theme` 中别名到暖调阶梯（2xs→xs，xl/2xl→lg），暗色下同样归零；不要再引入 Tailwind 默认的冷黑阴影。亮色模式用暖调阴影（`--shadow-xs/sm/md/lg`)；暗色模式不用阴影表达层级——`.dark` 的 shadow token 置近零，靠表面明度阶梯（实测值 0.155 / 0.21 / 0.235）+ 发丝线区分层级。
- 分隔用发丝线 `border-border/60`，不要用粗重边框。

## 动效

token:`animate-rise`(200ms expo 入场）、`animate-fade`(140ms)、`animate-scale-in`(140ms spring，小元素）、`animate-shimmer`（骨架屏）。

时长只有三档（`:root` 的 `--duration-fast` 120ms / `--duration-overlay` 160ms / `--duration-surface` 220ms）：交互反馈、浮层（菜单、tooltip）、表面（弹窗、抽屉、页面入场）。浮层入场统一为淡入加缩放到 97%（`zoom-in-97`），位移 4px（`slide-in-from-*-1`）；全屏书写画布用 98%。不要再用 shadcn 默认的 95% 与 8px，那个幅度在小菜单上显得发飘。

规则：

- 只动 `transform` 和 `opacity`；交互反馈 ≤140ms，入场 ≤320ms。
- 列表入场用 stagger（每张卡延迟 `index * 35ms`，上限 8 张，见 `MemoCard` 的 `index` prop)。
- hover 位移不超过 2px；按钮按压用已有的 `active:translate-y-px`。
- 全局 reduced-motion 兜底为准（`index.css` 的 `prefers-reduced-motion: reduce` 块关停全部动画/过渡）；新增大型编排动画仍需显式 `motion-safe:` 前缀，零散 transition 不必逐处加前缀。
- 不要在组件里写内联 `animate-[...]` 魔法字符串，统一用上面的 token。

## 组件约定

- **Button 变体**：`default` 墨色实底（通用主操作）；`brand` 火焰色实底 + 顶部内高光（每屏唯一的主 CTA，如登录、保存记录）；`gradient` 仅 composer 发送；`outline` 卡片底 + 输入框描边；`ghost` / `secondary` / `destructive` / `link`。
- **统一焦点环**：所有控件 `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25`（输入类用 `/20`），禁用统一 `opacity-45` + `pointer-events-none`。
- **输入类**（Input / Textarea / Select / InputGroup）：`bg-card` + `border-input`（比发丝线深一级）+ `shadow-xs`，hover 描边加深。
- **FilterPill**：未激活为卡片底 + 发丝线，激活为墨色实底。
- **标签 chip**：阅读面上用 `Badge variant="tag"`（中性 muted 底），不再用品牌浅底；编辑器内的 `#tag` 输入高亮仍用品牌色。
- **记录卡**：实色卡片底 + `shadow-xs`，hover 只加深描边与阴影，不位移。
- **Composer**：纸面卡片，聚焦时只加深描边并抬高阴影（不画焦点环，写字的地方不该像表单）。底栏与正文之间一条发丝线，空闲收起时隐去。工具按钮统一 `ToolButton`：28px ghost、muted 图标、450ms 延迟 tooltip，分三组（插入 / 结构 / 采集）以竖线分隔。发送按钮空闲时是灰色圆盘，有内容时才点亮渐变，纸飞机悬停时向右上抬 1px；有内容时左侧淡入 `⌘↵` / `Ctrl ↵` 提示（在按钮外，按钮的无障碍名保持「发送」）。
- **日历热力图**：无记录的日期不铺底色；热度用 primary 的 12% / 24% / 45% / 实色四档；选中是墨色细环，今日用字重 + 下方小圆点。

- 基于 shadcn(radix-nova)+ cva，新组件先进 `apps/web/src/components/ui/`。
- `Button` 的 `brand` 变体是渐变 CTA，一屏最多一个；`Badge` 的 `flame` 变体用于标签 chip。
- 笔记编辑是就地编辑（in-place)，不要新开 Dialog；`Esc` 取消、`Cmd/Ctrl+Enter` 保存。
- 骨架屏用 `Skeleton`(shimmer)，不要用 `animate-pulse`；图表/热力图加载中用 `opacity-50` 降低存在感，不要闪烁。真实状态指示（录音中）用 `animate-partial-pulse` / `animate-signal-ring`。
- 破坏性操作必须二次确认（AlertDialog，不要用 `window.confirm`)；变更用乐观更新 + toast 反馈，按钮在 pending 期间禁用，防止重复提交。
- 查询失败统一用 `QueryErrorState`（带重试），不要手写 Empty 版错误态，也不要在失败时静默回退成空态——尤其是设置表单：加载失败时渲染默认值会让用户保存时覆盖真实配置。
- 品牌色阶只有 `50`–`700` + `coral`，没有 `800`/`900`/`950`；写了不存在的档位的类会静默失效。

## 文案

- 中文用全角标点，省略号用 `…`；英文用 sentence case。
- 产品内统一叫"记录 / note"，不要混用"笔记/便签/memo"（代码标识符除外）。官网中文文案同样遵守（"记录"而非"笔记"）。
- 空状态文案要给出下一步动作（例："在上方写下第一条记录")，不要只写"暂无内容"。
- 性能/容量宣称全站单一口径：官网延迟宣称基准为 sub-100ms；禁用"永不""终生""取之不竭""最优解"类绝对化词（对照 `docs/design-principle-rollout.md`）。

## 官网（Paper 体系）

官网 `apps/site` 运行独立于 Ember 的自建 token 体系：`signal`/`ink`/`mist`/`paper`（hex 而非 oklch，见 `apps/site/src/styles/tokens.css`）。视觉语言同源（火焰色点睛、界面安静），但不与应用共刷同一套变量。官网遵守与 Ember 等价的克制尺子（来源：`docs/design-principle-rollout.md` 第 0 节）：

- 一屏一个渐变：任何视口内品牌渐变最多 1 处 CTA + 0–1 处品牌识别元素（logo、渐变标题行）；光晕（blur-3xl 环境光）一屏最多 1 处，且不与渐变标题同屏。
- 无装饰性循环动画：无限循环只允许骨架屏 shimmer、真实状态指示（录音中、上传中）、录音波形；呼吸灯小圆点全站禁止。
- hover 光效每屏限额：cursor 聚光灯类组件单页最多 4 张卡使用，不与渐变标题同屏。
- 入场动效覆盖 ≤ 50%：单页被 Reveal/PopIn 包裹的区块过半即超标，必须留完全不动的区块。
- 数字不许浮夸：性能/容量宣称全站单一口径（见文案节）。
- 同款模板不连用：badge/heading/subtitle 三件套一页内连续复用 ≤ 2 次；一个视觉内不得有重复/相似标题。

全局 reduced-motion 兜底在 `apps/site/src/styles/tokens.css`；`AnimatedNumber` 等数字组件必须显式传 locale，避免 SSR/hydration 格式漂移。
