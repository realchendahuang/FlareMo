/**
 * 连接与数据的状态机（Host 侧，纯逻辑，不依赖 Cordis）。
 *
 * 职责：
 *  - 设备授权：发起 → 轮询 → 保存 token / 账号；
 *  - token 生命周期：临近过期先刷新、401 自动刷新后重试一次、refresh 失效则断开；
 *  - 数据面：把 FlareMo 的 MemoDto 折成 client 用的窄视图（标题/摘要/标签/时间），
 *    不把 token、也不把整份 payload 泄漏给 client；
 *  - 状态的唯一持久化入口是 ConnectionStore（凭据记录）。
 *
 * 可测试性：store / client / clock 全部从构造参数注入，测试用假 fetch 就能覆盖
 * 状态机与 401 刷新。
 */

import { CODES, FlareMoError } from './errors.js'
import {
  EXECUTOR_NAME,
  ERROR_MAX_CHARS,
  bareInsightId,
  toInsightView,
} from './insight.js'
import { asText, clampInt, isRecord, millisUntil, normalizeInstanceUrl, nowIso, truncate } from './util.js'
import { STATE_VERSION } from './store.js'

/** 提前多久认为 access token 该换了。 */
export const REFRESH_SKEW_MS = 60_000
/** 写入「最后同步」的最小间隔，避免每次列表都写凭据存储。 */
export const LAST_SYNC_THROTTLE_MS = 60_000
/** 单条笔记正文进 wire 的上限（列表一次 30 条，别把面板拖垮）。 */
export const CONTENT_LIMIT = 20_000

/** 去掉常见 markdown 行内标记，列表摘要用。 */
export function stripMarkdown(text) {
  return asText(text)
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/!{0,1}\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|\s)[*_](\S(?:.*?\S)?)[*_](?=\s|$)/g, '$1$2')
    .trim()
}

/** 正文里第一行有内容的文字（跳过空行与分隔线）。 */
function firstMeaningfulLine(content) {
  for (const line of asText(content).split('\n')) {
    const value = stripMarkdown(line)
    if (value !== '' && !/^[-=*\s]+$/.test(value)) return value
  }
  return ''
}

/**
 * 标题：优先 payload.property.title（Memos 兼容的标题字段），否则正文首个有意义的行。
 * @param {object} dto - FlareMo MemoDto.
 * @returns {string} display title.
 */
export function memoTitle(dto) {
  const payload = isRecord(dto?.payload) ? dto.payload : undefined
  const property = isRecord(payload?.property) ? payload.property : undefined
  const explicit = property === undefined ? '' : asText(property.title).trim()
  if (explicit !== '') return truncate(explicit, 120)
  const line = firstMeaningfulLine(dto?.content)
  return line === '' ? '（无标题）' : truncate(line, 80)
}

/**
 * 列表摘要：标题之后最多两行正文，压成一行。
 * @param {object} dto - FlareMo MemoDto.
 * @returns {string} one-line excerpt.
 */
export function memoExcerpt(dto) {
  const lines = asText(dto?.content)
    .split('\n')
    .map((line) => stripMarkdown(line))
    .filter((line) => line !== '' && !/^[-=*\s]+$/.test(line))
  const payload = isRecord(dto?.payload) ? dto.payload : undefined
  const property = isRecord(payload?.property) ? payload.property : undefined
  const explicitTitle = property === undefined ? '' : asText(property.title).trim()
  const rest = lines.slice(1)
  const text = explicitTitle !== '' ? lines : rest
  return truncate(text.slice(0, 2).join(' '), 140)
}

/** 标签：payload.tags（服务端已归一化），去重去空。 */
export function memoTags(dto) {
  const payload = isRecord(dto?.payload) ? dto.payload : undefined
  const tags = Array.isArray(payload?.tags) ? payload.tags : []
  const seen = new Set()
  for (const tag of tags) {
    const value = asText(tag).trim()
    if (value !== '') seen.add(value)
  }
  return [...seen]
}

