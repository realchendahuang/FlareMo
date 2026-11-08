/**
 * 构建产物的回归测试：加载器包装不能改动 bundle 的字符串值。
 *
 * 背景（2026-11-08）：wrapper 以前给 CJS 产物的每一行补 4 个空格缩进。esbuild 的
 * minify 会把 `"\n"` 压成内含真实换行的模板字面量，于是补缩进 = 把空格写进字符串值：
 * markdown 解析器的 `replace(/\r\n?/g, "\n")` 变成了 `replace(…, "\n    ")`，
 * 所有正文都退化成单个段落（截图里表现为整篇 Markdown 原样显示）。
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'

import { wrapBundle } from '../scripts/build-client.mjs'

/** 跑一遍包装后的产物，拿回 module.exports。 */
function evaluate(wrapped) {
  const entries = []
  const sandbox = {
    window: { __ModuleLoader__: { load: (entry) => entries.push(entry) } },
  }
  vm.runInNewContext(wrapped, sandbox)
  assert.equal(entries.length, 1, '包装后的产物必须调用一次 __ModuleLoader__.load')
  return entries[0].factory((name) => {
    throw new Error(`unexpected require: ${name}`)
  })
}

test('wrapBundle 不改动含真实换行的模板字面量', () => {
  const code = 'var value = `\n    `;\nmodule.exports = { value };\n'
  const exports = evaluate(wrapBundle(code, 'demo'))
  assert.equal(exports.value, '\n    ')
})

test('wrapBundle 保留 \\n 字符串的换行语义', () => {
  const code = 'module.exports = { split: String("a\\n\\n- b").split("\\n") };\n'
  const exports = evaluate(wrapBundle(code, 'demo'))
  assert.deepEqual([...exports.split], ['a', '', '- b'])
})

test('wrapBundle 保留 UTF-8 中文与 id', () => {
  const wrapped = wrapBundle('module.exports = { text: "中文" };\n', 'dsh-flaremo')
  const exports = evaluate(wrapped)
  assert.equal(exports.text, '中文')
  assert.match(wrapped, /id: "dsh-flaremo"/)
})
