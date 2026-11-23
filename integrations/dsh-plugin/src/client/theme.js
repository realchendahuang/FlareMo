/**
 * FlareMo「Ember」设计系统 —— 与网页端**同一套 token、同一套组件造型**，
 * 只是换成 DSH 插件的技术栈来实现（esbuild 单 bundle + 注入 <style> + 内联布局）。
 *
 * 来源（网页端，唯一真源）：
 *   apps/web/src/index.css        → 色彩 ramp / 圆角 / 阴影 / 纸纹 / 字体 / 动效
 *   apps/web/src/components/ui/*  → 按钮、输入框、卡片、徽标、Kbd、空状态、Alert
 *   docs/design-system.md         → 排版阶梯、墨色/火焰色的用法、纸张层级
 *
 * 三条硬规则（照抄 Ember，不许自己发挥）：
 *  1. 暖中性色承担约 90% 表面；火焰色只出现在关键动作与状态上。
 *  2. 激活/选中是「墨色」（默认按钮、选中 chip、复选框），主 CTA 才用火焰色；
 *     每屏最多一处火焰色 CTA。
 *  3. 层级靠纸色阶梯 + 发丝环 + xs 阴影，不靠粗边框和大投影；深色模式靠明度阶梯，
 *     阴影 token 归零。
 *
 * 主题不自己判断：DSH 深色时 body 带 `data-ds-dark-theme`（见 research/
 * dsh-flaremo-plugin/01-dsh-client-ui.md §2.8），这里只写对应的覆盖选择器。
 */

import geistLatinUrl from './assets/geist-latin-wght-normal.woff2'

/** 纸纹：网页端 `--paper-grain` 的两个变体（亮色暖墨 6% / 暗色亮斑 3.5%）。 */
const GRAIN_LIGHT =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .32 0 0 0 0 .25 0 0 0 0 .16 0 0 0 .06 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"

const GRAIN_DARK =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 .95 0 0 0 0 .85 0 0 0 .035 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"

/**
 * 根节点上的 token。前缀 `--fm-`，作用域只在插件面板里，绝不外泄到 DSH 自己的 UI。
 *
 * 数值逐条对应 `apps/web/src/index.css`：
 *   :root（亮色）→ 本文件第一段；`.dark`（暗色）→ `body[data-ds-dark-theme]` 覆盖段。
 * 唯一改动：变量名从 Tailwind 的语义名（--background/--card/…）换成 --fm- 前缀，
 * 避免和 DSH 自己的 token 打架。
 */
