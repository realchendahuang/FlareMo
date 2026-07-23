# FlareMo 设计系统(Ember)

FlareMo 的视觉语言叫 Ember：界面保持安静，暖调中性色承担约 90% 的表面，品牌火焰色（橙 → 珊瑚，取自 logo 渐变）只出现在关键动作和状态上。克制是高级感的主要来源。

## 色彩

所有 token 定义在 `apps/web/src/index.css`，用 oklch 书写，`.dark` 类切换暗色。

- 品牌色阶 `--flame-50` ~ `--flame-700` + `--flame-coral`(Tailwind 类 `flame-*`)。`--flame-500` 是亮色模式主行动色（白底对比度达标），暗色模式用 `--flame-400`。
- 中性色带暖调（hue 60–80，小 chroma)，不要用纯灰。
- 语义色：`primary` / `secondary` / `muted` / `accent` / `destructive` / `success` / `warning` / `info` 及各自的 `-foreground`。
- 品牌渐变 `--gradient-brand`(Tailwind 类 `bg-brand-gradient`）只允许出现在四处：logo、主 CTA（如发送按钮）、置顶标记、选中态指示条。一屏最多一个渐变 CTA。
- 悬浮/hover 的品牌浅底用 `accent`（亮色 flame-50 / 暗色 flame 深底），不要用冷灰。

## 字体

- 字体栈：Geist Variable + CJK 回退（PingFang SC / Hiragino Sans GB / Noto Sans SC / Microsoft YaHei)。新增 UI 文本不要绕过 `font-sans`。
- 笔记正文 15px / leading-7(`.memo-markdown` 已固化）；时间戳、统计数字用 `tabular-nums`。
- 标题用 `font-semibold tracking-tight`；不要引入新字重。

## 形状与层级

- 圆角基准 `--radius: 0.75rem`：控件 8px(md)、卡片/composer 12px(xl)、浮层 14px、标签 chip 全圆角。
- 层级规则：页面 `bg-background` → 卡片 `bg-card + shadow-xs` → 浮层 `bg-popover + shadow-lg`。亮色模式用暖调阴影（`--shadow-xs/sm/md/lg`)；暗色模式不用阴影表达层级，用表面明度阶梯（0.175 / 0.215 / 0.235)。
- 分隔用发丝线 `border-border/60`，不要用粗重边框。

## 动效

token:`animate-rise`(200ms expo 入场）、`animate-fade`(140ms)、`animate-scale-in`(140ms spring，小元素）、`animate-shimmer`（骨架屏）。

规则：

- 只动 `transform` 和 `opacity`；交互反馈 ≤140ms，入场 ≤320ms。
- 列表入场用 stagger（每张卡延迟 `index * 35ms`，上限 8 张，见 `MemoCard` 的 `index` prop)。
- hover 位移不超过 2px；按钮按压用已有的 `active:translate-y-px`。
- 所有动效必须带 `motion-safe:` 前缀，尊重 `prefers-reduced-motion`。
- 不要在组件里写内联 `animate-[...]` 魔法字符串，统一用上面的 token。

## 组件约定

- 基于 shadcn(radix-nova)+ cva，新组件先进 `apps/web/src/components/ui/`。
- `Button` 的 `brand` 变体是渐变 CTA，一屏最多一个；`Badge` 的 `flame` 变体用于标签 chip。
- 笔记编辑是就地编辑（in-place)，不要新开 Dialog；`Esc` 取消、`Cmd/Ctrl+Enter` 保存。
- 骨架屏用 `Skeleton`(shimmer)，不要用 `animate-pulse`。
- 破坏性操作必须二次确认（AlertDialog)；变更用乐观更新 + toast 反馈。

## 文案

- 中文用全角标点，省略号用 `…`；英文用 sentence case。
- 产品内统一叫"记录 / note"，不要混用"笔记/便签/memo"（代码标识符除外）。
- 空状态文案要给出下一步动作（例："在上方写下第一条记录")，不要只写"暂无内容"。
