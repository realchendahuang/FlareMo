/**
 * 工作台的「真实渲染」测试：jsdom + react-dom/client，真的跑 effect。
 *
 * 这条链路是 P3 的核心：panel 组件拿 entry.jsx 注入的 `call`，先查连接状态，
 * 已连接就 `listNotes` 拉真数据、渲染时间线与详情；未连接只渲染连接引导，绝不出现示例数据。
 * 用假的 remote handle（双层信封和真的一样）驱动，不触碰网络。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

import { JSDOM } from 'jsdom'
import React from 'react'

const require = createRequire(import.meta.url)
const SOURCE = readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8')

// jsdom 必须在 import react-dom/client 之前装好
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
})
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Node = dom.window.Node
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { createRoot } = await import('react-dom/client')
const { act } = React

const NOTE = {
  id: 'real-1',
  title: '真实笔记：设备授权',
  excerpt: '来自实例的第一条真实笔记',
  content: '# 真实笔记：设备授权\n\n正文第一段\n\n- 要点一\n- 要点二',
  tags: ['工作', 'DSH'],
  createdAt: '2026-11-08T09:00:00Z',
  updatedAt: '2026-11-08T10:00:00Z',
  day: '2026-11-08',
  pinned: false,
  visibility: 'private',
  state: 'normal',
  source: 'web',
  creatorName: 'Kim',
  commentCount: 2,
}

/** 假 remote handle：方法返回真实的双层信封。 */
function createHandle({ connected }) {
  const calls = []
  const handle = {
    async connectionStatus(args) {
      calls.push({ method: 'connectionStatus', args })
      return {
        ok: true,
        value: {
          ok: true,
          connection: connected
            ? {
                connected: true,
                instanceUrl: 'https://notes.example.com',
                account: { id: 'u1', name: 'Kim' },
                scope: 'notes',
                lastSyncAt: '2026-11-08T10:00:00Z',
                connectedAt: '2026-11-01T10:00:00Z',
                accessExpiresAt: '2026-11-15T10:00:00Z',
                pending: null,
              }
            : { connected: false, instanceUrl: null, account: null, pending: null },
        },
      }
    },
    async listNotes(args) {
      calls.push({ method: 'listNotes', args })
      return { ok: true, value: { ok: true, notes: [NOTE] } }
    },
    async searchNotes(args) {
      calls.push({ method: 'searchNotes', args })
      return { ok: true, value: { ok: true, notes: [NOTE] } }
    },
    async connectStart(args) {
      calls.push({ method: 'connectStart', args })
      return {
        ok: true,
        value: {
          ok: true,
          connection: {
            connected: false,
            pending: {
              userCode: 'ABCD-1234',
              verificationUri: 'https://notes.example.com/connect',
              verificationUriComplete: 'https://notes.example.com/connect?code=ABCD-1234',
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
              intervalSeconds: 60,
            },
          },
        },
      }
    },
    async listPendingInsights(args) {
      calls.push({ method: 'listPendingInsights', args })
      return {
        ok: true,
        value: {
          ok: true,
          count: 2,
          insights: [],
          model: { available: true, provider: 'deepseek', model: 'deepseek-chat', reason: null },
        },
      }
    },
    async runPendingInsights(args) {
      calls.push({ method: 'runPendingInsights', args })
      return { ok: true, value: { ok: true, results: [], done: 0, failed: 0, skipped: 0 } }
    },
  }
  for (const method of ['connectPoll', 'disconnect', 'getNote', 'listTags']) {
    handle[method] = async (args) => {
      calls.push({ method, args })
      return { ok: true, value: { ok: true } }
    }
  }
  return { handle, calls }
}

/** 从 bundle 里拿 panel 组件 + inject face，并挂上假 handle。 */
function mountPanel({ connected }) {
  let entry = null
  const nodes = []
  const head = { appendChild: (node) => (nodes.push(node), node) }
  const documentStub = {
    getElementById: (id) => nodes.find((node) => node.id === id) ?? null,
    createElement: () => ({ id: '', textContent: '', parentNode: null }),
    head,
  }
  const windowStub = { innerWidth: 1440, __ModuleLoader__: { load: (row) => (entry = row) } }
  vm.runInNewContext(
    SOURCE,
    { window: windowStub, document: documentStub, console, setTimeout, clearTimeout, setInterval, clearInterval },
    { filename: 'dist/client.js' },
  )
  const plugin = entry.factory(require)

  const { handle, calls } = createHandle({ connected })
  const registrations = []
  const ctx = {
    effect: (callback) => callback(),
    slots: { inject: (_name, callback) => callback(), register: (options, component) => (registrations.push({ options, component }), () => {}) },
    layout: { selectPanel: () => {} },
    remote: { async $mount() { return () => {} } },
    get: (name) => (name === 'remote.flaremo' ? handle : undefined),
    reflect: { get: () => undefined },
  }
  plugin.apply(ctx)

  const main = registrations.find((row) => row.options.name === 'main')
  assert.ok(main, '没有注册 main 面板')
  const face = main.options.inject()
  return { component: main.component, face, calls, nodes }
}

