/**
 * 无依赖的小工具。Host 半片只在这里做纯函数，方便测试。
 */

/** @returns {boolean} 是否为普通对象（排除 null / 数组）。 */
export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 取字符串，非字符串返回空串。 */
export function asText(value) {
  return typeof value === 'string' ? value : ''
}

/** 把未知值折成一段可读的文本（错误消息用）。 */
export function errorMessage(error) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/** 去掉末尾斜杠；返回 undefined 表示不是合法 URL。 */
export function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, '')
}

/**
 * 校验并规范化用户填的实例地址。
 * 只接受 http/https，去掉 query/hash 与末尾斜杠；其它一律返回 undefined，
 * 由调用方转成 INVALID_INSTANCE_URL 错误（不在这里抛，便于单测）。
 * @param {unknown} raw - 用户输入。
 * @returns {string | undefined} 规范化后的 origin（可能带 path 前缀）。
 */
export function normalizeInstanceUrl(raw) {
  const text = asText(raw).trim()
  if (text === '') return undefined
  let url
  try {
    url = new URL(text)
  } catch {
    try {
      url = new URL(`https://${text}`)
    } catch {
      return undefined
    }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (url.username !== '' || url.password !== '') return undefined
  const path = trimTrailingSlash(url.pathname)
  return `${url.protocol}//${url.host}${path === '' ? '' : path}`
}

/**
 * 把数字夹到 [min, max]，非法值返回 fallback。
 * @param {unknown} value - 候选值。
 * @param {number} min - 下界。
 * @param {number} max - 上界。
 * @param {number} fallback - 非法时的返回值。
 * @returns {number} 夹取后的整数。
 */
export function clampInt(value, min, max, fallback) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(number)))
}

/** 截断文本，超长加省略号。 */
export function truncate(text, limit) {
  const value = asText(text)
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`
}

/** 当前 ISO 时间。 */
export function nowIso(clock) {
  return new Date(clock()).toISOString()
}

/** 距某个 ISO 时间还有多少毫秒（已过期返回 <=0）。 */
export function millisUntil(iso, clock) {
  const target = Date.parse(asText(iso))
  if (!Number.isFinite(target)) return 0
  return target - clock()
}
