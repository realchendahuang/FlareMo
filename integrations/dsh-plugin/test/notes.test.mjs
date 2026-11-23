/**
 * 笔记视图工具单测：时间线分组、搜索、正文块、字符数、相关笔记、时间格式。
 * 这些函数决定工作台把 RPC 数据画成什么样，比组件快照更值得测。
 *
 * 分组与日期格式都跟随**本地时区**，所以这里把进程时区钉在上海：
 * 否则同一组夹具在 UTC+13 / UTC-11 的机器上会落到别的日子，断言随机器漂移。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatClock,
  formatDateTime,
  groupByDay,
  localDayOf,
  matchesQuery,
  noteBlocks,
  noteCharCount,
  noteDay,
  noteText,
  relatedByTag,
  secondsUntil,
} from '../src/client/notes.js'

// 必须在任何 Date 计算之前设置（node --test 每个文件一个独立进程）。
process.env.TZ = 'Asia/Shanghai'

const NOTES = [
  {
    id: 'a',
    title: '第一条',
    excerpt: '摘要一',
    tags: ['工作', 'DSH'],
    content: '# 标题\n\n正文',
    createdAt: '2026-11-08T09:00:00Z',
    updatedAt: '2026-11-08T10:00:00Z',
  },
  {
    id: 'b',
    title: '第二条',
    excerpt: '摘要二',
    tags: ['DSH'],
    content: '另一条正文',
    createdAt: '2026-11-07T09:00:00Z',
    updatedAt: '2026-11-07T10:00:00Z',
  },
  {
    id: 'c',
    title: '第三条',
    excerpt: '摘要三',
    tags: ['读书'],
    content: '第三条正文',
    createdAt: '2026-11-08T11:00:00Z',
    updatedAt: '2026-11-08T12:00:00Z',
  },
]

test('groupByDay：按天倒序，组内按更新时间倒序', () => {
  const groups = groupByDay(NOTES)
  assert.equal(groups.length, 2)
  assert.equal(groups[0].day, '2026-11-08')
  assert.deepEqual(
    groups[0].rows.map((note) => note.id),
    ['c', 'a'],
  )
  assert.deepEqual(
    groups[1].rows.map((note) => note.id),
    ['b'],
  )
})

test('groupByDay：空输入与非法输入都返回空数组', () => {
  assert.deepEqual(groupByDay([]), [])
  assert.deepEqual(groupByDay(undefined), [])
})

test('matchesQuery：标题 / 标签 / 正文都能命中，空关键词全真', () => {
  assert.equal(matchesQuery(NOTES[0], ''), true)
  assert.equal(matchesQuery(NOTES[0], '第一条'), true)
  assert.equal(matchesQuery(NOTES[0], 'dsH'), true)
  assert.equal(matchesQuery(NOTES[0], '正文'), true)
  assert.equal(matchesQuery(NOTES[0], '不存在的词'), false)
})

test('noteBlocks：只用 Markdown 解析正文，null 安全', () => {
  const parsed = noteBlocks(NOTES[0])
  assert.equal(parsed[0].type, 'heading')
  assert.equal(parsed[0].text, '标题')
  assert.equal(parsed[1].type, 'p')
  assert.deepEqual(noteBlocks(null), [])
})

test('noteText：把标题、标签、正文拼成搜索文本', () => {
  const text = noteText(NOTES[0])
  assert.match(text, /第一条/)
  assert.match(text, /工作/)
  assert.match(text, /正文/)
})

test('noteCharCount：忽略空白', () => {
  assert.equal(noteCharCount({ content: '一 二\n三' }), 3)
  assert.equal(noteCharCount(null), 0)
})

test('relatedByTag：同标签、排除自己、最多三条', () => {
  const related = relatedByTag(NOTES[0], NOTES)
  assert.deepEqual(
    related.map((row) => row.id),
    ['b'],
  )
  assert.deepEqual(relatedByTag({ id: 'x', tags: [] }, NOTES), [])
})

test('时间格式化', () => {
  assert.equal(formatClock('2026-11-08T10:30:00Z').length, 5)
  assert.match(formatDateTime('2026-11-08T10:30:00Z'), /^2026-11-08 \d\d:\d\d$/)
  assert.equal(formatClock('not-a-date'), '')
  assert.equal(formatDateTime('not-a-date'), '')
})

test('secondsUntil：过期夹到 0', () => {
  const future = new Date(Date.now() + 30_000).toISOString()
  assert.ok(secondsUntil(future) > 0 && secondsUntil(future) <= 30)
  assert.equal(secondsUntil('2000-01-01T00:00:00Z'), 0)
  assert.equal(secondsUntil(undefined), 0)
})

test('noteDay / localDayOf：按本地时区分组，跨零点的笔记不会落到前一天', () => {
  // UTC 2026-11-07T16:30Z 在 UTC+8 是 2026-11-08 00:30。
  const note = { createdAt: '2026-11-07T16:30:00Z', updatedAt: '2026-11-07T16:30:00Z', day: '2026-11-07' }
  assert.equal(localDayOf(note), '2026-11-08')
  assert.equal(noteDay(note), '2026-11-08', '分组日必须跟本地时区，不能直接用 host 的 UTC day')
  assert.equal(localDayOf({ createdAt: 'not-a-date' }), '')
  assert.equal(noteDay({ day: '2026-11-08', createdAt: '' }), '2026-11-08', '时间不可解析时退回 day 字段')
})
