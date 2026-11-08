/**
 * 连接状态持久化。
 *
 * 存哪：DSH 凭据服务的「记录」半区（`ctx.credentials.readRecord/modifyRecord`），
 * key 是 `<scope>/<id>` = `dsh-flaremo/default`，内容是 `{ kind: 'grant', payload }`。
 *
 * 为什么用 grant 记录而不是设置项：
 *  - payload 对凭据 seam 是**不透明**的，只有本插件能解释（正好放 refresh_token）；
 *  - `modifyRecord` 是唯一的写路径，且是“读-决定-替换”的独占更新，
 *    refresh_token 轮换时两个进程同时刷不会把先写的那份丢掉；
 *  - 设置文档只放引用、不放机密，token 不该进 settings。
 *
 * credentials 服务缺席时退化为进程内存（单测、headless 都能跑），并只警告一次。
 */

import { CODES } from './errors.js'
import { isRecord } from './util.js'

/** 记录 key：scope 必须是本插件注册名，id 是插件自己的寻址单位。 */
export const RECORD_KEY = 'dsh-flaremo/default'

/** payload 版本；读到别的版本当作“没有连接”，不尝试迁移。 */
export const STATE_VERSION = 1

/**
 * 去掉 undefined 键：凭据服务要求 grant payload 是能过 JSON 往返的值，
 * `undefined` 会让 `modifyRecord` 抛 TypeError（我们不想因为一个可选字段
 * 丢掉整份连接状态）。
 * @param {unknown} value - candidate payload.
 * @returns {unknown} a JSON-safe copy.
 */
export function toJsonValue(value) {
  // JSON 里数组的 undefined 会变成 null，这里保持同样的语义
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : toJsonValue(item)))
  if (isRecord(value)) {
    const out = {}
    for (const [key, nested] of Object.entries(value)) {
      if (nested !== undefined) out[key] = toJsonValue(nested)
    }
    return out
  }
  return value
}

export class ConnectionStore {
  /**
   * @param {{ get?: (name: string) => unknown, logger?: (name: string) => { warn?: Function } }} [ctx]
   */
  constructor(ctx) {
    this.ctx = ctx
    /** credentials 缺席时的进程内副本。 */
    this.memory = undefined
    this.warned = false
  }

  /** 可选依赖：拿不到 credentials 也不阻塞插件加载。 */
  credentials() {
    try {
      const value = typeof this.ctx?.get === 'function' ? this.ctx.get('credentials') : undefined
      return value !== null && typeof value === 'object' ? value : undefined
    } catch {
      return undefined
    }
  }

  warnOnce(message) {
    if (this.warned) return
    this.warned = true
    try {
      const logger = typeof this.ctx?.logger === 'function' ? this.ctx.logger('dsh-flaremo') : undefined
      logger?.warn?.(message)
    } catch {
      /* 日志不可用就安静降级 */
    }
  }

  /**
   * 读连接状态；没有记录 / 版本不符都返回 undefined。
   * @returns {Promise<object | undefined>} the persisted payload.
   */
  async read() {
    const credentials = this.credentials()
    if (credentials === undefined || typeof credentials.readRecord !== 'function') {
      this.warnOnce('credential store unavailable: FlareMo connection will not survive a restart')
      return this.memory
    }
    try {
      const record = await credentials.readRecord(RECORD_KEY)
      const payload = isRecord(record) ? record.payload : undefined
      if (!isRecord(payload) || payload.version !== STATE_VERSION) return this.memory
      return payload
    } catch {
      return this.memory
    }
  }

  /**
   * 整体替换连接状态。
   * @param {object} payload - JSON-serializable connection state.
   * @returns {Promise<void>} resolves once durably stored (or kept in memory).
   */
  async write(payload) {
    const next = toJsonValue({ ...payload, version: STATE_VERSION })
    this.memory = next
    const credentials = this.credentials()
    if (credentials === undefined || typeof credentials.modifyRecord !== 'function') {
      this.warnOnce('credential store unavailable: FlareMo connection will not survive a restart')
      return
    }
    try {
      await credentials.modifyRecord(RECORD_KEY, async () => ({ kind: 'grant', payload: next }))
    } catch {
      this.warnOnce('failed to persist FlareMo connection state')
    }
  }

  /** 断开：内存 + 凭据记录一起删。 */
  async clear() {
    this.memory = undefined
    const credentials = this.credentials()
    if (credentials === undefined || typeof credentials.deleteRecord !== 'function') return
    try {
      await credentials.deleteRecord(RECORD_KEY)
    } catch {
      /* 记录本就不存在时删除是 no-op，失败也不影响断开 */
    }
  }
}

/** 内部错误常量再导出，测试和 runtime 都能少 import 一层。 */
export { CODES }