/** MemoDto → client 用的窄视图（不含 payload、creator 等内部字段）。 */
export function toNoteView(dto) {
  const created = asText(dto.create_time) || asText(dto.display_time)
  const updated = asText(dto.update_time) || created
  return {
    id: asText(dto.id),
    title: memoTitle(dto),
    excerpt: memoExcerpt(dto),
    content: truncate(asText(dto.content), CONTENT_LIMIT),
    tags: memoTags(dto),
    createdAt: created,
    updatedAt: updated,
    day: (created === '' ? updated : created).slice(0, 10),
    pinned: dto.pinned === true,
    visibility: asText(dto.visibility) || undefined,
    state: asText(dto.state) || undefined,
    source: asText(dto.source) || undefined,
    creatorName: asText(dto.creator_name) || undefined,
    commentCount: Number.isFinite(dto.comment_count) ? dto.comment_count : 0,
  }
}

/** 关系 / 反链条目 → 轻量引用。 */
function toNoteRef(entry) {
  const memo = isRecord(entry?.memo) ? entry.memo : undefined
  if (memo === undefined) return undefined
  return { id: asText(memo.id), title: memoTitle(memo), day: asText(memo.create_time).slice(0, 10) }
}

/** 标签层级树 → 拍平（name 是完整路径，例如 `工作/项目A`）。 */
export function flattenTags(nodes, out = []) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const name = asText(node?.name)
    if (name !== '') out.push({ name, count: Number.isFinite(node.count) ? node.count : 0 })
    flattenTags(node?.children, out)
  }
  return out
}

export class FlareMoConnection {
  /**
   * @param {{ store: import('./store.js').ConnectionStore,
   *   client: import('./flaremo-client.js').FlareMoClient,
   *   clock?: () => number }} options
   */
  constructor(options) {
    this.store = options.store
    this.client = options.client
    this.clock = options.clock ?? (() => Date.now())
    /** 单飞：并发 401 只刷新一次 refresh_token（轮换后旧值立刻失效）。 */
    this.refreshPromise = null
    /** 单飞：轮询按钮连点不会并行兑换 device_code。 */
    this.pollPromise = null
    this.lastSyncWrite = 0
  }

  // ── 状态读写 ──────────────────────────────────────────────────────

  /** 当前完整状态（含 token，Host 内部用，绝不进 RPC 返回值）。 */
  async readState() {
    const payload = await this.store.read()
    return isRecord(payload) && payload.version === STATE_VERSION ? payload : undefined
  }

