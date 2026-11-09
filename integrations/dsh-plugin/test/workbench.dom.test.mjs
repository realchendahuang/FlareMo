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

/** 假 remote handle：方法返回真实的双层信封（含多实例的 instances / activeId）。 */
function createHandle({ connected }) {
  const calls = []
  /** 两条具名实例；active 由 switchInstance 改写。 */
  const instances = [
    {
      id: 'inst-kosx',
      alias: 'kosx',
      instanceUrl: 'https://notes.example.com',
      account: { id: 'u1', name: 'Kim' },
      connected: true,
      connectedAt: '2026-11-01T10:00:00Z',
      lastSyncAt: '2026-11-08T10:00:00Z',
    },
    {
      id: 'inst-saas',
      alias: 'saas',
      instanceUrl: 'https://saas.example.com',
      account: { id: 'u2', name: 'Kim' },
      connected: true,
      connectedAt: '2026-11-02T10:00:00Z',
      lastSyncAt: '2026-11-07T10:00:00Z',
    },
  ]
  let activeId = 'inst-kosx'

  const instanceRows = () => instances.map((row) => ({ ...row, active: row.id === activeId }))
  const activeRow = () => instances.find((row) => row.id === activeId) ?? null
  const connectionView = () => {
    if (!connected) {
      return { connected: false, instanceUrl: null, account: null, pending: null, activeId: null, instances: [] }
    }
    const row = activeRow()
    return {
      connected: true,
      instanceUrl: row?.instanceUrl ?? null,
      instanceId: row?.id ?? null,
      alias: row?.alias ?? null,
      account: row?.account ?? null,
      scope: 'notes',
      lastSyncAt: row?.lastSyncAt ?? null,
      connectedAt: row?.connectedAt ?? null,
      accessExpiresAt: '2026-11-15T10:00:00Z',
      activeId,
      instances: instanceRows(),
      pending: null,
    }
  }

  const handle = {
    async connectionStatus(args) {
      calls.push({ method: 'connectionStatus', args })
      return { ok: true, value: { ok: true, connection: connectionView() } }
    },
    async listInstances(args) {
      calls.push({ method: 'listInstances', args })
      return { ok: true, value: { ok: true, instances: instanceRows(), activeId } }
    },
    async switchInstance(args) {
      calls.push({ method: 'switchInstance', args })
      if (instances.some((row) => row.id === args?.id)) activeId = args.id
      return {
        ok: true,
        value: { ok: true, connection: connectionView(), instances: instanceRows(), activeId },
      }
    },
    async renameInstance(args) {
      calls.push({ method: 'renameInstance', args })
      const row = instances.find((item) => item.id === args?.id)
      if (row !== undefined && typeof args?.alias === 'string') row.alias = args.alias
      return { ok: true, value: { ok: true, instances: instanceRows(), activeId } }
    },
    async removeInstance(args) {
      calls.push({ method: 'removeInstance', args })
      const index = instances.findIndex((item) => item.id === args?.id)
      if (index >= 0) {
        instances.splice(index, 1)
        if (activeId === args.id) activeId = instances[0]?.id ?? null
      }
      return {
        ok: true,
        value: { ok: true, connection: connectionView(), instances: instanceRows(), activeId },
      }
    },
    async listNotes(args) {
      calls.push({ method: 'listNotes', args })
      const note =
        activeId === 'inst-saas'
          ? {
              ...NOTE,
              id: 'real-2',
              title: 'SaaS 实例笔记',
              excerpt: '来自第二个实例的笔记',
              content: '# SaaS 实例笔记\n\n来自第二个实例的笔记',
            }
          : NOTE
      return { ok: true, value: { ok: true, notes: [note] } }
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
    async memoStats(args) {
      calls.push({ method: 'memoStats', args })
      return {
        ok: true,
        value: {
          ok: true,
          counts: { normal: 1, archived: 0, trashed: 0, total: 1 },
          activeDays: 1,
          tags: [{ name: '工作', count: 1 }, { name: 'DSH', count: 1 }],
          activity: [{ date: '2026-11-08', count: 1 }],
        },
      }
    },
    async createNote(args) {
      calls.push({ method: 'createNote', args })
      return { ok: true, value: { ok: true, note: { ...NOTE, id: 'real-new' } } }
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
    // 切换器会挂全局 pointerdown / keydown 监听；假的 document 也要有这个面。
    addEventListener: () => {},
    removeEventListener: () => {},
    head,
  }
  const windowStub = {
    innerWidth: 1440,
    // 切换器的菜单会挂 resize 监听（真实浏览器有）；假的 window 也要有这个面。
    addEventListener: () => {},
    removeEventListener: () => {},
    __ModuleLoader__: { load: (row) => (entry = row) },
  }
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
    calls.slice(0, 2).map((row) => row.method),
    ['connectionStatus', 'listNotes'],
  )
  assert.equal(calls[1].args.pageSize, 50)
  assert.ok(calls.some((row) => row.method === 'memoStats'), '侧栏应拉统计')
  assert.ok(calls.some((row) => row.method === 'listPendingInsights'), '侧栏应拉洞察队列')
  // 新版面：侧栏同步状态 + 时间线便签卡（内容 → Markdown → 列表标签）
  assert.match(text, /最后同步/)
  assert.match(text, /真实笔记：设备授权/)
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

/** 渲染面板但保留容器，供交互测试用（effect 跑完后返回 settle/cleanup）。 */
async function renderPanel({ connected }) {
  const { component, face, calls } = mountPanel({ connected })
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
  const settle = async (rounds = 2) => {
    for (let index = 0; index < rounds; index += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
  }
  const cleanup = async () => {
    await act(async () => root.unmount())
    container.remove()
  }
  return { container, calls, settle, cleanup }
}

test('已连接：顶栏出现实例切换器并渲染当前实例 alias', async () => {
  const { container, cleanup } = await renderPanel({ connected: true })
  const trigger = container.querySelector('button[aria-haspopup="menu"]')
  assert.ok(trigger, '已连接时应渲染实例切换器')
  assert.match(trigger.textContent, /kosx/)
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(container.querySelector('[role="menu"]'), null, '菜单默认收起')
  await cleanup()
})

test('切换器：点开菜单选另一个实例 → switchInstance 后重新拉新实例笔记', async () => {
  const { container, calls, settle, cleanup } = await renderPanel({ connected: true })

  const trigger = container.querySelector('button[aria-haspopup="menu"]')
  await act(async () => {
    trigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  assert.equal(trigger.getAttribute('aria-expanded'), 'true')
  const menu = container.querySelector('[role="menu"]')
  assert.ok(menu, '点开后应出现实例菜单')
  assert.match(menu.textContent, /kosx/)
  assert.match(menu.textContent, /saas/)
  assert.match(menu.textContent, /saas\.example\.com/)

  const row = [...menu.querySelectorAll('button[role="menuitem"]')].find((button) =>
    button.textContent.includes('saas'),
  )
  assert.ok(row, '菜单里应有一行 saas')
  await act(async () => {
    row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await settle()

  const switched = calls.find((call) => call.method === 'switchInstance')
  assert.ok(switched, '点击非 active 行应调 switchInstance')
  assert.equal(switched.args.id, 'inst-saas') // bundle 在另一个 realm，只比字段
  assert.equal(calls.filter((call) => call.method === 'listNotes').length, 2, '切换后应重新拉笔记')
  assert.match(container.textContent, /SaaS 实例笔记/, '时间线应跟随 active 实例')
  assert.equal(container.querySelector('[role="menu"]'), null, '切换后菜单收起')
  await cleanup()
})

test('未连接：不显示实例切换器（仍是连接引导）', async () => {
  const { container, cleanup } = await renderPanel({ connected: false })
  assert.equal(container.querySelector('button[aria-haspopup="menu"]'), null)
  assert.match(container.textContent, /连接 FlareMo 实例/)
  assert.match(container.textContent, /生成配对码/)
  await cleanup()
})

test('切换器「添加实例」→ 连接引导带「返回工作台」，返回后回到三栏', async () => {
  const { container, settle, cleanup } = await renderPanel({ connected: true })

  const trigger = container.querySelector('button[aria-haspopup="menu"]')
  await act(async () => {
    trigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  const addRow = [...container.querySelectorAll('button[role="menuitem"]')].find((button) =>
    button.textContent.includes('添加实例'),
  )
  assert.ok(addRow, '菜单底部应有「添加实例」')
  await act(async () => {
    addRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await settle()

  assert.match(container.textContent, /返回工作台/)
  assert.ok(container.querySelector('input'), '添加实例应出现实例地址输入框')
  assert.ok(container.querySelector('button[aria-haspopup="menu"]'), '添加实例时切换器仍在')

  const back = [...container.querySelectorAll('button')].find((button) =>
    button.textContent.includes('返回工作台'),
  )
  await act(async () => {
    back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await settle()
  assert.match(container.textContent, /全部记录/)
  assert.match(container.textContent, /真实笔记：设备授权/)
  await cleanup()
})
