/**
 * 极薄的 fetch 封装：超时、JSON、错误归一化。
 *
 * 这一层只负责“把一次 HTTP 调用变成 { status, body } 或 FlareMoError”，
 * 不关心 FlareMo 语义（那些在 lib/flaremo-client.js）。
 * fetch 可注入，测试里换成一个返回 `Response` 的假函数即可。
 */

import { CODES, FlareMoError } from './errors.js'
import { errorMessage } from './util.js'

/** 默认超时：设备授权/数据请求都不该让面板卡太久。 */
export const DEFAULT_TIMEOUT_MS = 15_000

/** 拼 query：跳过 undefined/null/空串。 */
function buildUrl(url, query) {
  if (query === undefined || query === null) return url
  const target = new URL(url)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    target.searchParams.set(key, String(value))
  }
  return target.toString()
}

export class HttpClient {
  /**
   * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, clock?: () => number }} [options]
   */
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.clock = options.clock ?? (() => Date.now())
  }

  /**
   * 发一次请求并把响应体解析成 JSON（解析失败时 body 为 undefined）。
   * 不按状态码抛错：调用方需要看到 400 里的 `{ error }`。
   * @param {string} url - absolute URL.
   * @param {{ method?: string, query?: Record<string, unknown>, body?: unknown,
   *   headers?: Record<string, string>, timeoutMs?: number, signal?: AbortSignal }} [options]
   * @returns {Promise<{ status: number, ok: boolean, body: unknown, text: string }>}
   */
  async request(url, options = {}) {
    const fetchImpl = this.fetchImpl
    if (typeof fetchImpl !== 'function') {
      throw new FlareMoError(CODES.NETWORK, '当前宿主没有可用的 fetch 实现')
    }

    const target = buildUrl(url, options.query)
    const controller = new AbortController()
    const timeoutMs = options.timeoutMs ?? this.timeoutMs
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const onOuterAbort = () => controller.abort()
    if (options.signal !== undefined) {
      if (options.signal.aborted) controller.abort()
      else options.signal.addEventListener('abort', onOuterAbort, { once: true })
    }

    const headers = {
      accept: 'application/json',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.headers ?? {}),
    }

    let response
    try {
      response = await fetchImpl(target, {
        method: options.method ?? 'GET',
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: controller.signal,
        redirect: 'follow',
      })
    } catch (error) {
      if (timedOut) {
        throw new FlareMoError(CODES.TIMEOUT, `请求 ${target} 超时（${timeoutMs}ms）`, { detail: target })
      }
      if (options.signal !== undefined && options.signal.aborted) {
        throw new FlareMoError(CODES.NETWORK, '请求已取消', { detail: target })
      }
      throw new FlareMoError(CODES.NETWORK, `请求 ${target} 失败：${errorMessage(error)}`, { detail: target })
    } finally {
      clearTimeout(timer)
      if (options.signal !== undefined) options.signal.removeEventListener('abort', onOuterAbort)
    }

    let text = ''
    try {
      text = await response.text()
    } catch {
      text = ''
    }

    let body
    if (text !== '') {
      try {
        body = JSON.parse(text)
      } catch {
        body = undefined
      }
    }

    return { status: response.status, ok: response.ok, body, text }
  }
}
