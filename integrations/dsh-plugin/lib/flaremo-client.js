/**
 * FlareMo HTTP 客户端（Host 侧）。
 *
 * 只做“FlareMo 语义 → 结构化结果/FlareMoError”的翻译：
 *  - 设备授权三个端点：/connect/device、/connect/token（两种 grant）；
 *  - 数据面：/api/app/me、/api/app/memos（列表 / 新建）、/api/app/memos/{id}、
 *    /api/app/tags、/api/app/stats。
 *
 * token 只在这层和 connection 层之间流动，永远不会进 RPC 返回值。
 */

import { CODES, FlareMoError } from './errors.js'
import { asText, errorMessage, isRecord, truncate } from './util.js'

/**
 * 从错误响应体里尽量取一个机器码。FlareMo 有两种错误体：
 *  - 设备授权端点（RFC 8628）：`{ error: "authorization_pending", error_description }`
 *  - `/api/app/*`（DomainError）：`{ error: { message: "..." } }`
 * 这里只取“字符串形态”的 code；对象形态没有机器码，由调用方用 HTTP 状态兜底。
 */
function wireCode(body) {
  if (!isRecord(body)) return undefined
  const code = asText(body.error)
  return code === '' ? undefined : code
}

/** 从错误响应体里尽量取一段描述（两种形态都兼容）。 */
function wireMessage(body) {
  if (!isRecord(body)) return undefined
  const description =
    asText(body.error_description) || asText(body.message) || asText(isRecord(body.error) ? body.error.message : undefined)
  return description === '' ? undefined : description
}

export class FlareMoClient {
  /**
   * @param {{ http: import('./http.js').HttpClient, clock?: () => number }} options
   */
  constructor(options) {
    this.http = options.http
    this.clock = options.clock ?? (() => Date.now())
  }

  /** 认证头。 */
  static bearer(accessToken) {
    return { authorization: `Bearer ${accessToken}` }
  }

  /** 设备授权第一步：申请 device_code / user_code。 */
  async startDeviceAuthorization(instanceUrl, { clientName, scopes } = {}) {
    const response = await this.http.request(`${instanceUrl}/connect/device`, {
      method: 'POST',
      body: {
        client_name: clientName ?? 'DeepSeek Harness',
        client_type: 'device',
        ...(Array.isArray(scopes) && scopes.length > 0 ? { scopes } : {}),
      },
    })
    if (!response.ok) throw this.endpointFailure('申请配对码', response)
    const body = response.body
    if (!isRecord(body) || asText(body.device_code) === '' || asText(body.user_code) === '') {
      throw new FlareMoError(CODES.BAD_RESPONSE, '实例返回的配对响应缺少 device_code / user_code')
    }
    return {
      deviceCode: asText(body.device_code),
      userCode: asText(body.user_code),
      verificationUri: asText(body.verification_uri),
      verificationUriComplete: asText(body.verification_uri_complete) || asText(body.verification_uri),
      expiresInSeconds: Number(body.expires_in) > 0 ? Number(body.expires_in) : 300,
      intervalSeconds: Number(body.interval) > 0 ? Number(body.interval) : 5,
    }
  }

  /** 设备授权第二步：把 device_code 换成 token。未批准时抛 `authorization_pending`。 */
  async exchangeDeviceCode(instanceUrl, deviceCode) {
    const response = await this.http.request(`${instanceUrl}/connect/token`, {
      method: 'POST',
      body: {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
      },
    })
    if (!response.ok) throw this.endpointFailure('兑换访问令牌', response)
    return this.tokenPayload(response.body)
  }

  /** refresh_token 轮换：旧的立刻失效，必须保存新的这一对。 */
  async refresh(instanceUrl, refreshToken) {
    const response = await this.http.request(`${instanceUrl}/connect/token`, {
      method: 'POST',
      body: { grant_type: 'refresh_token', refresh_token: refreshToken },
    })
    if (!response.ok) throw this.endpointFailure('刷新访问令牌', response)
    return this.tokenPayload(response.body)
  }

  /** 当前账号（用于显示“已连接为谁”）。失败返回 undefined，不影响连接成功。 */
  async getAccount(instanceUrl, accessToken) {
    try {
      const response = await this.http.request(`${instanceUrl}/api/app/me`, {
        headers: FlareMoClient.bearer(accessToken),
      })
      if (!response.ok || !isRecord(response.body)) return undefined
      const body = response.body
      return {
        id: asText(body.id),
        name: asText(body.name) || asText(body.username) || asText(body.id),
        username: asText(body.username) || undefined,
        email: asText(body.email) || undefined,
        avatarUrl: asText(body.avatar_url) || undefined,
        role: asText(body.role) || undefined,
      }
    } catch {
      return undefined
    }
  }

