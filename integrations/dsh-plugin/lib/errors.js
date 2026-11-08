/**
 * 错误模型与 wire envelope。
 *
 * 规则（照 provider-studio 的 v1.2 envelope）：
 *  - 成功：`{ ok: true, ...payload }`；
 *  - 失败：`{ ok: false, code, message, params?, detail? }`，`code` 是稳定的机器码，
 *    client 用它映射文案；`message` 是给人看的兜底。
 *
 * 内部抛 `FlareMoError`，runtime 在方法边界统一转成 envelope，绝不把异常
 * 直接漏给 RPC（否则 client 只能看到 gateway 的 `gateway/internal`）。
 */

/** 稳定机器码。client 的 i18n 表用同一套 key（`err.<CODE>`）。 */
export const CODES = {
  /** 本地还没有连接（没配对过，或已断开）。 */
  NOT_CONNECTED: 'NOT_CONNECTED',
  /** 没有进行中的设备授权。 */
  NO_PENDING_CONNECT: 'NO_PENDING_CONNECT',
  /** 实例地址不合法。 */
  INVALID_INSTANCE_URL: 'INVALID_INSTANCE_URL',
  /** 设备授权已过期。 */
  CONNECT_EXPIRED: 'CONNECT_EXPIRED',
  /** 用户在 FlareMo 里拒绝了授权。 */
  CONNECT_DENIED: 'CONNECT_DENIED',
  /** access token 失效且 refresh 也失败：需要重新配对。 */
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  /** 网络层失败（DNS / 连接 / TLS）。 */
  NETWORK: 'NETWORK',
  /** 请求超时。 */
  TIMEOUT: 'TIMEOUT',
  /** 服务端返回了非 2xx 且没有更具体的 code。 */
  HTTP_ERROR: 'HTTP_ERROR',
  /** 服务端返回了无法解释的响应体。 */
  BAD_RESPONSE: 'BAD_RESPONSE',
  /** 只剩“参数不对”这类调用方问题。 */
  BAD_ARGS: 'BAD_ARGS',
  /** 宿主没有可用模型（没有 llm 服务，或没有配置 provider/model）。 */
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  /** 模型调用失败（网络 / provider 拒绝 / 被取消）。 */
  MODEL_FAILED: 'MODEL_FAILED',
  /** 模型输出不是我们要求的 JSON，或字段全空。 */
  MODEL_BAD_OUTPUT: 'MODEL_BAD_OUTPUT',
  /** 洞察任务没有可用的笔记（memo 被删 / tag 下无笔记）。 */
  INSIGHT_NO_NOTES: 'INSIGHT_NO_NOTES',
  /** 任务已经是终态（done / failed），本次跳过。 */
  INSIGHT_TERMINAL: 'INSIGHT_TERMINAL',
  /** 其它未归类异常（带 detail）。 */
  INTERNAL: 'INTERNAL',
}

/** 内部错误：带 code 和可选的 params（给 UI 做插值）。 */
export class FlareMoError extends Error {
  /**
   * @param {string} code - one of {@link CODES}.
   * @param {string} message - human-readable fallback.
   * @param {{ params?: Record<string, unknown>, detail?: string, status?: number }} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message)
    this.name = 'FlareMoError'
    this.code = code
    this.params = extra.params
    this.detail = extra.detail
    this.status = extra.status
  }
}

/** 成功 envelope。 */
export function ok(payload = {}) {
  return { ok: true, ...payload }
}

/** 失败 envelope。 */
export function fail(code, message, params) {
  return {
    ok: false,
    code,
    message,
    ...(params === undefined ? {} : { params }),
  }
}

/**
 * 把任意异常折成失败 envelope。
 * @param {unknown} error - thrown value.
 * @returns {{ ok: false, code: string, message: string, detail?: string }}
 */
export function failureFrom(error) {
  if (error instanceof FlareMoError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      ...(error.params === undefined ? {} : { params: error.params }),
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, code: CODES.INTERNAL, message, detail: message }
}
