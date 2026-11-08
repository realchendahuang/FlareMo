/**
 * 样式层：颜色/排版 token + 组件造型 class + 注入的样式表。
 *
 * 两条规矩（沿用插件既有约定，别混）：
 *  1. **形状与状态**（按钮、输入框、卡片、徽标、键帽、悬停/焦点/禁用）走 class，
 *     实现全在 theme.js 的 COMPONENT_CSS 里 —— 这些能在网页端一一对应，
 *     inline 写不出来 :hover / :focus-visible / 深色覆盖；
 *  2. **版面**（flex/grid/宽高/间距）仍走内联 style，就近可读。
 *
 * class 一览（值都抄自 FlareMo 网页端 components/ui/*，改之前先看那边）：
 *
 *   按钮   <button className="fm-btn" data-variant="brand|default|outline|ghost|secondary|destructive"
 *                    data-size="default|sm|xs|icon|icon-sm">
 *   输入框 <input className="fm-input" data-size="search" data-tone="code">
 *   卡片   <div className="fm-card" data-size="sm">
 *   记录行 <button className="fm-note" data-active="true|false">
 *   徽标   <span className="fm-badge" data-tone="neutral|brand|success|warning|danger|info">
 *   chip   <span className="fm-chip">#tag</span>
 *   pill   <button className="fm-pill" data-active="…">
 *   键帽   <kbd className="fm-kbd">⌘K</kbd>
 *   空状态 <div className="fm-empty"> + .fm-empty-icon / .fm-empty-title / .fm-empty-desc
 *   提示条 <div className="fm-alert" data-tone="danger|warning|success">
 *   骨架   <div className="fm-skeleton">
 *   滚动   className="fm-scroll"
 *   正文   className="fm-prose"（由 BlockView 输出语义标签，样式在 CSS 里）
 *
 * 主题（亮/暗）由 theme.js 的 --fm-* token 负责，深色跟 DSH 的
 * `body[data-ds-dark-theme]` 走，插件自己**不判断**明暗。
 */

import { THEME_CSS } from './theme.js'

/** 颜色 / 字体 / 圆角 / 阴影 token。全部指向 --fm-*，带浅色兜底。 */
export const C = {
  /* 墨色与纸面 */
  text: 'var(--fm-foreground, #1f2328)',
  textSecondary: 'var(--fm-muted-foreground, #57606a)',
  textTertiary: 'var(--fm-muted-foreground, #6e7781)',
  caption: 'var(--fm-muted-foreground, #8c959f)',
  page: 'var(--fm-background, #ffffff)',
  bgBase: 'var(--fm-card, #ffffff)',
  bgLayer1: 'var(--fm-muted, #f6f8fa)',
  bgLayer2: 'var(--fm-secondary, #f6f8fa)',
  bgLayer3: 'var(--fm-accent, #eef1f4)',
  bgHover: 'var(--fm-muted, rgba(0, 0, 0, 0.05))',
  bgActive: 'var(--fm-accent, rgba(0, 0, 0, 0.08))',

  /* 线条（发丝环） */
  border: 'var(--fm-border, rgba(0, 0, 0, 0.12))',
  borderSoft: 'color-mix(in oklab, var(--fm-border, rgba(0, 0, 0, 0.12)) 70%, transparent)',
  borderStrong: 'var(--fm-input, rgba(0, 0, 0, 0.16))',

  /* 品牌与状态：墨色是默认，火焰色是强调 */
  ink: 'var(--fm-foreground, #1f2328)',
  inkSoft: 'color-mix(in oklab, var(--fm-foreground, #1f2328) 8%, transparent)',
  accent: 'var(--fm-primary, #d4551f)',
  accentSoft: 'color-mix(in oklab, var(--fm-primary, #d4551f) 10%, transparent)',
  onAccent: 'var(--fm-primary-foreground, #ffffff)',
  primary: 'var(--fm-primary, #d4551f)',
  primarySoft: 'color-mix(in oklab, var(--fm-primary, #d4551f) 10%, transparent)',
  brandGradient: 'var(--fm-brand-gradient)',
  ring: 'var(--fm-ring, #e8874a)',

  success: 'var(--fm-success-emphasis, #1a7f37)',
  warn: 'var(--fm-warning-emphasis, #9a6700)',
  danger: 'var(--fm-destructive, #cf222e)',
  info: 'var(--fm-info-emphasis, #0969da)',
  link: 'var(--fm-primary, #0969da)',

  /* 字体与字号 */
  font: 'var(--fm-font-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif)',
  fontHeading: 'var(--fm-font-heading, -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif)',
  mono: 'var(--fm-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  contentSize: '14px',

  /* 形状 */
  radiusSm: 'var(--fm-radius-sm, 6px)',
  radiusMd: 'var(--fm-radius-md, 8px)',
  radiusLg: 'var(--fm-radius-lg, 10px)',
  radiusXl: 'var(--fm-radius-xl, 14px)',
  radius2xl: 'var(--fm-radius-2xl, 18px)',

  /* 投影（深色下 token 自动归零） */
  shadowSoft: 'var(--fm-shadow-xs, 0 1px 2px rgba(0, 0, 0, 0.045))',
  shadowProminent: 'var(--fm-shadow-lg, 0 16px 40px -12px rgba(0, 0, 0, 0.18))',

  /* 动效 */
  durationFast: 'var(--fm-duration-fast, 120ms)',
  easeSignal: 'var(--fm-ease-signal, cubic-bezier(0.22, 1, 0.36, 1))',
}