  /** GET /api/app/memos —— 列表 / 搜索 / 按标签过滤共用这一个端点。 */
  async listMemos(instanceUrl, accessToken, query = {}) {
    const response = await this.http.request(`${instanceUrl}/api/app/memos`, {
      headers: FlareMoClient.bearer(accessToken),
      query: {
        page_size: query.pageSize,
        page_token: query.pageToken,
        order_by: query.orderBy,
        q: query.q,
        tag: query.tag,
        state: query.state,
        visibility: query.visibility,
      },
    })
    if (response.status === 401) throw this.unauthorized(response)
    if (!response.ok) throw this.dataFailure('读取笔记列表', response)
    const body = response.body
    if (!isRecord(body) || !Array.isArray(body.memos)) {
      throw new FlareMoError(CODES.BAD_RESPONSE, '笔记列表响应缺少 memos 数组')
    }
    return {
      memos: body.memos.filter(isRecord),
      nextPageToken: asText(body.next_page_token) || undefined,
    }
  }

  /**
   * POST /api/app/memos —— 新建便签。
   * 服务端成功返回 201 + MemoDto（直接是笔记对象，不再包一层）。
   * @param {string} instanceUrl - instance origin.
   * @param {string} accessToken - bearer token.
   * @param {{ content: string, visibility: string, source: string }} body - create body.
   * @returns {Promise<object>} the created MemoDto.
   */
  async createMemo(instanceUrl, accessToken, body) {
    const response = await this.http.request(`${instanceUrl}/api/app/memos`, {
      method: 'POST',
      headers: FlareMoClient.bearer(accessToken),
      body,
    })
    if (response.status === 401) throw this.unauthorized(response)
    if (!response.ok) throw this.dataFailure('新建笔记', response)
    const dto = response.body
    if (!isRecord(dto) || asText(dto.id) === '') {
      throw new FlareMoError(CODES.BAD_RESPONSE, '新建笔记响应缺少笔记对象')
    }
    return dto
  }

  /** GET /api/app/memos/{bareId} —— 详情 + 关系 / 反链。 */
  async getMemo(instanceUrl, accessToken, memoId) {
    const id = asText(memoId).trim()
    if (id === '') throw new FlareMoError(CODES.BAD_ARGS, '缺少笔记 id')
    const response = await this.http.request(`${instanceUrl}/api/app/memos/${encodeURIComponent(id)}`, {
      headers: FlareMoClient.bearer(accessToken),
    })
    if (response.status === 401) throw this.unauthorized(response)
    if (!response.ok) throw this.dataFailure('读取笔记详情', response)
    const body = response.body
    if (!isRecord(body) || !isRecord(body.memo)) {
      throw new FlareMoError(CODES.BAD_RESPONSE, '笔记详情响应缺少 memo 对象')
    }
    return {
      memo: body.memo,
      relations: Array.isArray(body.relations) ? body.relations.filter(isRecord) : [],
      backlinks: Array.isArray(body.backlinks) ? body.backlinks.filter(isRecord) : [],
      canManage: body.can_manage === true,
      canGovern: body.can_govern === true,
    }
  }

  /** GET /api/app/tags —— 层级树，原样返回由上层拍平。 */
  async listTags(instanceUrl, accessToken) {
    const response = await this.http.request(`${instanceUrl}/api/app/tags`, {
      headers: FlareMoClient.bearer(accessToken),
    })
    if (response.status === 401) throw this.unauthorized(response)
    if (!response.ok) throw this.dataFailure('读取标签', response)
    const body = response.body
    if (!isRecord(body) || !Array.isArray(body.tags)) {
      throw new FlareMoError(CODES.BAD_RESPONSE, '标签响应缺少 tags 数组')
    }
    return body.tags.filter(isRecord)
  }

  /**
   * GET /api/app/stats —— 侧边栏统计 + 日历热力。
   * 响应是 snake_case（见 memoStatsResponseSchema），camelCase 转换由上层负责。
   * @param {string} instanceUrl - instance origin.
   * @param {string} accessToken - bearer token.
   * @param {{ timeZone?: string, days?: number }} [query] - stats query.
   * @returns {Promise<object>} raw stats response body.
   */
  async getMemoStats(instanceUrl, accessToken, query = {}) {
    const response = await this.http.request(`${instanceUrl}/api/app/stats`, {
      headers: FlareMoClient.bearer(accessToken),
      query: {
        time_zone: query.timeZone,
        days: query.days,
        until: query.until,
      },
    })
    if (response.status === 401) throw this.unauthorized(response)
    if (!response.ok) throw this.dataFailure('读取统计', response)
    const body = response.body
    if (!isRecord(body) || !isRecord(body.counts)) {
      throw new FlareMoError(CODES.BAD_RESPONSE, '统计响应缺少 counts 对象')
    }
    return body
  }

