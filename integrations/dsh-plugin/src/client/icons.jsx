/**
 * 图标：全部 16×16 线性 SVG，`currentColor` 跟随主题。
 *
 * `FlareMoIcon` 是左栏入口的图标，签名必须是 ({ size, active }) —— ui-sidebar 的
 * `sidebar.panellist` 注册项会把要求的边长和选中态传进来（官方类型
 * SidebarPanelIconOwnerProps）。其余图标是工作台内部用的小图标。
 */

import React from 'react'

function Glyph({ size = 16, children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/**
 * 左栏「笔记」入口图标：一张折角便笺 + 右上角一枚火花（flare）。
 * @param {{ size?: number, active?: boolean }} props - sidebar icon share.
 * @returns {React.ReactElement} the glyph.
 */
export function FlareMoIcon({ size = 16 }) {
  return (
    <Glyph size={size}>
      <path d="M3 2.75h6.5L13 6.25v7H3z" />
      <path d="M9.5 2.75v3.5H13" />
      <path d="M5 8.5h6M5 11h4" />
      <path d="M13.6 1.2l.45 1.15L15.2 2.8l-1.15.45L13.6 4.4l-.45-1.15L12 2.8l1.15-.45z" strokeWidth={1} />
    </Glyph>
  )
}

/** 搜索放大镜。 */
export function IconSearch({ size = 16 }) {
  return (
    <Glyph size={size}>
      <circle cx="7.2" cy="7.2" r="4.2" />
      <path d="M10.4 10.4L14 14" />
    </Glyph>
  )
}

/** 现代替「魔法/AI」的十字星。 */
export function IconSparkle({ size = 16 }) {
  return (
    <Glyph size={size}>
      <path d="M8 1.8l1.35 3.6L13 6.8l-3.65 1.35L8 11.8 6.65 8.15 3 6.8l3.65-1.4z" />
      <path d="M12.6 10.6l.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45L10.6 12.6l1.45-.55z" strokeWidth={1} />
    </Glyph>
  )
}

/** 勾选（多选状态）。 */
export function IconCheck({ size = 16 }) {
  return (
    <Glyph size={size}>
      <path d="M3.2 8.3l3 3L12.8 4.8" />
    </Glyph>
  )
}

/** 右栏收起 / 展开。 */
export function IconChevronRight({ size = 16 }) {
  return (
    <Glyph size={size}>
      <path d="M6.2 3.6L10.6 8l-4.4 4.4" />
    </Glyph>
  )
}

/** 复制正文。 */
export function IconCopy({ size = 16 }) {
  return (
    <Glyph size={size}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
    </Glyph>
  )
}

/** 刷新。 */
export function IconRefresh({ size = 16 }) {
  return (
    <Glyph size={size}>
      <path d="M13 6.5A5.2 5.2 0 1 0 13.2 9" />
      <path d="M13 2.6v3.9H9.1" />
    </Glyph>
  )
}

/** 引用到会话。 */
export function IconQuote({ size = 16 }) {
  return (
    <Glyph size={size}>
      <path d="M5.6 4.2H3.2v4.2h2.4V4.2zM12.8 4.2H10.4v4.2h2.4V4.2z" />
      <path d="M3.2 8.4c0 2 1 3.2 2.4 3.4M10.4 8.4c0 2 1 3.2 2.4 3.4" />
    </Glyph>
  )
}

/** 时钟（时间线分组头）。 */
export function IconClock({ size = 16 }) {
  return (
    <Glyph size={size}>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 4.8V8l2.2 1.4" />
    </Glyph>
  )
}
