/**
 * Client 半片测试：加载器契约、三个 slot 注册、Remote 挂载、组件渲染、RPC 信封。
 *
 * 不装 DSH、不开浏览器：
 *  - bundle 用 node:vm 跑，`window.__ModuleLoader__` 是假的；
 *  - React 用真的（devDependency），渲染用 `react-dom/server`（不跑 effect，
 *    所以断言的是「首帧外壳」；数据加载逻辑在 notes/markdown/api 的单测里覆盖）；
 *  - RPC 用假的 ctx.remote + 假 handle。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { METHODS, PACKAGE } from '../contract.js'

const require = createRequire(import.meta.url)
const SOURCE = readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8')

/** 假 React 之外的加载器环境：记录 <style> 节点。 */
function loadPlugin() {
  let entry = null
  const nodes = []
  const head = {
    appendChild(node) {
      nodes.push(node)
      return node
    },
  }
  const documentStub = {
    getElementById(id) {
      return nodes.find((node) => node.id === id) ?? null
    },
    createElement() {
      return { id: '', textContent: '', parentNode: null }
    },
    head,
  }
  const windowStub = {
    innerWidth: 1440,
    __ModuleLoader__: {
      load(row) {
        entry = row
      },
    },
  }
  vm.runInNewContext(
    SOURCE,
    { window: windowStub, document: documentStub, console, setTimeout, clearTimeout, setInterval, clearInterval },
    { filename: 'dist/client.js' },
  )
  assert.ok(entry !== null, 'dist/client.js 必须调用 window.__ModuleLoader__.load(...)')
  return { entry, exports: entry.factory(require), nodes }
}

/** 假 remote handle：每个方法返回成功的双层信封。 */
function createHandle(overrides = {}) {
  const handle = {}
  for (const method of METHODS) {
    handle[method] = async () => ({ ok: true, value: { ok: true } })
  }
  handle.connectionStatus = async () => ({
    ok: true,
    value: { ok: true, connection: { connected: false, instanceUrl: null, pending: null, account: null } },
  })
  return Object.assign(handle, overrides)
}

/**
 * 假 Cordis 上下文：只实现 apply 用到的面。
 * @param {{ withLocale?: boolean, handle?: object }} [options]
 */
function createContext(options = {}) {
  const registrations = []
  const calls = { selectPanel: [], effects: [] }
  const mounts = []
  const state = { handle: options.handle ?? createHandle() }

  const ctx = {
    effect(callback, label) {
      calls.effects.push(label ?? '')
      const dispose = callback()
      return dispose
    },
    slots: {
      inject(_name, callback) {
        return callback()
      },
      register(slotOptions, component) {
        registrations.push({ options: slotOptions, component })
        return () => {}
      },
    },
    layout: {
      selectPanel(id) {
        calls.selectPanel.push(id)
      },
    },
    remote: {
      async $mount({ package: packageName, descriptors }) {
        mounts.push({ package: packageName, descriptors })
        return () => {}
      },
    },
    get(name) {
      return name === 'remote.flaremo' ? state.handle : undefined
    },
    reflect: {
      get() {
        return undefined
      },
    },
  }

  if (options.withLocale !== false) {
    const dictionaries = {}
    ctx.locale = {
      register(namespace, dict) {
        dictionaries[namespace] = dict
        return () => {}
      },
      bind(namespace) {
        return (key) => dictionaries[namespace]?.zh?.[key] ?? key
      },
    }
  }

  return { ctx, registrations, calls, mounts, state }
}

/** 等一个微任务轮次，让 mount 完成。 */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function registrationOf(registrations, name) {
  const found = registrations.find((row) => row.options.name === name)
  assert.ok(found, `没有注册 ${name}`)
  return found
}

test('bundle 调用加载器，id 与包名一致', () => {
  const { entry, exports } = loadPlugin()
  assert.equal(entry.id, 'dsh-flaremo')
  assert.equal(typeof entry.factory, 'function')
  assert.equal(exports.name, 'dsh-flaremo')
  assert.deepEqual([...exports.inject], ['slots', 'locale', 'layout', 'remote'])
  assert.equal(typeof exports.apply, 'function')
})

