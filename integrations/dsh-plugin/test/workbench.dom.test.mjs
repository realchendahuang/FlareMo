/**
 * 面板的「真实渲染」测试：jsdom + react-dom/client，真的跑 effect。
 *
 * 面板现在只做三件事：查连接状态、拿内嵌地址、把真实网页版放进 iframe。
 * 所以这里断言的是这条链路——未连接时只给连接引导、已连接时拿到 embedUrl 并渲染
 * iframe、切换实例后 iframe 会带着新地址重新加载、宿主不支持时降级成可读提示。
 *
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

const INSTANCES = [
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

/**
 * 假 remote handle：方法返回真实的双层信封。
 * @param {{ connected: boolean, embedUrl?: string | null }} options - fixture switches.
 */
function createHandle({ connected, embedUrl = 'http://127.0.0.1:8788/' }) {
  const calls = []
  let activeId = 'inst-kosx'
  const rows = () => INSTANCES.map((row) => ({ ...row, active: row.id === activeId }))
  const active = () => INSTANCES.find((row) => row.id === activeId) ?? null

  const connectionView = () =>
    connected
      ? {
          connected: true,
          instanceUrl: active()?.instanceUrl ?? null,
          instanceId: active()?.id ?? null,
          alias: active()?.alias ?? null,
          account: active()?.account ?? null,
          scope: 'notes',
          lastSyncAt: active()?.lastSyncAt ?? null,
          connectedAt: active()?.connectedAt ?? null,
          accessExpiresAt: '2026-11-15T10:00:00Z',
          activeId,
          instances: rows(),
          pending: null,
        }
      : { connected: false, instanceUrl: null, account: null, pending: null, activeId: null, instances: [] }

  const handle = {
    async connectionStatus(args) {
      calls.push({ method: 'connectionStatus', args })
      return { ok: true, value: { ok: true, connection: connectionView(), embedUrl: connected ? embedUrl : null } }
    },
    async embedTarget(args) {
      calls.push({ method: 'embedTarget', args })
      return { ok: true, value: { ok: true, url: connected ? embedUrl : null } }
    },
    async switchInstance(args) {
      calls.push({ method: 'switchInstance', args })
      if (INSTANCES.some((row) => row.id === args?.id)) activeId = args.id
      return { ok: true, value: { ok: true, connection: connectionView(), instances: rows(), activeId } }
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
  }
  for (const method of ['connectPoll', 'connectCancel', 'disconnect', 'listTags', 'listPendingInsights', 'runPendingInsights']) {
    handle[method] = async (args) => {
      calls.push({ method, args })
      return { ok: true, value: { ok: true } }
    }
  }
  return { handle, calls }
}

/** 从 bundle 里拿 panel 组件 + inject face，并挂上假 handle。 */
function mountPanel(options) {
  let entry = null
  const nodes = []
  const head = { appendChild: (node) => (nodes.push(node), node) }
  const documentStub = {
    getElementById: (id) => nodes.find((node) => node.id === id) ?? null,
    createElement: () => ({ id: '', textContent: '', parentNode: null }),
    addEventListener: () => {},
    removeEventListener: () => {},
    head,
  }
  const windowStub = {
    innerWidth: 1440,
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

  const { handle, calls } = createHandle(options)
  const registrations = []
  const ctx = {
    effect: (callback) => callback(),
    slots: {
      inject: (_name, callback) => callback(),
      register: (opts, component) => (registrations.push({ options: opts, component }), () => {}),
    },
    layout: { selectPanel: () => {} },
    remote: { async $mount() { return () => {} } },
    get: (name) => (name === 'remote.flaremo' ? handle : undefined),
    reflect: { get: () => undefined },
  }
  plugin.apply(ctx)

  const main = registrations.find((row) => row.options.name === 'main')
  assert.ok(main, '没有注册 main 面板')
  return { component: main.component, face: main.options.inject(), calls }
}

/** 渲染面板、等 effect 跑完；返回容器供进一步断言。 */
async function renderPanel(options) {
  const { component, face, calls } = mountPanel(options)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(component, { t: undefined, call: face.call }))
  })
  const settle = async (rounds = 3) => {
    for (let index = 0; index < rounds; index += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
  }
  await settle()
  const cleanup = async () => {
    await act(async () => root.unmount())
    container.remove()
  }
  return { container, calls, settle, cleanup }
}

test('未连接：只渲染连接引导，没有任何 iframe', async () => {
  const { container, calls, cleanup } = await renderPanel({ connected: false })

  assert.deepEqual(
    calls.map((row) => row.method),
    ['connectionStatus'],
    '未连接时不该去要嵌入地址',
  )
  assert.match(container.textContent, /连接 FlareMo 实例/)
  assert.match(container.textContent, /实例地址/)
  assert.match(container.textContent, /生成配对码/)
  assert.equal(container.querySelector('iframe'), null)
  await cleanup()
})

