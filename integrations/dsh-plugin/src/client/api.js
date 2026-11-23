/**
 * Client 侧的 Typert Remote 封装。
 *
 * 三件事：
 *  1. `ctx.remote.$mount({ package, descriptors })` 挂载 host 的 manifest；
 *  2. 从 `ctx.get('remote.<namespace>')` 取命名空间句柄（$mount 完成后才有）；
 *  3. 把两层信封拆成 payload：wire 层是 `{ ok, value }`（或 `{ ok:false, error }`），
 *     业务层是 `{ ok:true, ...payload }` / `{ ok:false, code, message }`。
 *
 * 失败统一抛 ApiError（带稳定 code），UI 用 `err.<CODE>` 查词典，查不到再退回 message。
 */

import { INVOCATIONS, PACKAGE, SERVICE_KEY } from '../../contract.js'

/** 本地（不是 host 返回）的失败码。 */
export const CLIENT_CODES = {
  UNAVAILABLE: 'REMOTE_UNAVAILABLE',
}

export class ApiError extends Error {
  /**
   * @param {string} code - stable machine code (host `code` or CLIENT_CODES).
   * @param {string} message - human fallback.
   * @param {Record<string, unknown>} [params] - interpolation values.
   */
  constructor(code, message, params) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.params = params
  }
}

/** 把任意异常折成 ApiError。 */
export function asApiError(error) {
  if (error instanceof ApiError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new ApiError('INTERNAL', message)
}

/** 从 Cordis 上下文里取命名空间句柄（$mount 把它注册成 `remote.<namespace>`）。 */
function pickRemoteHandle(ctx) {
  const key = `remote.${SERVICE_KEY}`
  try {
    if (typeof ctx.get === 'function') {
      const found = ctx.get(key)
      if (found !== undefined && found !== null) return found
    }
  } catch {
    /* 不是普通 service key 时继续用 reflect */
  }
  try {
    if (ctx.reflect !== undefined && typeof ctx.reflect.get === 'function') {
      const found = ctx.reflect.get(key)
      if (found !== undefined && found !== null) return found
    }
  } catch {
    /* reflect 也可能不暴露 */
  }
  return null
}

export class ClientApi {
  constructor() {
    /** @type {object | null} */
    this.handle = null
    /** @type {Promise<() => void> | null} */
    this.mountPromise = null
  }

  /** 是否已挂载（handle 拿到与否决定 UI 走 RPC 还是降级）。 */
  get mounted() {
    return this.handle !== null
  }

  /**
   * 挂载命名空间。可重复调用：只会真的 mount 一次。
   * @param {import('@deepseek-ai/cordis').Context} ctx - client plugin context.
   * @returns {Promise<() => void>} disposer.
   */
  mount(ctx) {
    if (this.mountPromise !== null) return this.mountPromise
    this.mountPromise = (async () => {
      const dispose = await ctx.remote.$mount({
        package: PACKAGE,
        descriptors: INVOCATIONS,
      })
      this.handle = pickRemoteHandle(ctx)
      return () => {
        this.handle = null
        this.mountPromise = null
        try {
          Promise.resolve(dispose()).catch(() => {})
        } catch {
          /* 卸载阶段的失败不该冒泡到 shell */
        }
      }
    })()
    return this.mountPromise
  }

  /**
   * 调一个 wire 方法并返回业务 payload。
   * 如果 mount 还在进行中会先等它（首次渲染时 panel 通常早于 mount 完成）。
   * @param {string} method - one of METHODS in contract.js.
   * @param {object} [args] - args object (always one `args` parameter on the wire).
   * @returns {Promise<object>} the business payload (envelope minus `ok`).
   */
  async call(method, args) {
    if (this.mountPromise !== null) {
      try {
        await this.mountPromise
      } catch {
        /* mount 失败时下面会以 REMOTE_UNAVAILABLE 报出来 */
      }
    }
    const handle = this.handle
    if (handle === null || typeof handle[method] !== 'function') {
      throw new ApiError(CLIENT_CODES.UNAVAILABLE, 'FlareMo 服务还没挂载')
    }

    let reply
    try {
      reply = await handle[method](args ?? {})
    } catch (error) {
      throw asApiError(error)
    }
    if (reply === null || typeof reply !== 'object' || reply.ok !== true) {
      const failure = reply !== null && typeof reply === 'object' ? reply.error : undefined
      throw new ApiError(
        typeof failure?.code === 'string' ? failure.code : 'GATEWAY_ERROR',
        typeof failure?.message === 'string' ? failure.message : 'FlareMo 调用失败',
      )
    }

    const envelope = reply.value
    if (envelope === null || typeof envelope !== 'object' || typeof envelope.ok !== 'boolean') {
      throw new ApiError('BAD_RESPONSE', 'FlareMo 返回了无法识别的结果')
    }
    if (envelope.ok === false) {
      throw new ApiError(
        typeof envelope.code === 'string' ? envelope.code : 'INTERNAL',
        typeof envelope.message === 'string' ? envelope.message : 'FlareMo 返回了失败',
        envelope.params,
      )
    }
    return envelope
  }
}