/**
 * 渲染面板、等 effect 跑完，返回 DOM 文本。
 * @param {{ connected: boolean }} options
 */
async function renderWorkbench({ connected }) {
  const { component, face, calls } = mountPanel({ connected })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(component, { t: undefined, call: face.call, openConversation: face.openConversation }))
  })
  // 两段 loading（connectionStatus → listNotes）各占一个微任务批次
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  const text = container.textContent
  await act(async () => root.unmount())
  container.remove()
  return { text, calls, container }
}

test('已连接：工作台先查连接状态，再用 RPC 数据渲染时间线与详情', async () => {
  const { text, calls } = await renderWorkbench({ connected: true })

  assert.deepEqual(
    calls.map((row) => row.method),
    ['connectionStatus', 'listNotes', 'listPendingInsights'],
  )
  assert.equal(calls[1].args.pageSize, 50)
  assert.match(text, /实时/)
  assert.match(text, /真实笔记：设备授权/)
  assert.match(text, /来自实例的第一条真实笔记/)
  assert.match(text, /#工作/)
  assert.match(text, /正文第一段/)
  assert.match(text, /要点一/)
  // 已连接不应再出现示例数据标记
  assert.doesNotMatch(text, /示例数据/)
  // 洞察执行器入口：右栏显示 pending 队列
  assert.match(text, /洞察队列/)
  assert.match(text, /2 个待处理任务/)
})

test('未连接：不显示示例数据，只显示连接引导', async () => {
  const { text, calls } = await renderWorkbench({ connected: false })

  assert.deepEqual(
    calls.map((row) => row.method),
    ['connectionStatus'],
  )
  // 引导里直接就是连接表单，不需要先去设置页
  assert.match(text, /连接 FlareMo 实例/)
  assert.match(text, /实例地址/)
  assert.match(text, /生成配对码/)
  assert.match(text, /重新检查连接/)
  assert.match(text, /未连接实例/)
  assert.doesNotMatch(text, /示例数据/)
  assert.doesNotMatch(text, /把 FlareMo 工作台搬进 DSH/)
})

test('未连接：可以在面板里直接填地址生成配对码，不用跳设置页', async () => {
  const { component, face, calls } = mountPanel({ connected: false })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      React.createElement(component, { t: undefined, call: face.call, openConversation: face.openConversation }),
    )
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  const input = container.querySelector('input')
  assert.ok(input, '连接引导里应该有实例地址输入框')
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  await act(async () => {
    setValue.call(input, 'https://notes.example.com')
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })

  const startButton = [...container.querySelectorAll('button')].find((button) =>
    button.textContent.includes('生成配对码'),
  )
  assert.ok(startButton, '没有「生成配对码」按钮')
  await act(async () => {
    startButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  const text = container.textContent
  assert.match(text, /ABCD-1234/)
  assert.match(text, /打开配对页/)
  const started = calls.find((row) => row.method === 'connectStart')
  assert.ok(started, '面板里点「生成配对码」应该直接走 connectStart')
  assert.equal(started.args.instanceUrl, 'https://notes.example.com')

  await act(async () => root.unmount())
  container.remove()
})

test('RPC 不可用：显示连接引导与错误提示，不白屏、不放假数据', async () => {
  const { component, face } = mountPanel({ connected: true })
  const failingCall = async (method) => {
    if (method === 'connectionStatus') {
      const error = new Error('boom')
      error.code = 'REMOTE_UNAVAILABLE'
      throw error
    }
    return { ok: true, notes: [] }
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(component, { t: undefined, call: failingCall, openConversation: face.openConversation }))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  const text = container.textContent
  assert.match(text, /连接 FlareMo 实例/)
  assert.match(text, /读取失败/)
  assert.match(text, /内部错误/)
  assert.doesNotMatch(text, /示例数据/)
  await act(async () => root.unmount())
  container.remove()
})