export const TOKEN_CSS = `
.dsh-flaremo-root {
  /* ── 品牌火焰色阶（Ember：只用于关键动作，不许大面积铺） ───────── */
  --fm-brand-50: oklch(0.96 0.025 52);
  --fm-brand-100: oklch(0.93 0.05 49);
  --fm-brand-200: oklch(0.87 0.09 46);
  --fm-brand-300: oklch(0.79 0.135 42);
  --fm-brand-400: oklch(0.72 0.17 40);
  --fm-brand-500: oklch(0.63 0.19 35);
  --fm-brand-600: oklch(0.55 0.2 30);
  --fm-brand-700: oklch(0.47 0.18 26);
  --fm-brand-coral: oklch(0.64 0.21 20);
  --fm-brand-gradient: linear-gradient(135deg, var(--fm-brand-400), var(--fm-brand-coral));
  --fm-brand-gradient-foreground: oklch(1 0 0);

  /* ── 纸面与墨色（暖中性，hue 60–82；不要用纯灰） ──────────────── */
  --fm-background: oklch(0.976 0.0075 82);
  --fm-foreground: oklch(0.235 0.012 65);
  --fm-card: oklch(0.996 0.003 85);
  --fm-card-foreground: oklch(0.24 0.006 75);
  --fm-popover: oklch(0.997 0.003 85);
  --fm-popover-foreground: oklch(0.24 0.006 75);
  --fm-secondary: oklch(0.952 0.007 80);
  --fm-secondary-foreground: oklch(0.28 0.006 75);
  --fm-muted: oklch(0.948 0.007 80);
  --fm-muted-foreground: oklch(0.5 0.009 75);
  /* Ember 3：accent 是中性「指针在这里」的填充，不是品牌浅底。 */
  --fm-accent: oklch(0.948 0.008 78);
  --fm-accent-foreground: var(--fm-foreground);
  --fm-destructive: oklch(0.577 0.245 27.325);
  --fm-success: oklch(0.62 0.13 155);
  --fm-success-foreground: oklch(0.98 0.01 150);
  --fm-warning: oklch(0.7 0.13 75);
  --fm-warning-foreground: oklch(0.3 0.04 70);
  --fm-info: oklch(0.58 0.1 240);
  --fm-info-foreground: oklch(0.98 0.005 240);
  /* 状态色两套文字 token：实心底用 *-foreground，浅色 tint 底用 *-emphasis。 */
  --fm-success-emphasis: oklch(0.45 0.11 155);
  --fm-warning-emphasis: oklch(0.47 0.1 65);
  --fm-info-emphasis: oklch(0.45 0.1 245);

  --fm-border: oklch(0.918 0.008 80);
  --fm-input: oklch(0.885 0.009 78);
  --fm-ring: var(--fm-brand-400);

  /* ── 主色：墨色是默认，火焰色是强调 ──────────────────────────── */
  --fm-primary: var(--fm-brand-500);
  --fm-primary-foreground: oklch(0.99 0.003 75);

  /* ── 形状（Ember 2：控件 10px、卡片 14px、弹窗 18px） ─────────── */
  --fm-radius-sm: 6px;
  --fm-radius-md: 8px;
  --fm-radius-lg: 10px;
  --fm-radius-xl: 14px;
  --fm-radius-2xl: 18px;

  /* ── 两层暖投影：贴边接触影 + 柔环境影，压得很低（纸感） ──────── */
  --fm-shadow-xs: 0 1px 2px oklch(0.3 0.02 60 / 0.045);
  --fm-shadow-sm: 0 1px 2px oklch(0.3 0.02 60 / 0.05), 0 2px 6px -2px oklch(0.3 0.02 60 / 0.06);
  --fm-shadow-md: 0 1px 2px oklch(0.3 0.02 60 / 0.05), 0 6px 16px -6px oklch(0.3 0.02 60 / 0.1);
  --fm-shadow-lg: 0 1px 3px oklch(0.3 0.02 60 / 0.06), 0 16px 40px -12px oklch(0.3 0.02 60 / 0.18);

  /* ── 纸张质感：纸纹 + 受光顶边 ───────────────────────────────── */
  --fm-grain: ${GRAIN_LIGHT};
  --fm-paper-edge: inset 0 1px 0 oklch(1 0 0 / 0.7);

  /* ── 字体：拉丁 Geist Variable（打进 bundle），汉字走系统字形 ─── */
  --fm-cjk: "PingFang SC", "Hiragino Sans GB", MiSans, "HarmonyOS Sans SC",
    "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC";
  --fm-font-ui: "Ember Geist", -apple-system, BlinkMacSystemFont, "Segoe UI",
    var(--fm-cjk), system-ui, sans-serif;
  --fm-font-heading: "Ember Geist", -apple-system, BlinkMacSystemFont, "Segoe UI",
    var(--fm-cjk), system-ui, sans-serif;
  --fm-font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas,
    var(--fm-cjk), monospace;

  /* ── 动效：一档时长阶梯 + 两条缓动曲线 ───────────────────────── */
  --fm-duration-fast: 120ms;
  --fm-duration-overlay: 160ms;
  --fm-duration-surface: 220ms;
  --fm-ease-signal: cubic-bezier(0.22, 1, 0.36, 1);
  --fm-ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --fm-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  display: flex;
  flex-direction: column;
  min-width: 0;
  color: var(--fm-foreground);
  background-color: var(--fm-background);
  background-image: var(--fm-grain);
  font-family: var(--fm-font-ui);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  font-kerning: normal;
  /* 中英混排：汉字与拉丁/数字之间自动细空、行首全角标点挤压（网页端同款）。 */
  text-autospace: normal;
  text-spacing-trim: normal;
}

/* 深色：DSH 的深色标记（body[data-ds-dark-theme]），逐条搬 .dark 块。 */
body[data-ds-dark-theme] .dsh-flaremo-root {
  --fm-background: oklch(0.158 0.006 70);
  --fm-foreground: oklch(0.95 0.008 80);
  --fm-card: oklch(0.207 0.007 70);
  --fm-card-foreground: oklch(0.955 0.003 75);
  --fm-popover: oklch(0.232 0.007 70);
  --fm-popover-foreground: oklch(0.955 0.003 75);
  --fm-secondary: oklch(0.265 0.004 75);
  --fm-secondary-foreground: oklch(0.955 0.003 75);
  --fm-muted: oklch(0.26 0.004 75);
  --fm-muted-foreground: oklch(0.68 0.008 75);
  --fm-accent: oklch(0.285 0.006 72);
  --fm-accent-foreground: var(--fm-foreground);
  --fm-destructive: oklch(0.704 0.191 22.216);
  --fm-success: oklch(0.7 0.13 155);
  --fm-success-foreground: oklch(0.16 0.03 155);
  --fm-warning: oklch(0.76 0.12 75);
  --fm-warning-foreground: oklch(0.2 0.04 70);
  --fm-info: oklch(0.7 0.1 240);
  --fm-info-foreground: oklch(0.16 0.03 240);
  --fm-success-emphasis: oklch(0.82 0.11 155);
  --fm-warning-emphasis: oklch(0.85 0.1 80);
  --fm-info-emphasis: oklch(0.82 0.09 240);
  --fm-border: oklch(1 0 0 / 9%);
  --fm-input: oklch(1 0 0 / 13%);
  --fm-primary: var(--fm-brand-400);
  --fm-primary-foreground: oklch(0.2 0.03 30);
  /* 深色不用阴影表达层级（明度阶梯 + 发丝线），token 归零。 */
  --fm-shadow-xs: 0 0 0 transparent;
  --fm-shadow-sm: 0 0 0 transparent;
  --fm-shadow-md: 0 0 0 transparent;
  --fm-shadow-lg: 0 0 0 transparent;
  --fm-grain: ${GRAIN_DARK};
  --fm-paper-edge: inset 0 1px 0 oklch(1 0 0 / 0.05);
}
`

