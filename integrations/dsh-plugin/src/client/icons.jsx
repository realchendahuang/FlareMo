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

/** 左箭头（月历上一月 / 详情返回）。 */
export function IconChevronLeft({ size = 16 }) {
  return (
    <Glyph size={size}>
      <path d="M9.8 3.4L5.2 8l4.6 4.6" />
    </Glyph>
  )
}

/** 全部记录：宫格。 */
export function IconGrid({ size = 16 }) {
  return (
    <Glyph size={size}>
      <rect x="2.4" y="2.4" width="4.8" height="4.8" rx="1.1" />
      <rect x="8.8" y="2.4" width="4.8" height="4.8" rx="1.1" />
      <rect x="2.4" y="8.8" width="4.8" height="4.8" rx="1.1" />
      <rect x="8.8" y="8.8" width="4.8" height="4.8" rx="1.1" />
    </Glyph>
  )
}

/** 归档：盒子 + 盖。 */
export function IconArchive({ size = 16 }) {
  return (
    <Glyph size={size}>
      <rect x="2.2" y="3" width="11.6" height="2.6" rx="0.9" />
      <path d="M3.2 5.6v7.4h9.6V5.6" />
      <path d="M6.4 8.4h3.2" />
    </Glyph>
  )
}

/** 回收站：桶 + 盖。 */
export function IconTrash({ size = 16 }) {
  return (
    <Glyph size={size}>
      <path d="M3 4.6h10" />
      <path d="M6.2 4.6V3.2h3.6v1.4" />
      <path d="M4.2 4.6l.6 9h6.4l.6-9" />
      <path d="M6.6 7.2v3.4M9.4 7.2v3.4" />
    </Glyph>
  )
}

/** 日历（侧栏时间视界标题）。 */
export function IconCalendar({ size = 16 }) {
  return (
    <Glyph size={size}>
      <rect x="2.4" y="3.4" width="11.2" height="10.2" rx="1.6" />
      <path d="M2.4 6.4h11.2M5.6 2.2v2.4M10.4 2.2v2.4" />
    </Glyph>
  )
}

/** 标签：吊牌。 */
export function IconTag({ size = 16 }) {
  return (
    <Glyph size={size}>
      <path d="M2.6 8.1V3.2h4.9l6 6a1.2 1.2 0 010 1.7l-2.6 2.6a1.2 1.2 0 01-1.7 0z" />
      <circle cx="5.4" cy="5.9" r="0.8" />
    </Glyph>
  )
}

/** 发布：纸飞机。 */
export function IconSend({ size = 16 }) {
  return (
    <Glyph size={size}>
      <path d="M2.4 7.4l11.2-4.6-4.2 11-1.9-4.3z" />
      <path d="M7.5 9.5l6.1-6.7" />
    </Glyph>
  )
}

/** 收起/展开侧栏。 */
export function IconPanelLeft({ size = 16 }) {
  return (
    <Glyph size={size}>
      <rect x="2.2" y="2.8" width="11.6" height="10.4" rx="1.8" />
      <path d="M6.2 2.8v10.4" />
    </Glyph>
  )
}
