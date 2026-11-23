/**
 * 笔记视图的小工具：时间线分组、搜索、正文块、字符统计、相关笔记。
 *
 * 输入只有真实数据：host 的 typert RPC 返回的窄视图，正文是 `content` 字符串。
 * 工作台不放假数据，所以这里也不再需要「示例数据带 blocks 数组」的第二条路径。
 */

import { parseContent } from './markdown.js'

/** 可见性枚举 → 文案（未知值原样返回，别的实例可能加新档）。 */
export function visibilityLabel(tr, value) {
  if (typeof value !== 'string' || value === '') return ''
  const key = `visibility.${value}`
  const text = tr(key)
  return text === key ? value : text
}

/** 正文块：把 `content` 用极简 Markdown 解析成渲染块。 */
export function noteBlocks(note) {
  if (note === null || note === undefined) return []
  return parseContent(note.content)
}

/** 时间：优先 updatedAt（真实数据是 ISO 字符串）。 */
export function noteTime(note) {
  return note?.updatedAt ?? note?.createdAt ?? ''
}

/**
 * 时间线分组用的自然日（YYYY-MM-DD）。
 *
 * 先用本地时区算：host 给的 `day` 是 `create_time` 的 UTC 前 10 位，而月历活动点
 * 按本地时区统计（服务端 `time_zone`），两边在跨零点那几个小时会错开一格。
 * 时间无法解析时才退回 `day` / 截断字符串。
 * @param {object} note - narrow note view.
 * @returns {string} local day key.
 */
export function noteDay(note) {
  const local = localDayOf(note)
  if (local !== '') return local
  const explicit = note?.day
  if (typeof explicit === 'string' && explicit.length >= 10) return explicit.slice(0, 10)
  const time = noteTime(note)
  return time.length >= 10 ? time.slice(0, 10) : '未知日期'
}

/**
 * 按**浏览器本地时区**算的自然日（YYYY-MM-DD）。
 *
 * 服务端的 `q` 日期过滤只到 UTC 日粒度，而月历的活动点是按本地时区统计的；
 * 两者在跨零点那几个小时会错开一格。选中某天时先用宽一格的 UTC 区间取数，
 * 再用这个函数按本地日筛一遍。
 * @param {object} note - narrow note view.
 * @returns {string} local day key, or '' when the time is unusable.
 */
export function localDayOf(note) {
  const parsed = new Date(noteTime(note))
  if (Number.isNaN(parsed.getTime())) return ''
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
}

/** 搜索用纯文本：标题、摘要、标签、正文。 */
export function noteText(note) {
  if (note === null || note === undefined) return ''
  const parts = [note.title, note.excerpt, Array.isArray(note.tags) ? note.tags.join(' ') : '']
  if (typeof note.content === 'string') parts.push(note.content)
  return parts.filter(Boolean).join('\n')
}

/** 本地过滤（已加载的笔记列表）。 */
export function matchesQuery(note, query) {
  const needle = String(query ?? '').trim().toLowerCase()
  if (needle === '') return true
  return noteText(note).toLowerCase().includes(needle)
}

/** 按天倒序分组，组内按更新时间倒序。 */
export function groupByDay(notes) {
  const groups = new Map()
  for (const note of Array.isArray(notes) ? notes : []) {
    const day = noteDay(note)
    const bucket = groups.get(day)
    if (bucket === undefined) groups.set(day, [note])
    else bucket.push(note)
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([day, rows]) => ({
      day,
      rows: [...rows].sort((a, b) => (noteTime(a) < noteTime(b) ? 1 : noteTime(a) > noteTime(b) ? -1 : 0)),
    }))
}

/** 正文字符数（粗略按去空白的字符算，中文一个字符算一个）。 */
export function noteCharCount(note) {
  if (note === null || note === undefined) return 0
  const text = typeof note.content === 'string' ? note.content : noteText(note)
  return text.replace(/\s/g, '').length
}

/** 同标签的相关笔记（排除自己，最多 limit 条）。 */
export function relatedByTag(note, pool, limit = 3) {
  if (note === null || note === undefined) return []
  const tags = Array.isArray(note.tags) ? note.tags : []
  if (tags.length === 0) return []
  return (Array.isArray(pool) ? pool : [])
    .filter((other) => other.id !== note.id && Array.isArray(other.tags) && other.tags.some((tag) => tags.includes(tag)))
    .slice(0, limit)
    .map((other) => ({ id: other.id, title: other.title, day: noteDay(other) }))
}

/** 只保留 HH:mm。 */
export function formatClock(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 完整本地时间（设置页显示连接时间）。 */
export function formatDateTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d} ${formatClock(iso)}`
}

/** 距过期还有多少秒（给配对码倒计时；负数夹到 0）。 */
export function secondsUntil(iso, now = Date.now()) {
  const target = Date.parse(iso ?? '')
  if (!Number.isFinite(target)) return 0
  return Math.max(0, Math.round((target - now) / 1000))
}