test('apply 注册 main 面板 / sidebar 行 / settings section 三个席位', async () => {
  const { exports } = loadPlugin()
  const { ctx, registrations, calls } = createContext()
  exports.apply(ctx)
  await flush()

  assert.equal(registrations.length, 3)

  const main = registrationOf(registrations, 'main')
  assert.equal(main.options.key, 'flaremo')
  assert.equal(main.options.locale, 'flaremo')
  assert.equal(typeof main.component, 'function')
  const face = main.options.inject()
  assert.equal(typeof face.call, 'function', '面板需要通过 inject 拿到 RPC call')
  assert.equal(typeof face.openConversation, 'function')
  face.openConversation()
  assert.deepEqual(calls.selectPanel, [null])

  const sidebar = registrationOf(registrations, 'sidebar.panellist')
  assert.equal(sidebar.options.id, 'flaremo')
  assert.equal(sidebar.options.order, 5)
  assert.equal(sidebar.options.locale, 'flaremo')
  assert.equal(sidebar.options.label(), '笔记')
  assert.equal(typeof sidebar.component, 'function')

  const settings = registrationOf(registrations, 'settings.section')
  assert.equal(settings.options.id, 'dsh-flaremo')
  assert.equal(settings.options.order, 40)
  assert.equal(settings.options.label(), 'FlareMo 连接')
  assert.equal(typeof settings.component, 'function')
})

test('apply 通过 ctx.remote.$mount 挂载 host 命名空间', async () => {
  const { exports } = loadPlugin()
  const { ctx, mounts } = createContext()
  exports.apply(ctx)
  await flush()

  assert.equal(mounts.length, 1)
  assert.equal(mounts[0].package, PACKAGE)
  assert.equal(mounts[0].descriptors.length, METHODS.length)
  // bundle 在 vm 的另一个 realm 里，先搬回当前 realm 再比较
  assert.deepEqual(
    Array.from(mounts[0].descriptors, (row) => row.method),
    METHODS,
  )
})

test('apply 注入自己的样式表', () => {
  const { exports, nodes } = loadPlugin()
  const { ctx } = createContext()
  exports.apply(ctx)

  const style = nodes.find((node) => node.id === 'dsh-flaremo-styles')
  assert.ok(style, '没有找到 <style id="dsh-flaremo-styles">')
  assert.match(style.textContent, /\.dsh-flaremo-root/)
  // Ember token（与 FlareMo 网页端同一套）：亮色墨色 + 纸纹 + 火焰主色。
  assert.match(style.textContent, /--fm-foreground:/)
  assert.match(style.textContent, /--fm-brand-500:/)
  assert.match(style.textContent, /--fm-grain:/)
  // 组件造型走 class（按钮/卡片/输入框），深色由 DSH 的 data-ds-dark-theme 驱动。
  assert.match(style.textContent, /\.fm-btn/)
  assert.match(style.textContent, /body\[data-ds-dark-theme\] \.dsh-flaremo-root/)
})

test('左栏图标组件按 size 渲染', () => {
  const { exports } = loadPlugin()
  const { ctx, registrations } = createContext()
  exports.apply(ctx)

  const sidebar = registrationOf(registrations, 'sidebar.panellist')
  const html = renderToStaticMarkup(React.createElement(sidebar.component, { size: 16, active: false }))
  assert.match(html, /<svg/)
  assert.match(html, /width="16"/)
})

test('工作台首帧：未连接时只渲染连接引导，不放示例数据', () => {
  const { exports } = loadPlugin()
  const { ctx, registrations } = createContext()
  exports.apply(ctx)
  const main = registrationOf(registrations, 'main')

  const html = renderToStaticMarkup(React.createElement(main.component, { t: undefined }))
  // SSR 不跑 effect，所以停在「还没拿到连接状态」的首帧；外壳必须在。
  assert.match(html, /dsh-flaremo-root/)
  assert.doesNotMatch(html, /示例数据/)
  assert.doesNotMatch(html, /<iframe/)
})