  /** GET /api/app/insights —— 拉 pending（或其它状态）的洞察任务。 */
  async listInsights(instanceUrl, accessToken, query = {}) {
    const response = await this.http.request(`${instanceUrl}/api/app/insights`, {
      headers: FlareMoClient.bearer(accessToken),
      query: {
        status: query.status,
        limit: query.limit,
      },
    })
    if (response.status === 401) throw this.unauthorized(response)
    if (!response.ok) throw this.dataFailure('读取洞察任务', response)
    const body = response.body
    if (!isRecord(body) || !Array.isArray(body.insights)) {
      throw new FlareMoError(CODES.BAD_RESPONSE, '洞察列表响应缺少 insights 数组')
    }
    return { insights: body.insights.filter(isRecord) }
  }

  /** GET /api/app/insights/{bareId} —— 单条任务。 */
  async getInsight(instanceUrl, accessToken, insightId) {
    const id = asText(insightId).trim()
    if (id === '') throw new FlareMoError(CODES.BAD_ARGS, '缺少洞察任务 id')
    const response = await this.http.request(`${instanceUrl}/api/app/insights/${encodeURIComponent(id)}`, {
      headers: FlareMoClient.bearer(accessToken),
    })
    if (response.status === 401) throw this.unauthorized(response)
    if (!response.ok) throw this.dataFailure('读取洞察任务', response)
    const body = response.body
    if (!isRecord(body) || !isRecord(body.insight)) {
      throw new FlareMoError(CODES.BAD_RESPONSE, '洞察响应缺少 insight 对象')
    }
    return body.insight
  }

  /**
   * PUT /api/app/insights/{bareId} —— 认领 / 写回。
   * 服务端只允许 PAT 写回，并且 done / failed 是 first-write-wins 的终态。
   * @param {string} instanceUrl - instance origin.
   * @param {string} accessToken - bearer token.
   * @param {string} insightId - bare or prefixed id (prefix is stripped).
   * @param {{ status: string, result?: unknown, error?: string, executor?: string }} body - write-back body.
   */
  async writeInsight(instanceUrl, accessToken, insightId, body) {
    const id = asText(insightId).trim().replace(/^insights\//, '')
    if (id === '') throw new FlareMoError(CODES.BAD_ARGS, '缺少洞察任务 id')
    const response = await this.http.request(`${instanceUrl}/api/app/insights/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: FlareMoClient.bearer(accessToken),
      body,
    })
    if (response.status === 401) throw this.unauthorized(response)
    if (!response.ok) throw this.dataFailure('写回洞察结果', response)
    const payload = response.body
    if (!isRecord(payload) || !isRecord(payload.insight)) {
      throw new FlareMoError(CODES.BAD_RESPONSE, '写回响应缺少 insight 对象')
    }
    return payload.insight
  }

  // ── 内部 ────────────────────────────────────────────────────────────

  /** 把 token 响应折成内部结构；缺 access_token 视为坏响应。 */
  tokenPayload(body) {
    if (!isRecord(body) || asText(body.access_token) === '') {
      throw new FlareMoError(CODES.BAD_RESPONSE, 'token 响应缺少 access_token')
    }
    return {
      accessToken: asText(body.access_token),
      refreshToken: asText(body.refresh_token) || undefined,
      tokenType: asText(body.token_type) || 'Bearer',
      scope: asText(body.scope) || undefined,
      expiresInSeconds: Number(body.expires_in) > 0 ? Number(body.expires_in) : undefined,
    }
  }

  /** 401：上层负责刷新后重试。 */
  unauthorized(response) {
    const message = wireMessage(response.body) ?? '访问令牌已失效'
    return new FlareMoError(CODES.HTTP_ERROR, message, { status: 401, detail: truncate(response.text, 400) })
  }

  /** 普通数据端点的失败（机器码统一是 HTTP_ERROR，具体原因在 message/detail）。 */
  dataFailure(action, response) {
    const message = wireMessage(response.body) ?? `${action}失败（HTTP ${response.status}）`
    return new FlareMoError(CODES.HTTP_ERROR, message, {
      status: response.status,
      detail: truncate(response.text, 400),
    })
  }

  /** 设备授权端点失败：优先透出 RFC 8628 的错误码（authorization_pending 等）。 */
  endpointFailure(action, response) {
    const code = wireCode(response.body)
    const message = wireMessage(response.body) ?? `${action}失败（HTTP ${response.status}）`
    if (code !== undefined) {
      return new FlareMoError(code, message, { status: response.status, detail: truncate(response.text, 400) })
    }
    return new FlareMoError(CODES.HTTP_ERROR, message, { status: response.status, detail: truncate(response.text, 400) })
  }
}

/** 便于测试的错误消息提取（同 util.errorMessage，但保持本模块自足）。 */
export function describeHttpError(error) {
  return error instanceof FlareMoError ? error.message : errorMessage(error)
}