  /**
   * 合并写状态；值为 undefined 的键会被删除。
   * @param {Record<string, unknown>} patch - keys to merge.
   * @returns {Promise<object>} the state after the write.
   */
  async patchState(patch) {
    const current = (await this.readState()) ?? { version: STATE_VERSION }
    const next = { ...current }
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete next[key]
      else next[key] = value
    }
    await this.store.write(next)
    return next
  }

  // ── 对 client 暴露的连接视图（无 token）───────────────────────────

  /** @returns {Promise<object>} connection view safe to cross the wire. */
  async status() {
    const state = await this.readState()
    if (state === undefined) {
      return {
        connected: false,
        instanceUrl: null,
        account: null,
        scope: null,
        accessExpiresAt: null,
        connectedAt: null,
        lastSyncAt: null,
        pending: null,
      }
    }
    const pending = isRecord(state.pending) ? state.pending : undefined
    return {
      connected: asText(state.accessToken) !== '',
      instanceUrl: asText(state.instanceUrl) || null,
      account: isRecord(state.account) ? state.account : null,
      scope: asText(state.scope) || null,
      accessExpiresAt: asText(state.accessExpiresAt) || null,
      connectedAt: asText(state.connectedAt) || null,
      lastSyncAt: asText(state.lastSyncAt) || null,
      pending:
        pending === undefined
          ? null
          : {
              userCode: asText(pending.userCode),
              verificationUri: asText(pending.verificationUri),
              verificationUriComplete: asText(pending.verificationUriComplete) || asText(pending.verificationUri),
              expiresAt: asText(pending.expiresAt),
              intervalSeconds: Number(pending.intervalSeconds) > 0 ? pending.intervalSeconds : 5,
            },
    }
  }

  // ── 设备授权 ──────────────────────────────────────────────────────

  /**
   * 校验实例地址并申请配对码。会清掉旧实例的 token（换实例等于换身份）。
   * @param {{ instanceUrl?: unknown, clientName?: unknown }} args - RPC args.
   * @returns {Promise<object>} the connection view with `pending`.
   */
  async connectStart(args = {}) {
    const instanceUrl = normalizeInstanceUrl(args.instanceUrl)
    if (instanceUrl === undefined) {
      throw new FlareMoError(CODES.INVALID_INSTANCE_URL, '实例地址必须是 http(s) URL', {
        params: { value: asText(args.instanceUrl) },
      })
    }
    const device = await this.client.startDeviceAuthorization(instanceUrl, {
      clientName: asText(args.clientName) || 'DeepSeek Harness',
      scopes: ['notes'],
    })
    const now = this.clock()
    const pending = {
      deviceCode: device.deviceCode,
      userCode: device.userCode,
      verificationUri: device.verificationUri,
      verificationUriComplete: device.verificationUriComplete,
      expiresAt: new Date(now + device.expiresInSeconds * 1000).toISOString(),
      intervalSeconds: clampInt(device.intervalSeconds, 1, 60, 5),
      startedAt: new Date(now).toISOString(),
    }
    await this.patchState({
      instanceUrl,
      pending,
      // 换实例/重新配对时旧凭据一律作废，避免两个实例的 token 混用
      accessToken: undefined,
      refreshToken: undefined,
      accessExpiresAt: undefined,
      scope: undefined,
      account: undefined,
      connectedAt: undefined,
    })
    return this.status()
  }

  /**
   * 轮询一次设备授权。
   * @returns {Promise<{ status: 'pending' | 'connected' | 'expired' | 'denied',
   *   intervalSeconds?: number, connection?: object }>}
   */
  async connectPoll() {
    if (this.pollPromise !== null) return this.pollPromise
    this.pollPromise = this.pollOnce().finally(() => {
      this.pollPromise = null
    })
    return this.pollPromise
  }

  async pollOnce() {
    const state = await this.readState()
    const pending = isRecord(state?.pending) ? state.pending : undefined
    if (state === undefined || pending === undefined) {
      throw new FlareMoError(CODES.NO_PENDING_CONNECT, '没有进行中的配对，请先发起配对')
    }
    const instanceUrl = asText(state.instanceUrl)
    if (millisUntil(pending.expiresAt, this.clock) <= 0) {
      await this.patchState({ pending: undefined })
      return { status: 'expired' }
    }

    try {
      const token = await this.client.exchangeDeviceCode(instanceUrl, asText(pending.deviceCode))
      const account = await this.client.getAccount(instanceUrl, token.accessToken)
      const now = this.clock()
      await this.store.write({
        version: STATE_VERSION,
        instanceUrl,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        tokenType: token.tokenType,
        scope: token.scope,
        accessExpiresAt: token.expiresInSeconds === undefined
          ? undefined
          : new Date(now + token.expiresInSeconds * 1000).toISOString(),
        account,
        connectedAt: new Date(now).toISOString(),
        lastSyncAt: new Date(now).toISOString(),
      })
      return { status: 'connected', connection: await this.status() }
    } catch (error) {
      if (!(error instanceof FlareMoError)) throw error
      switch (error.code) {
        case 'authorization_pending':
          return { status: 'pending', intervalSeconds: clampInt(pending.intervalSeconds, 1, 60, 5) }
        case 'slow_down': {
          const intervalSeconds = clampInt(Number(pending.intervalSeconds) + 5, 5, 60, 10)
          await this.patchState({ pending: { ...pending, intervalSeconds } })
          return { status: 'pending', intervalSeconds }
        }
        case 'expired_token':
        case 'invalid_grant': {
          await this.patchState({ pending: undefined })
          return { status: 'expired' }
        }
        case 'access_denied': {
          await this.patchState({ pending: undefined })
          return { status: 'denied' }
        }
        default:
          throw error
      }
    }
  }

  /** 取消进行中的配对：只清 pending，已保存的 token 不动（理论上没有）。 */
  async cancelConnect() {
    await this.patchState({ pending: undefined })
    return this.status()
  }

  /** 断开本地连接（同时删凭据记录）。服务端吊销下一版接「已连接应用」页。 */
  async disconnect() {
    await this.store.clear()
    return this.status()
  }

  // ── token 生命周期 ────────────────────────────────────────────────

  /** 单飞刷新：并发调用共用同一个刷新请求，避免轮换互相作废。 */
  async refreshAccessToken(state) {
    if (this.refreshPromise !== null) return this.refreshPromise
    this.refreshPromise = (async () => {
      const current = state ?? (await this.readState())
      const instanceUrl = asText(current?.instanceUrl)
      const refreshToken = asText(current?.refreshToken)
      if (current === undefined || instanceUrl === '' || asText(current.accessToken) === '') {
        throw new FlareMoError(CODES.NOT_CONNECTED, '还没有连接 FlareMo 实例')
      }
      if (refreshToken === '') {
        await this.store.clear()
        throw new FlareMoError(CODES.AUTH_EXPIRED, '访问令牌已失效且没有刷新令牌，请重新配对')
      }
      try {
        const token = await this.client.refresh(instanceUrl, refreshToken)
        const now = this.clock()
        const next = {
          ...current,
          version: STATE_VERSION,
          accessToken: token.accessToken,
          // refresh_token 轮换：服务端只认新的这一对
          refreshToken: token.refreshToken ?? refreshToken,
          accessExpiresAt: token.expiresInSeconds === undefined
            ? current.accessExpiresAt
            : new Date(now + token.expiresInSeconds * 1000).toISOString(),
          scope: token.scope ?? current.scope,
          refreshedAt: new Date(now).toISOString(),
        }
        delete next.pending
        await this.store.write(next)
        return token.accessToken
      } catch (error) {
        if (
          error instanceof FlareMoError &&
          (error.code === 'invalid_grant' || error.code === 'expired_token' || error.status === 401)
        ) {
          await this.store.clear()
          throw new FlareMoError(CODES.AUTH_EXPIRED, '刷新令牌已失效，请重新配对', { detail: error.message })
        }
        throw error
      }
    })().finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  /**
   * 带鉴权执行一次数据请求：先按需刷新，401 时刷新后重试一次。
   * @template T
   * @param {(instanceUrl: string, accessToken: string) => Promise<T>} run - the data call.
   * @returns {Promise<T>} the call result.
   */
  async withAuth(run) {
    const state = await this.readState()
    if (state === undefined || asText(state.instanceUrl) === '' || asText(state.accessToken) === '') {
      throw new FlareMoError(CODES.NOT_CONNECTED, '还没有连接 FlareMo 实例')
    }
    let accessToken = asText(state.accessToken)
    if (asText(state.accessExpiresAt) !== '' && millisUntil(state.accessExpiresAt, this.clock) < REFRESH_SKEW_MS) {
      accessToken = await this.refreshAccessToken(state)
    }
    try {
      return await run(asText(state.instanceUrl), accessToken)
    } catch (error) {
      if (!(error instanceof FlareMoError) || error.status !== 401) throw error
      const fresh = await this.refreshAccessToken(await this.readState())
      return run(asText(state.instanceUrl), fresh)
    }
  }

  /** 「最后同步」写回，最多每 60s 一次（数据成功时调用）。 */
  async touchLastSync() {
    const now = this.clock()
    if (now - this.lastSyncWrite < LAST_SYNC_THROTTLE_MS) return
    this.lastSyncWrite = now
    const state = await this.readState()
    if (state === undefined) return
    await this.patchState({ lastSyncAt: new Date(now).toISOString() })
  }

  // ── 数据面 ────────────────────────────────────────────────────────

  /**
   * 列笔记 / 搜索笔记共用。
   * @param {{ pageSize?: unknown, pageToken?: unknown, orderBy?: unknown,
   *   q?: unknown, tag?: unknown }} args - RPC args.
   * @returns {Promise<{ notes: object[], nextPageToken?: string }>}
   */
  async fetchNotes(args = {}) {
    const pageSize = clampInt(args.pageSize, 1, 100, 30)
    const result = await this.withAuth((instanceUrl, accessToken) =>
      this.client.listMemos(instanceUrl, accessToken, {
        pageSize,
        pageToken: asText(args.pageToken) || undefined,
        orderBy: asText(args.orderBy) || 'created_at desc',
        q: asText(args.q) || undefined,
        tag: asText(args.tag) || undefined,
      }),
    )
    await this.touchLastSync()
    return {
      notes: result.memos.map(toNoteView),
      ...(result.nextPageToken === undefined ? {} : { nextPageToken: result.nextPageToken }),
    }
  }

  /** 列表（默认按创建时间倒序）。 */
  async listNotes(args = {}) {
    return this.fetchNotes(args)
  }

  /** 服务端搜索：q 是 FlareMo 的检索语法（支持 has:attachment / is:pinned / before:…）。 */
  async searchNotes(args = {}) {
    const query = asText(args.query ?? args.q).trim()
    if (query === '') throw new FlareMoError(CODES.BAD_ARGS, '搜索关键词不能为空')
    return this.fetchNotes({ ...args, q: query })
  }

  /** 单条笔记 + 关系 / 反链。 */
  async getNote(args = {}) {
    const id = asText(args.id).trim()
    if (id === '') throw new FlareMoError(CODES.BAD_ARGS, '缺少笔记 id')
    const result = await this.withAuth((instanceUrl, accessToken) =>
      this.client.getMemo(instanceUrl, accessToken, id),
    )
    const relations = result.relations.map(toNoteRef).filter(Boolean)
    const backlinks = result.backlinks.map(toNoteRef).filter(Boolean)
    return {
      note: toNoteView(result.memo),
      relations,
      backlinks,
      canManage: result.canManage,
      canGovern: result.canGovern,
    }
  }

  /** 标签（拍平，带 count）。 */
  async listTags() {
    const tree = await this.withAuth((instanceUrl, accessToken) =>
      this.client.listTags(instanceUrl, accessToken),
    )
    const tags = flattenTags(tree)
    return { tags: tags.sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name)) }
  }

  // ── 洞察任务（执行器的数据面）──────────────────────────────────────

  /**
   * 拉取洞察任务（默认 pending）。
   * @param {{ status?: unknown, limit?: unknown }} [args]
   * @returns {Promise<{ insights: object[] }>}
   */
  async listInsights(args = {}) {
    const status = asText(args.status) || 'pending'
    const limit = clampInt(args.limit, 1, 100, 50)
    const result = await this.withAuth((instanceUrl, accessToken) =>
      this.client.listInsights(instanceUrl, accessToken, { status, limit }),
    )
    return { insights: result.insights.map(toInsightView) }
  }

  /**
   * 读一条洞察任务。
   * @param {{ id?: unknown }} [args]
   * @returns {Promise<{ insight: object }>}
   */
  async getInsight(args = {}) {
    const id = asText(args.id).trim()
    if (id === '') throw new FlareMoError(CODES.BAD_ARGS, '缺少洞察任务 id')
    const dto = await this.withAuth((instanceUrl, accessToken) =>
      this.client.getInsight(instanceUrl, accessToken, bareInsightId(id)),
    )
    return { insight: toInsightView(dto) }
  }

  /** 认领任务：pending → running（同一个任务重复认领是幂等的）。 */
  async claimInsight(insightId) {
    const id = asText(insightId).trim()
    if (id === '') throw new FlareMoError(CODES.BAD_ARGS, '缺少洞察任务 id')
    const dto = await this.withAuth((instanceUrl, accessToken) =>
      this.client.writeInsight(instanceUrl, accessToken, id, {
        status: 'running',
        executor: EXECUTOR_NAME,
      }),
    )
    return toInsightView(dto)
  }

  /** 写回成功结果（done/failed 是 first-write-wins 的终态）。 */
  async completeInsight(insightId, result) {
    const id = asText(insightId).trim()
    if (id === '') throw new FlareMoError(CODES.BAD_ARGS, '缺少洞察任务 id')
    const dto = await this.withAuth((instanceUrl, accessToken) =>
      this.client.writeInsight(instanceUrl, accessToken, id, {
        status: 'done',
        result,
        executor: EXECUTOR_NAME,
      }),
    )
    return toInsightView(dto)
  }

  /** 写回失败（error 会被 FlareMo 截到 2000 字符，我们自己先截）。 */
  async failInsight(insightId, message) {
    const id = asText(insightId).trim()
    if (id === '') throw new FlareMoError(CODES.BAD_ARGS, '缺少洞察任务 id')
    const dto = await this.withAuth((instanceUrl, accessToken) =>
      this.client.writeInsight(instanceUrl, accessToken, id, {
        status: 'failed',
        error: truncate(asText(message) || '洞察执行失败', ERROR_MAX_CHARS),
        executor: EXECUTOR_NAME,
      }),
    )
    return toInsightView(dto)
  }
}

export { nowIso }