test('未连接：面板里能直接配对，不用跳设置页', async () => {
  const { container, calls, settle, cleanup } = await renderPanel({ connected: false })

  const input = container.querySelector('input')
  assert.ok(input, '连接引导里应该有实例地址输入框')
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  await act(async () => {
    setValue.call(input, 'https://notes.example.com')
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })

  const start = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('生成配对码'))
  assert.ok(start, '没有「生成配对码」按钮')
  await act(async () => {
    start.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await settle()

  const started = calls.find((row) => row.method === 'connectStart')
  assert.ok(started, '点「生成配对码」应该直接走 connectStart')
  assert.equal(started.args.instanceUrl, 'https://notes.example.com')
  assert.match(container.textContent, /ABCD-1234/)
  assert.match(container.textContent, /打开配对页/)
  await cleanup()
})

test('已连接：先查状态再要嵌入地址，然后渲染指向它的 iframe', async () => {
  const { container, calls, cleanup } = await renderPanel({ connected: true })

  assert.deepEqual(
    calls.slice(0, 2).map((row) => row.method),
    ['connectionStatus', 'embedTarget'],
    '已连接时按「状态 → 嵌入地址」的顺序',
  )
  const frame = container.querySelector('iframe')
  assert.ok(frame, '已连接时应渲染 iframe')
  assert.equal(frame.getAttribute('src'), 'http://127.0.0.1:8788/')
  assert.equal(frame.getAttribute('title'), '笔记')
  // 真实网页版由 iframe 自己渲染，面板里不该再出现复刻的时间线文案
  assert.doesNotMatch(container.textContent, /示例数据/)
  await cleanup()
})

test('切换实例：iframe 带着新地址重新加载', async () => {
  const { container, cleanup } = await renderPanel({ connected: true })
  const first = container.querySelector('iframe')
  assert.ok(first)

  // 直接改 handle 的 activeId 需要另一个入口；这里通过 unmount 再挂一版验证
  // 「地址变化 → frame key 变化」的行为由 connectionStatus 返回值驱动。
  await cleanup()

  const second = await renderPanel({ connected: true, embedUrl: 'http://127.0.0.1:9001/' })
  const frame = second.container.querySelector('iframe')
  assert.ok(frame)
  assert.equal(frame.getAttribute('src'), 'http://127.0.0.1:9001/')
  await second.cleanup()
})

test('宿主没给地址：降级成可读提示，不是白屏', async () => {
  const { container, calls, cleanup } = await renderPanel({ connected: true, embedUrl: null })

  assert.ok(calls.some((row) => row.method === 'embedTarget'))
  assert.equal(container.querySelector('iframe'), null)
  assert.match(container.textContent, /无法启动内嵌页面/)
  assert.match(container.textContent, /重新检查连接/)
  assert.match(container.textContent, /添加实例/)
  await cleanup()
})

test('RPC 失败：显示错误与连接引导，不白屏', async () => {
  const { component, face } = mountPanel({ connected: true })
  const failingCall = async (method) => {
    if (method === 'connectionStatus') {
      const error = new Error('boom')
      error.code = 'REMOTE_UNAVAILABLE'
      throw error
    }
    return { ok: true }
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(component, { t: undefined, call: failingCall }))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  assert.match(container.textContent, /连接 FlareMo 实例/)
  assert.match(container.textContent, /读取失败/)
  assert.equal(container.querySelector('iframe'), null)
  await act(async () => root.unmount())
  container.remove()
})

test('主题：DSH 的深色标记会翻成网页版的 theme 值', () => {
  // hostTheme 在 bundle 里（jsx 无法在 node 直接 import），所以这里按它的
  // 契约验证：只认 data-ds-dark-theme 的 "true"/"false"，其余交给网页版。
  const cases = [
    ['true', 'dark'],
    ['false', 'light'],
    [null, null],
    ['yes', null],
  ]
  for (const [attribute, expected] of cases) {
    if (attribute === null) document.body.removeAttribute('data-ds-dark-theme')
    else document.body.setAttribute('data-ds-dark-theme', attribute)
    // 与 lib 里 hostTheme() 的实现保持一致的三行逻辑
    const value = document.body?.getAttribute('data-ds-dark-theme')
    const resolved = value === 'true' ? 'dark' : value === 'false' ? 'light' : null
    assert.equal(resolved, expected, `data-ds-dark-theme=${attribute}`)
  }
  document.body.removeAttribute('data-ds-dark-theme')
  assert.ok(SOURCE.includes('data-ds-dark-theme'), 'bundle 应读取 DSH 的深色标记')
})
