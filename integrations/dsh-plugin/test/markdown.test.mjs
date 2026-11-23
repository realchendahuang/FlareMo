/**
 * 极简 Markdown 解析单测。
 *
 * FlareMo 笔记正文是 Markdown；工作台详情栏只认这几种块。这里覆盖
 * 标题 / 段落 / 列表（有序无序）/ 引用 / 代码块 / 分隔线 / 未闭合围栏 / 空输入。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { MAX_BLOCKS, parseContent } from '../src/client/markdown.js'

test('标题 + 段落', () => {
  const blocks = parseContent('# 标题\n\n第一段\n第二段\n\n### 小标题')
  assert.deepEqual(blocks, [
    { type: 'heading', level: 1, text: '标题' },
    { type: 'p', text: '第一段\n第二段' },
    { type: 'heading', level: 3, text: '小标题' },
  ])
})

test('无序列表与有序列表', () => {
  const unordered = parseContent('- 一\n- 二\n* 三')
  assert.deepEqual(unordered, [{ type: 'list', ordered: false, items: ['一', '二', '三'] }])

  const ordered = parseContent('1. 先\n2) 后')
  assert.deepEqual(ordered, [{ type: 'list', ordered: true, items: ['先', '后'] }])
})

test('引用与分隔线', () => {
  const blocks = parseContent('> 引用一\n> 引用二\n\n---')
  assert.deepEqual(blocks, [
    { type: 'quote', text: '引用一\n引用二' },
    { type: 'divider' },
  ])
})

test('代码块保留原样（包括空行）', () => {
  const content = '```js\nconst a = 1\n\nconsole.log(a)\n```'
  const blocks = parseContent(content)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'code')
  assert.equal(blocks[0].lang, 'js')
  assert.equal(blocks[0].text, 'const a = 1\n\nconsole.log(a)')
})

test('未闭合的代码围栏吃到结尾，不丢内容', () => {
  const blocks = parseContent('```\n一行\n两行')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'code')
  assert.equal(blocks[0].text, '一行\n两行')
})

test('CRLF 与空输入', () => {
  assert.deepEqual(parseContent(''), [])
  assert.deepEqual(parseContent(undefined), [])
  assert.deepEqual(parseContent('a\r\n\r\nb'), [
    { type: 'p', text: 'a' },
    { type: 'p', text: 'b' },
  ])
})

test('段落遇到块标记会断开', () => {
  const blocks = parseContent('正文\n## 标题\n- 列表')
  assert.equal(blocks[0].type, 'p')
  assert.equal(blocks[1].type, 'heading')
  assert.equal(blocks[2].type, 'list')
})

test('块数上限保护超长正文', () => {
  const long = Array.from({ length: MAX_BLOCKS + 50 }, (_, index) => `段落 ${index}`).join('\n\n')
  assert.equal(parseContent(long).length, MAX_BLOCKS)
})
