/**
 * dsh-flaremo — Client 半片入口（浏览器侧）。
 *
 * 三件装配：
 *  1. 注入样式与词典（locale 缺席时退回内置中文）；
 *  2. 挂载 host 的 Typert Remote 命名空间（`ctx.remote.$mount`），拿到
 *     `ctx.get('remote.flaremo')` 句柄；所有数据都经它走，client 不碰 token；
 *  3. 注册三个席位：
 *       ① 中栏全局面板（`main` keyed slot，key='flaremo'）→ 工作台
 *       ② 左栏入口行（`sidebar.panellist`，id='flaremo'，order=5）
 *       ③ 设置页 section（`settings.section`，id='dsh-flaremo'）→ 连接配置
 *
 * 两套 inject 不要混：
 *   - package.json 的 `dsh.client.inject` 列「客户端插件包」（bundle 加载顺序）；
 *   - 这里的 `export const inject` 列「Cordis 运行时服务」（缺一个插件休眠）。
 */

import React from 'react'

import { ClientApi } from './api.js'
import { EN, NS, ZH, fallbackT } from './i18n.js'
import { FlareMoIcon } from './icons.jsx'
import { SettingsSection } from './settings.jsx'
import { CSS } from './styles.js'
import { Workbench } from './workbench.jsx'

/** 包名；构建脚本会拿 package.json 的 name 做 `__ModuleLoader__.load({ id })`。 */
export const name = 'dsh-flaremo'

/** 运行时服务依赖：slots / locale / layout 是席位，remote 是 RPC 载体。 */
export const inject = ['slots', 'locale', 'layout', 'remote']

/** 面板 key 与左栏行 id 必须是同一个字符串。 */
const PANEL_ID = 'flaremo'

const STYLE_ID = 'dsh-flaremo-styles'

/**
 * 注入插件自己的 <style>。DSH 的 Web 前端没有 CSP，官方插件都用这招；
 * 这里只放内联表达不了的伪类（hover / focus-visible / ::placeholder / 滚动条）。
 * @returns {() => void} disposer.
 */
function adoptStyles() {
  if (typeof document === 'undefined') return () => {}
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) {
    existing.textContent = CSS
    return () => {}
  }
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
  return () => {
    if (style.parentNode !== null) style.parentNode.removeChild(style)
  }
}

/**
 * Client plugin apply.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the client plugin context.
 */
export function apply(ctx) {
  // ── 词典 + 翻译器 ────────────────────────────────────────────────
  let localeReady = false
  let t = fallbackT
  if (ctx.locale !== undefined && ctx.locale !== null) {
    try {
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'dsh-flaremo: locale')
      t = ctx.locale.bind(NS)
      localeReady = true
    } catch {
      localeReady = false
    }
  }

  ctx.effect(adoptStyles, 'dsh-flaremo: styles')

  // ── Typert Remote：挂载 host 的命名空间 ──────────────────────────
  const api = new ClientApi()
  ctx.effect(() => {
    let live = true
    let release = null
    void (async () => {
      try {
        const dispose = await api.mount(ctx)
        if (!live) {
          dispose()
          return
        }
        release = dispose
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[dsh-flaremo] failed to mount the Remote namespace', error)
      }
    })()
    return () => {
      live = false
      if (release !== null) release()
    }
  }, 'dsh-flaremo: remote')

  /** 给组件用的调用入口；未挂载时会抛 ApiError(REMOTE_UNAVAILABLE)。 */
  const call = (method, args) => api.call(method, args)

  const openConversation = () => {
    try {
      ctx.layout.selectPanel(null)
    } catch {
      /* 布局服务不可用时什么都不做：这只是个便利按钮 */
    }
  }

  // ── ① 中栏全局面板 ──────────────────────────────────────────────
  const panelOptions = {
    name: 'main',
    key: PANEL_ID,
    inject: () => ({ call, openConversation }),
  }
  if (localeReady) panelOptions.locale = NS
  ctx.slots.inject('main', () => ctx.slots.register(panelOptions, Workbench))

  // ── ② 左栏入口行 ────────────────────────────────────────────────
  const rowOptions = {
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 5,
    label: () => {
      try {
        const text = t('panel')
        return typeof text === 'string' && text !== '' && text !== 'panel' ? text : fallbackT('panel')
      } catch {
        return fallbackT('panel')
      }
    },
  }
  if (localeReady) rowOptions.locale = NS
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(rowOptions, FlareMoIcon))

  // ── ③ 设置页 section：实例地址 + 配对码 + 连接状态 ─────────────
  const settingsOptions = {
    name: 'settings.section',
    id: 'dsh-flaremo',
    order: 40,
    label: () => {
      try {
        const text = t('settingsNav')
        return typeof text === 'string' && text !== '' && text !== 'settingsNav' ? text : fallbackT('settingsNav')
      } catch {
        return fallbackT('settingsNav')
      }
    },
  }
  if (localeReady) settingsOptions.locale = NS
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(settingsOptions, (props) => React.createElement(SettingsSection, { ...props, t, call })),
  )
}