/**
 * 字号阶梯（docs/design-system.md「字体与排版」，Tailwind 值换算成 px）。
 * 只能从这几档里选，不要临时写 13.5 / 12.5 这种中间值。
 */
export const T = {
  /* 页面大标题 H1：text-lg sm:text-xl font-semibold tracking-tight */
  h1: { fontSize: 20, lineHeight: '28px', fontWeight: 600, letterSpacing: '-0.01em' },
  /* 弹窗/区域大标题 H2：text-base font-semibold */
  h2: { fontSize: 16, lineHeight: '24px', fontWeight: 600, letterSpacing: '-0.005em' },
  /* 卡片标题：text-sm font-medium */
  h3: { fontSize: 14, lineHeight: '20px', fontWeight: 500 },
  /* 栏目标签：text-xs font-medium/600 */
  section: { fontSize: 12, lineHeight: '16px', fontWeight: 600 },
  /* 正文：text-sm */
  body: { fontSize: 14, lineHeight: '22px', fontWeight: 400 },
  /* 长文正文：text-[15px] leading-7 */
  prose: { fontSize: 15, lineHeight: '26px', fontWeight: 400 },
  /* 辅助：text-xs */
  caption: { fontSize: 12, lineHeight: '18px', fontWeight: 400 },
  /* 元信息下限：text-[11px]，只给键帽、徽标、时间戳用 */
  micro: { fontSize: 11, lineHeight: '16px', fontWeight: 400 },
}

/** 常用组合。 */
export const S = {
  /** 顶部工具栏 / 底栏这类发丝分割。 */
  hairline: `1px solid ${C.border}`,
  /** 纸张卡片（场内联基础，复杂卡片直接用 className="fm-card"）。 */
  card: {
    background: C.bgBase,
    border: `1px solid ${C.border}`,
    borderRadius: C.radiusXl,
    boxShadow: C.shadowSoft,
    padding: 16,
  },
  /** 表单项块。 */
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    ...T.caption,
    fontWeight: 500,
    color: C.text,
  },
  hint: {
    ...T.micro,
    color: C.caption,
    lineHeight: '17px',
  },
  /** 两行截断。 */
  clamp2: {
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  clamp3: {
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  /** 右栏小标题（Ember：栏目标签 12px 600，不要大写字距全大写）。 */
  sectionTitle: {
    ...T.section,
    margin: '0 0 8px',
    color: C.text,
  },
  /** 只读信息行。 */
  infoRow: {
    display: 'flex',
    gap: 8,
    ...T.caption,
    lineHeight: '20px',
  },
  infoLabel: {
    flex: '0 0 72px',
    color: C.textSecondary,
  },
  infoValue: {
    color: C.text,
    overflowWrap: 'anywhere',
  },
  /** 段落按钮组。 */
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  /** 圆角胶囊按钮（旧的 S.button 语义，已换成 fm-btn class）。 */
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    height: 20,
    padding: '0 7px',
    borderRadius: 999,
    background: C.bgLayer1,
    color: C.textSecondary,
    fontSize: 11,
    lineHeight: '20px',
    whiteSpace: 'nowrap',
  },
}

/** 注入到 document.head 的样式表（<style id="dsh-flaremo-styles">）。 */
export const CSS = THEME_CSS
