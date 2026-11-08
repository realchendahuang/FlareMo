/**
 * 主题 token 包装 + 少量无法内联的 CSS。
 *
 * 原则（对照 research/dsh-flaremo-plugin/01-dsh-client-ui.md §2.8 / §7.4）：
 *  - 颜色、圆角、阴影、字体只用 DSH 的 `--dsw-*` token，并带浅色主题 fallback；
 *    深色主题由 DSH 自己把 token 换掉，插件不写死 hex 判断；
 *  - 版面与组件样式走内联 `style`（纯 React，无 CSS 依赖）；
 *  - 伪类（hover / focus-visible / ::placeholder / 滚动条 / 减少动态效果）
 *    内联表达不了，用一小段注入的 <style> 补上。
 */

/** 颜色 / 边框 / 阴影 token，全部带 fallback。 */
export const C = {
  text: 'var(--dsw-alias-label-primary, #1f2328)',
  textSecondary: 'var(--dsw-alias-label-secondary, #57606a)',
  textTertiary: 'var(--dsw-alias-label-tertiary, #6e7781)',
  caption: 'var(--dsw-alias-label-caption, #8c959f)',
  bgBase: 'var(--dsw-alias-bg-base, #ffffff)',
  bgLayer1: 'var(--dsw-alias-bg-layer-1, #f6f8fa)',
  bgLayer2: 'var(--dsw-alias-bg-layer-2, #f6f8fa)',
  bgLayer3: 'var(--dsw-alias-bg-layer-3, #eef1f4)',
  bgHover: 'var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05))',
  bgActive: 'var(--dsw-alias-interactive-bg-active, rgba(0, 0, 0, 0.08))',
  border: 'var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12))',
  borderSoft: 'var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08))',
  borderStrong: 'var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.16))',
  accent: 'var(--dsw-alias-state-business-primary, #2f6feb)',
  accentSoft: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 12%, transparent)',
  onAccent: 'var(--dsw-alias-label-primary-inverted, #ffffff)',
  success: 'var(--dsw-alias-state-success-primary, #1a7f37)',
  warn: 'var(--dsw-alias-state-warn-primary, #9a6700)',
  danger: 'var(--dsw-alias-state-danger-primary, #cf222e)',
  link: 'var(--dsw-alias-link, #0969da)',
  font: 'var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif)',
  mono: 'var(--dsh-code-font-family, var(--dsw-font-family, ui-monospace, SFMono-Regular, Menlo, monospace))',
  contentSize: 'var(--dsh-content-font-size, 14px)',
  radiusSm: 'var(--dsw-radius-sm, 6px)',
  radiusMd: 'var(--dsw-radius-md, 8px)',
  radiusLg: 'var(--dsw-radius-lg, 12px)',
  radiusXl: 'var(--dsw-radius-xl, 16px)',
  shadowSoft: 'var(--dsw-elevation-soft, 0 1px 2px rgba(0, 0, 0, 0.06))',
  shadowProminent: 'var(--dsw-elevation-prominent, 0 8px 24px rgba(0, 0, 0, 0.12))',
}

/** 常用组合，省得每个组件重复拼。 */
export const S = {
  card: {
    background: C.bgBase,
    border: `1px solid ${C.borderSoft}`,
    borderRadius: C.radiusLg,
    boxShadow: C.shadowSoft,
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    height: 20,
    padding: '0 7px',
    borderRadius: 999,
    background: C.bgLayer2,
    color: C.textSecondary,
    fontSize: 11,
    lineHeight: '20px',
    whiteSpace: 'nowrap',
  },
  iconButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    padding: 0,
    border: 'none',
    borderRadius: C.radiusSm,
    background: 'transparent',
    color: C.textSecondary,
    cursor: 'pointer',
  },
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 30,
    padding: '0 12px',
    border: `1px solid ${C.border}`,
    borderRadius: C.radiusMd,
    background: C.bgBase,
    color: C.text,
    fontSize: 12.5,
    fontFamily: 'inherit',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  primaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 30,
    padding: '0 12px',
    border: '1px solid transparent',
    borderRadius: C.radiusMd,
    background: C.accent,
    color: C.onAccent,
    fontSize: 12.5,
    fontFamily: 'inherit',
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
}

/**
 * 注入到 document.head 的样式表。只放内联表达不了的伪类与滚动条，
 * 其余全部在组件里用内联 style 写。
 */
export const CSS = `
.dsh-flaremo-root {
  color: ${C.text};
  font-family: ${C.font};
  font-size: ${C.contentSize};
  background: ${C.bgBase};
}
.dsh-flaremo-root *, .dsh-flaremo-root *::before, .dsh-flaremo-root *::after {
  box-sizing: border-box;
}
.dsh-flaremo-head {
  padding-top: 10px;
}
html[data-platform='darwin'] .dsh-flaremo-head {
  padding-top: calc(10px + var(--dsh-frame-top-clearance, 0px));
}
.dsh-flaremo-scroll {
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l2, rgba(0, 0, 0, 0.2)) transparent;
}
.dsh-flaremo-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.dsh-flaremo-scroll::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-scrollbar-bg-l2, rgba(0, 0, 0, 0.2));
  border-radius: 999px;
}
.dsh-flaremo-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--dsw-alias-scrollbar-hover-l2, rgba(0, 0, 0, 0.32));
}
.dsh-flaremo-scroll::-webkit-scrollbar-track { background: transparent; }
.dsh-flaremo-input::placeholder {
  color: ${C.caption};
}
.dsh-flaremo-input:focus {
  border-color: ${C.accent} !important;
  outline: none;
}
.dsh-flaremo-btn:hover:not(:disabled) {
  /* 内联 style 已经给了背景色，伪类要盖过它只能 !important */
  background: ${C.bgHover} !important;
}
.dsh-flaremo-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.dsh-flaremo-primary:hover:not(:disabled) {
  filter: brightness(1.06);
}
.dsh-flaremo-icon-btn:hover {
  background: ${C.bgHover} !important;
  color: ${C.text} !important;
}
.dsh-flaremo-card {
  transition: background-color 120ms ease, border-color 120ms ease;
}
.dsh-flaremo-card:hover {
  background: ${C.bgHover} !important;
}
.dsh-flaremo-row:hover {
  background: ${C.bgHover} !important;
}
.dsh-flaremo-check {
  opacity: 0;
  transition: opacity 120ms ease;
}
.dsh-flaremo-card:hover .dsh-flaremo-check,
.dsh-flaremo-check[data-selected='true'] {
  opacity: 1;
}
.dsh-flaremo-root :is(button, input, [tabindex]):focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color, ${C.accent});
  outline-offset: 1px;
  border-radius: ${C.radiusSm};
}
@media (prefers-reduced-motion: reduce) {
  .dsh-flaremo-root * { transition: none !important; animation: none !important; }
}
`