/** 网页端字体：@fontsource-variable/geist 的 latin 子集（SIL OFL 1.1）。 */
const FONT_FACE_CSS = `
@font-face {
  font-family: "Ember Geist";
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url(${geistLatinUrl}) format("woff2");
}
`

/**
 * 组件造型。每条 recipe 都能在网页端找到对应文件，注释里标了出处，
 * 改样式前先看那边的 class 串，别凭感觉调数字。
 */
const COMPONENT_CSS = `
.dsh-flaremo-root *,
.dsh-flaremo-root *::before,
.dsh-flaremo-root *::after {
  box-sizing: border-box;
}

/* ── 按钮（apps/web/src/components/ui/button.tsx）─────────────────
 * 默认 = 墨色实底（Ember 2：默认按钮用墨色）；brand = 火焰色主 CTA；
 * outline = 卡片底的描边按钮；ghost = 文字按钮。 */
.fm-btn {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--fm-radius-lg);
  background: var(--fm-foreground);
  color: var(--fm-background);
  font: 500 14px/1 var(--fm-font-ui);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  outline: none;
  box-shadow: var(--fm-shadow-xs);
  transition:
    color var(--fm-duration-fast) var(--fm-ease-signal),
    background-color var(--fm-duration-fast) var(--fm-ease-signal),
    border-color var(--fm-duration-fast) var(--fm-ease-signal),
    box-shadow var(--fm-duration-fast) var(--fm-ease-signal),
    filter var(--fm-duration-fast) var(--fm-ease-signal);
}
.fm-btn svg { flex: none; }
.fm-btn:focus-visible {
  border-color: var(--fm-ring);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--fm-ring) 25%, transparent);
}
.fm-btn:active:not(:disabled) { transform: translateY(1px); }
.fm-btn:disabled { opacity: 0.45; pointer-events: none; }
.fm-btn[data-variant="default"]:hover {
  background: color-mix(in oklab, var(--fm-foreground) 88%, transparent);
}
.fm-btn[data-variant="brand"] {
  background: var(--fm-primary);
  color: var(--fm-primary-foreground);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.18), var(--fm-shadow-xs);
}
.fm-btn[data-variant="brand"]:hover {
  background: color-mix(in oklab, var(--fm-primary), black 7%);
}
.fm-btn[data-variant="outline"] {
  border-color: var(--fm-input);
  background: var(--fm-card);
  color: var(--fm-foreground);
  box-shadow: var(--fm-shadow-xs);
}
.fm-btn[data-variant="outline"]:hover {
  border-color: color-mix(in oklab, var(--fm-input), var(--fm-foreground) 12%);
  background: color-mix(in oklab, var(--fm-muted) 60%, transparent);
}
.fm-btn[data-variant="secondary"] {
  background: var(--fm-secondary);
  color: var(--fm-secondary-foreground);
  box-shadow: none;
}
.fm-btn[data-variant="secondary"]:hover {
  background: color-mix(in oklab, var(--fm-secondary), var(--fm-foreground) 6%);
}
.fm-btn[data-variant="ghost"] {
  background: transparent;
  color: color-mix(in oklab, var(--fm-foreground) 80%, transparent);
  box-shadow: none;
}
.fm-btn[data-variant="ghost"]:hover {
  background: var(--fm-muted);
  color: var(--fm-foreground);
}
.fm-btn[data-variant="destructive"] {
  background: color-mix(in oklab, var(--fm-destructive) 10%, transparent);
  color: var(--fm-destructive);
  box-shadow: none;
}
.fm-btn[data-variant="destructive"]:hover {
  background: color-mix(in oklab, var(--fm-destructive) 16%, transparent);
}
.fm-btn[data-size="xs"] { height: 24px; padding: 0 8px; gap: 4px; border-radius: var(--fm-radius-md); font-size: 12px; }
.fm-btn[data-size="sm"] { height: 28px; padding: 0 10px; gap: 5px; border-radius: var(--fm-radius-md); font-size: 13px; }
.fm-btn[data-size="icon"] { width: 32px; height: 32px; padding: 0; }
.fm-btn[data-size="icon-sm"] { width: 28px; height: 28px; padding: 0; border-radius: var(--fm-radius-md); }

/* ── 输入框 / 搜索框（ui/input.tsx + search-field-styles.ts）──────── */
.fm-input {
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: 4px 10px;
  border: 1px solid var(--fm-input);
  border-radius: var(--fm-radius-lg);
  background: var(--fm-card);
  color: var(--fm-foreground);
  font: 400 14px/1.4 var(--fm-font-ui);
  box-shadow: var(--fm-shadow-xs);
  outline: none;
  transition:
    border-color var(--fm-duration-fast) var(--fm-ease-signal),
    box-shadow var(--fm-duration-fast) var(--fm-ease-signal);
}
.fm-input::placeholder { color: var(--fm-muted-foreground); }
.fm-input:hover { border-color: color-mix(in oklab, var(--fm-input), var(--fm-foreground) 12%); }
.fm-input:focus-visible {
  border-color: var(--fm-ring);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--fm-ring) 20%, transparent);
}
.fm-input[data-size="search"] { font-size: 12px; }
.fm-input[data-tone="code"] {
  height: 44px;
  text-align: center;
  font-family: var(--fm-font-mono);
  font-size: 18px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
}
body[data-ds-dark-theme] .fm-input {
  background: color-mix(in oklab, var(--fm-input) 20%, transparent);
}

/* ── 纸张/卡片（ui/card.tsx）：卡片底 + 纸纹 + 受光顶边 + 发丝环 ── */
.fm-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  overflow: hidden;
  border: 1px solid color-mix(in oklab, var(--fm-foreground) 10%, transparent);
  border-radius: var(--fm-radius-xl);
  background-color: var(--fm-card);
  background-image: var(--fm-grain);
  color: var(--fm-card-foreground);
  font-size: 14px;
  line-height: 1.5;
  box-shadow: var(--fm-paper-edge), var(--fm-shadow-xs);
}
.fm-card[data-size="sm"] { gap: 12px; padding: 12px; }

/* 时间线里的记录卡：比 Card 更紧，hover 才浮现（Ember 2 的纸片层级）。 */
.fm-note {
  position: relative;
  width: 100%;
  display: block;
  padding: 12px 14px;
  border: 1px solid transparent;
  border-radius: var(--fm-radius-xl);
  background: transparent;
  color: var(--fm-foreground);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--fm-duration-fast) var(--fm-ease-signal),
    border-color var(--fm-duration-fast) var(--fm-ease-signal),
    box-shadow var(--fm-duration-fast) var(--fm-ease-signal);
}
.fm-note:hover {
  background-color: color-mix(in oklab, var(--fm-card) 70%, transparent);
  border-color: color-mix(in oklab, var(--fm-foreground) 8%, transparent);
}
.fm-note[data-active="true"] {
  background-color: var(--fm-card);
  background-image: var(--fm-grain);
  border-color: color-mix(in oklab, var(--fm-foreground) 10%, transparent);
  box-shadow: var(--fm-paper-edge), var(--fm-shadow-xs);
}
.fm-note:focus-visible {
  outline: none;
  border-color: var(--fm-ring);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--fm-ring) 20%, transparent);
}

/* 记录行外壳 + 右上角的墨色选择框（Ember：选中是墨色，不是品牌色）。 */
.fm-note-row { position: relative; }
.fm-note-check {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid var(--fm-input);
  border-radius: 5px;
  background: var(--fm-card);
  color: var(--fm-background);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity var(--fm-duration-fast) var(--fm-ease-signal),
    background-color var(--fm-duration-fast) var(--fm-ease-signal),
    border-color var(--fm-duration-fast) var(--fm-ease-signal);
}
.fm-note-row:hover .fm-note-check,
.fm-note-row:focus-within .fm-note-check,
.fm-note-check[data-selected="true"] { opacity: 1; }
.fm-note-check[data-selected="true"] {
  border-color: var(--fm-foreground);
  background: var(--fm-foreground);
  color: var(--fm-background);
}
.fm-note-check:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--fm-ring) 25%, transparent);
}

/* ── 徽标（ui/badge.tsx）：发丝环 + 8–10% tint ─────────────────── */
.fm-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  font: 500 11px/1 var(--fm-font-ui);
  white-space: nowrap;
}
.fm-badge[data-tone="neutral"] {
  border-color: color-mix(in oklab, var(--fm-foreground) 10%, transparent);
  background: var(--fm-muted);
  color: var(--fm-muted-foreground);
}
.fm-badge[data-tone="brand"] {
  border-color: color-mix(in oklab, var(--fm-primary) 22%, transparent);
  background: color-mix(in oklab, var(--fm-primary) 10%, transparent);
  color: var(--fm-primary);
}
.fm-badge[data-tone="success"] {
  border-color: color-mix(in oklab, var(--fm-success) 30%, transparent);
  background: color-mix(in oklab, var(--fm-success) 10%, transparent);
  color: var(--fm-success-emphasis);
}
.fm-badge[data-tone="warning"] {
  border-color: color-mix(in oklab, var(--fm-warning) 30%, transparent);
  background: color-mix(in oklab, var(--fm-warning) 10%, transparent);
  color: var(--fm-warning-emphasis);
}
.fm-badge[data-tone="danger"] {
  border-color: color-mix(in oklab, var(--fm-destructive) 25%, transparent);
  background: color-mix(in oklab, var(--fm-destructive) 10%, transparent);
  color: var(--fm-destructive);
}
.fm-badge[data-tone="info"] {
  border-color: color-mix(in oklab, var(--fm-info) 30%, transparent);
  background: color-mix(in oklab, var(--fm-info) 10%, transparent);
  color: var(--fm-info-emphasis);
}

/* ── 标签 chip / 筛选 pill（ui/filter-pill.tsx）─────────────────── */
.fm-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--fm-muted);
  color: var(--fm-muted-foreground);
  font: 400 11px/20px var(--fm-font-ui);
  white-space: nowrap;
}
.fm-pill {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--fm-border);
  border-radius: 999px;
  background: var(--fm-card);
  color: var(--fm-muted-foreground);
  font: 500 12px/1 var(--fm-font-ui);
  cursor: pointer;
  user-select: none;
  outline: none;
  transition:
    color var(--fm-duration-fast) var(--fm-ease-signal),
    background-color var(--fm-duration-fast) var(--fm-ease-signal),
    border-color var(--fm-duration-fast) var(--fm-ease-signal);
}
.fm-pill:hover { border-color: var(--fm-input); color: var(--fm-foreground); }
.fm-pill[data-active="true"] {
  border-color: var(--fm-foreground);
  background: var(--fm-foreground);
  color: var(--fm-background);
}
.fm-pill:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--fm-ring) 25%, transparent);
}

/* ── 键帽（ui/kbd.tsx）：18px 卡面小键，底边 1px 唇线 ──────────── */
.fm-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border: 1px solid var(--fm-border);
  border-radius: 5px;
  background: var(--fm-card);
  box-shadow: inset 0 -1px 0 var(--fm-border);
  color: var(--fm-muted-foreground);
  font: 500 11px/1 var(--fm-font-ui);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  user-select: none;
}

/* ── 空状态（ui/empty.tsx）：一张 40px 的小纸片 + 15px 标题 ─────── */
.fm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  width: 100%;
  padding: 24px;
  text-align: center;
  text-wrap: balance;
}
.fm-empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin-bottom: 8px;
  border: 1px solid color-mix(in oklab, var(--fm-border) 70%, transparent);
  border-radius: var(--fm-radius-xl);
  background: var(--fm-card);
  box-shadow: var(--fm-shadow-sm);
  color: var(--fm-muted-foreground);
}
.fm-empty-title {
  font-family: var(--fm-font-heading);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--fm-foreground);
}
.fm-empty-desc {
  font-size: 14px;
  line-height: 1.65;
  color: var(--fm-muted-foreground);
}

/* ── Alert（ui/alert.tsx）：发丝环 + 8–10% tint + *-emphasis 墨 ── */
.fm-alert {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--fm-border);
  border-radius: var(--fm-radius-lg);
  background: var(--fm-card);
  color: var(--fm-foreground);
  font-size: 14px;
  line-height: 1.55;
}
.fm-alert[data-tone="danger"] {
  border-color: color-mix(in oklab, var(--fm-destructive) 25%, transparent);
  background: color-mix(in oklab, var(--fm-destructive) 8%, transparent);
  color: var(--fm-destructive);
}
.fm-alert[data-tone="warning"] {
  border-color: color-mix(in oklab, var(--fm-warning) 30%, transparent);
  background: color-mix(in oklab, var(--fm-warning) 10%, transparent);
  color: var(--fm-warning-emphasis);
}
.fm-alert[data-tone="success"] {
  border-color: color-mix(in oklab, var(--fm-success) 30%, transparent);
  background: color-mix(in oklab, var(--fm-success) 10%, transparent);
  color: var(--fm-success-emphasis);
}

/* ── 骨架屏（ui/skeleton.tsx）：muted 底 + 1.6s shimmer ────────── */
.fm-skeleton {
  border-radius: var(--fm-radius-md);
  background-color: var(--fm-muted);
  background-image: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in oklab, var(--fm-card) 70%, transparent) 50%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: fm-shimmer 1.6s linear infinite;
}
@keyframes fm-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
.fm-spin { animation: fm-rotate 900ms linear infinite; }
@keyframes fm-rotate {
  to { transform: rotate(360deg); }
}
@keyframes fm-fade-in {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: none; }
}
.fm-fade-in { animation: fm-fade-in var(--fm-duration-surface) var(--fm-ease-out-expo) both; }

/* ── 正文排版（design-system.md「字体与排版」）：15px / 1.75 ────── */
.fm-prose {
  font-size: 15px;
  line-height: 1.75;
  color: var(--fm-foreground);
  overflow-wrap: anywhere;
  text-autospace: normal;
  text-spacing-trim: normal;
}
.fm-prose > :first-child { margin-top: 0; }
.fm-prose > :last-child { margin-bottom: 0; }
.fm-prose p { margin: 0 0 14px; white-space: pre-wrap; }
.fm-prose h1, .fm-prose h2, .fm-prose h3, .fm-prose h4 {
  margin: 22px 0 10px;
  font-family: var(--fm-font-heading);
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.35;
}
.fm-prose h1 { font-size: 20px; }
.fm-prose h2 { font-size: 17px; }
.fm-prose h3 { font-size: 15px; }
.fm-prose blockquote {
  margin: 0 0 18px;
  padding: 2px 0 2px 14px;
  border-left: 2px solid color-mix(in oklab, var(--fm-primary) 55%, transparent);
  color: var(--fm-muted-foreground);
}
.fm-prose ul, .fm-prose ol { margin: 0 0 16px; padding-left: 20px; }
.fm-prose li { margin-bottom: 6px; }
.fm-prose pre {
  margin: 0 0 18px;
  padding: 12px 14px;
  overflow: auto;
  border: 1px solid var(--fm-border);
  border-radius: var(--fm-radius-lg);
  background: var(--fm-muted);
  font-family: var(--fm-font-mono);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
}
.fm-prose hr {
  margin: 22px 0;
  border: 0;
  border-top: 1px solid var(--fm-border);
}

/* ── 滚动条（细、暖灰、无轨道底色） ─────────────────────────────── */
.fm-scroll { scrollbar-width: thin; scrollbar-color: color-mix(in oklab, var(--fm-muted-foreground) 35%, transparent) transparent; }
.fm-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.fm-scroll::-webkit-scrollbar-thumb { border-radius: 999px; background: color-mix(in oklab, var(--fm-muted-foreground) 30%, transparent); }
.fm-scroll::-webkit-scrollbar-thumb:hover { background: color-mix(in oklab, var(--fm-muted-foreground) 45%, transparent); }
.fm-scroll::-webkit-scrollbar-track { background: transparent; }


/* ── 侧栏导航行（Ember 2：激活项是一张墨色纸片，图标染火焰色）────── */
.fm-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--fm-radius-lg);
  background: transparent;
  color: color-mix(in oklab, var(--fm-foreground) 78%, transparent);
  font: 400 13px/1 var(--fm-font-ui);
  text-align: left;
  cursor: pointer;
  outline: none;
  transition:
    background-color var(--fm-duration-fast) var(--fm-ease-signal),
    color var(--fm-duration-fast) var(--fm-ease-signal),
    box-shadow var(--fm-duration-fast) var(--fm-ease-signal);
}
.fm-nav-item:hover { background: var(--fm-muted); color: var(--fm-foreground); }
.fm-nav-item[data-active="true"] {
  border-color: color-mix(in oklab, var(--fm-foreground) 10%, transparent);
  background-color: var(--fm-card);
  box-shadow: var(--fm-paper-edge), var(--fm-shadow-xs);
  color: var(--fm-foreground);
  font-weight: 500;
}
.fm-nav-item[data-active="true"] svg { color: var(--fm-primary); }
.fm-nav-item:focus-visible { box-shadow: 0 0 0 3px color-mix(in oklab, var(--fm-ring) 25%, transparent); }
.fm-nav-item > svg { flex: none; }

/* 侧栏标签行：比导航行矮一档，可选可清 */
.fm-tag-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 26px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--fm-radius-md);
  background: transparent;
  color: var(--fm-muted-foreground);
  font: 400 12px/1 var(--fm-font-ui);
  text-align: left;
  cursor: pointer;
  outline: none;
}
.fm-tag-item:hover { background: var(--fm-muted); color: var(--fm-foreground); }
.fm-tag-item[data-active="true"] { background: var(--fm-accent); color: var(--fm-foreground); font-weight: 500; }
.fm-tag-item:focus-visible { box-shadow: 0 0 0 3px color-mix(in oklab, var(--fm-ring) 25%, transparent); }

/* ── 迷你月历（侧栏时间视界）：日格 + 活动点 ───────────────────── */
.fm-cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.fm-cal-weekday {
  height: 18px;
  color: var(--fm-muted-foreground);
  font: 500 10px/18px var(--fm-font-ui);
  text-align: center;
}
.fm-cal-cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: var(--fm-radius-md);
  background: transparent;
  color: var(--fm-foreground);
  font: 400 11px/1 var(--fm-font-ui);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  outline: none;
  transition:
    background-color var(--fm-duration-fast) var(--fm-ease-signal),
    color var(--fm-duration-fast) var(--fm-ease-signal);
}
.fm-cal-cell:hover { background: var(--fm-muted); }
.fm-cal-cell[data-outside="true"] { color: color-mix(in oklab, var(--fm-muted-foreground) 55%, transparent); }
.fm-cal-cell[data-today="true"] {
  box-shadow: inset 0 0 0 1px var(--fm-primary);
  font-weight: 600;
}
.fm-cal-cell[data-selected="true"] {
  background: var(--fm-foreground);
  color: var(--fm-background);
  font-weight: 600;
}
.fm-cal-cell:focus-visible { box-shadow: 0 0 0 3px color-mix(in oklab, var(--fm-ring) 25%, transparent); }
.fm-cal-dot {
  position: absolute;
  bottom: 3px;
  left: 50%;
  width: 3px;
  height: 3px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--fm-primary) 85%, transparent);
  transform: translateX(-50%);
}
.fm-cal-cell[data-selected="true"] .fm-cal-dot { background: var(--fm-background); }

/* ── 编写框（时间线顶部的 composer，Ember 纸卡）────────────────── */
.fm-composer {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid color-mix(in oklab, var(--fm-foreground) 10%, transparent);
  border-radius: var(--fm-radius-xl);
  background-color: var(--fm-card);
  background-image: var(--fm-grain);
  box-shadow: var(--fm-paper-edge), var(--fm-shadow-xs);
}
.fm-composer textarea {
  width: 100%;
  min-height: 52px;
  max-height: 240px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--fm-foreground);
  font: 400 15px/1.65 var(--fm-font-ui);
  outline: none;
  resize: none;
  text-autospace: normal;
  text-spacing-trim: normal;
}
.fm-composer textarea::placeholder { color: var(--fm-muted-foreground); }

/* ── 时间线便签卡（memo card）───────────────────────────────────── */
.fm-memo {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px 12px;
  border: 1px solid color-mix(in oklab, var(--fm-foreground) 9%, transparent);
  border-radius: var(--fm-radius-xl);
  background-color: var(--fm-card);
  background-image: var(--fm-grain);
  box-shadow: var(--fm-paper-edge), var(--fm-shadow-xs);
  transition:
    border-color var(--fm-duration-fast) var(--fm-ease-signal),
    box-shadow var(--fm-duration-fast) var(--fm-ease-signal);
}
.fm-memo:hover {
  border-color: color-mix(in oklab, var(--fm-foreground) 14%, transparent);
  box-shadow: var(--fm-paper-edge), var(--fm-shadow-sm);
}
.fm-memo-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.fm-memo-time {
  color: var(--fm-muted-foreground);
  font: 400 11px/1 var(--fm-font-ui);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.fm-memo-body {
  overflow: hidden;
  max-height: 16.2em;
  mask-image: linear-gradient(to bottom, #000 calc(100% - 2.5rem), transparent);
}
.fm-memo-body[data-clamped="false"] { max-height: none; mask-image: none; }
/* 卡片里的正文比详情页小一档：h1 不要顶成页面标题 */
.fm-memo-body .fm-prose { font-size: 14px; line-height: 1.7; }
.fm-memo-body .fm-prose h1 { margin: 14px 0 6px; font-size: 16px; }
.fm-memo-body .fm-prose h2 { margin: 12px 0 6px; font-size: 15px; }
.fm-memo-body .fm-prose h3 { margin: 10px 0 4px; font-size: 14px; }
.fm-memo-body .fm-prose p { margin: 0 0 8px; }
.fm-memo-body .fm-prose ul,
.fm-memo-body .fm-prose ol { margin: 0 0 8px; }
.fm-memo-body .fm-prose li { margin-bottom: 3px; }
.fm-memo-body .fm-prose blockquote { margin: 0 0 8px; }
.fm-memo-body .fm-prose pre { margin: 0 0 8px; padding: 8px 10px; font-size: 12px; }

/* ── 编写框右下角发送：Ember 唯一允许品牌渐变的地方 ─────────────── */
.fm-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: var(--fm-brand-gradient);
  color: var(--fm-brand-gradient-foreground);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.22), var(--fm-shadow-sm);
  cursor: pointer;
  transition: filter var(--fm-duration-fast) var(--fm-ease-signal);
}
.fm-send:hover:not(:disabled) { filter: brightness(1.05); }
.fm-send:disabled {
  background: var(--fm-muted);
  color: color-mix(in oklab, var(--fm-muted-foreground) 60%, transparent);
  box-shadow: none;
  cursor: default;
}
.fm-send:focus-visible { box-shadow: 0 0 0 3px color-mix(in oklab, var(--fm-ring) 25%, transparent); }

/* ── 侧栏统计卡：三列数字 ──────────────────────────────────────── */
.fm-stat-card {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  padding: 10px 0;
  border: 1px solid color-mix(in oklab, var(--fm-foreground) 8%, transparent);
  border-radius: var(--fm-radius-xl);
  background-color: var(--fm-card);
  background-image: var(--fm-grain);
  box-shadow: var(--fm-paper-edge), var(--fm-shadow-xs);
}
.fm-stat { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; }
.fm-stat + .fm-stat { border-left: 1px solid color-mix(in oklab, var(--fm-foreground) 8%, transparent); }
.fm-stat-value {
  color: var(--fm-foreground);
  font: 600 15px/1.1 var(--fm-font-heading);
  font-variant-numeric: tabular-nums;
}
.fm-stat-label { color: var(--fm-muted-foreground); font: 400 10px/1 var(--fm-font-ui); }

@media (prefers-reduced-motion: reduce) {
  .dsh-flaremo-root *,
  .dsh-flaremo-root *::before,
  .dsh-flaremo-root *::after {
    transition: none !important;
    animation: none !important;
  }
}
`

/** 注入到 document.head 的完整样式表（token + 字体 + 组件造型）。 */
export const THEME_CSS = `${FONT_FACE_CSS}${TOKEN_CSS}${COMPONENT_CSS}`