test('设置页首帧渲染出连接表单（未连接）', () => {
  const { exports } = loadPlugin()
  const { ctx, registrations } = createContext()
  exports.apply(ctx)
  const settings = registrations.find((row) => row.options.name === 'settings.section')
  const html = renderToStaticMarkup(React.createElement(settings.component, { t: undefined }))

  assert.match(html, /FlareMo 连接/)
  assert.match(html, /实例地址/)
  assert.match(html, /读取连接状态/) // SSR 不跑 effect，停在加载态
})

test('locale 服务缺失时 apply 仍注册，label 退回中文', () => {
  const { exports } = loadPlugin()
  const { ctx, registrations } = createContext({ withLocale: false })
  exports.apply(ctx)

  const sidebar = registrationOf(registrations, 'sidebar.panellist')
  assert.equal(sidebar.options.label(), '笔记')
  const main = registrationOf(registrations, 'main')
  assert.equal(main.options.locale, undefined, '没有 locale 服务时不要声明 locale')
})

test('RPC 信封：成功拆两层、失败带 code 抛错、未挂载给 REMOTE_UNAVAILABLE', async () => {
  const { ClientApi, ApiError } = await import('../src/client/api.js')

  const handle = createHandle({
    listNotes: async () => ({ ok: true, value: { ok: true, notes: [{ id: 'm1' }] } }),
    getNote: async () => ({ ok: true, value: { ok: false, code: 'NOT_CONNECTED', message: 'no' } }),
    disconnect: async () => ({ ok: false, error: { code: 'gateway/internal', message: 'boom' } }),
  })
  const { ctx } = createContext({ handle })
  const api = new ClientApi()
  await api.mount(ctx)

  const listed = await api.call('listNotes', { pageSize: 1 })
  assert.deepEqual(listed.notes, [{ id: 'm1' }])

  await assert.rejects(
    () => api.call('getNote', { id: 'x' }),
    (error) => error instanceof ApiError && error.code === 'NOT_CONNECTED',
  )

  await assert.rejects(
    () => api.call('disconnect', {}),
    (error) => error instanceof ApiError && error.code === 'gateway/internal',
  )

  // 没挂载过的实例：本地直接给 REMOTE_UNAVAILABLE
  const bare = new ClientApi()
  await assert.rejects(
    () => bare.call('connectionStatus', {}),
    (error) => error instanceof ApiError && error.code === 'REMOTE_UNAVAILABLE',
  )
})

test('词典：多实例 key 与失败码在 zh / en 两侧齐全、数量相等', async () => {
  const { ZH, EN } = await import('../src/client/i18n.js')
  const keys = [
    'instances',
    'instancesEmpty',
    'instanceActive',
    'switchInstance',
    'addInstance',
    'backToWorkbench',
    'renameInstance',
    'removeInstance',
    'removeInstanceConfirm',
    'instanceAlias',
    'instanceAliasHint',
    'cancel',
    'save',
    'aliasInvalid',
    'aliasTaken',
    'instanceNotConnected',
  ]
  for (const key of keys) {
    assert.equal(typeof ZH[key], 'string', `zh 缺少 ${key}`)
    assert.equal(typeof EN[key], 'string', `en 缺少 ${key}`)
  }
  for (const code of ['INSTANCE_NOT_FOUND', 'ALIAS_TAKEN', 'INVALID_ALIAS', 'MODEL_UNAVAILABLE', 'MODEL_FAILED', 'MODEL_BAD_OUTPUT', 'INSIGHT_NO_NOTES', 'INSIGHT_TERMINAL']) {
    assert.equal(typeof ZH[`err.${code}`], 'string', `zh 缺少 err.${code}`)
    assert.equal(typeof EN[`err.${code}`], 'string', `en 缺少 err.${code}`)
  }
  assert.deepEqual(Object.keys(ZH).sort(), Object.keys(EN).sort(), 'zh / en key 必须一一对应')
})
