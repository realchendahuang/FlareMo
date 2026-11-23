/**
 * 多实例状态的类（Host 侧，纯逻辑，不依赖 Cordis）。
 *
 * 存储形状（ConnectionStore 里一条 grant 记录，payload 不透明）：
 *
 *   {
 *     version: 2,
 *     activeId: 'inst_ab12cd34ef',      // 当前实例；数据面默认落到它
 *     instances: [{
 *       id, alias, instanceUrl, account, scope,
 *       accessToken, refreshToken, accessExpiresAt,
 *       connectedAt, lastSyncAt,
 *     }],
 *     pending: { deviceCode, userCode, …, instanceUrl, alias } | undefined,
 *   }
 *
 * 设计约定（docs/agent-access-design.md §8）：具名 alias、一个 active、
 * 每实例独立 token、不做聚合视图、写回跟随来源。v1 的单实例状态由
 * {@link migrateState} 升级成一条实例记录（id 由实例 URL 派生，稳定）。
 *
 * 可测试性：store / client / clock 全部从构造参数注入，测试用假 fetch 就能覆盖
 * 状态机、401 刷新与多实例隔离。
 */

import { createHash } from 'node:crypto'

import { CODES, FlareMoError } from './errors.js'
import {
  EXECUTOR_NAME,
  ERROR_MAX_CHARS,
  bareInsightId,
  toInsightView,
} from './insight.js'
import { asText, clampInt, isRecord, millisUntil, normalizeInstanceUrl, truncate } from './util.js'
import { STATE_VERSION } from './store.js'

/** 提前多久认为 access token 该换了。 */
export const REFRESH_SKEW_MS = 60_000
/** 写入「最后同步」的最小间隔，避免每次列表都写凭据存储。 */
export const LAST_SYNC_THROTTLE_MS = 60_000
/** 单条笔记正文进 wire 的上限（列表一次 30 条，别把面板拖垮）。 */
export const CONTENT_LIMIT = 20_000
/** 新建便签正文上限（与服务端 createMemoSchema 一致，超了本地就拒，不发给服务端）。 */
export const NOTE_CONTENT_MAX = 100_000
/** 列表 state 过滤可用的值（服务端 memoStatusSchema 的子集）。 */
const NOTE_STATES = ['normal', 'archived', 'trashed']
/** 可见性可用的值（服务端 memoVisibilitySchema 的子集：web 工作台只暴露这两档）。 */
const NOTE_VISIBILITIES = ['private', 'public']
/** alias 长度上限。 */
export const ALIAS_MAX = 40
/** `YYYY-MM-DD`（服务端 stats 的 `until` 只收这个形状）。 */
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

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

/**
 * MemoDto → client 用的窄视图（不含 payload、creator 等内部字段）。
 * @param {object} dto - FlareMo MemoDto.
 * @param {{ contentLimit?: number }} [options] - 正文上限（详情页传更大值取全文）。
 * @returns {object} narrow note view.
 */
export function toNoteView(dto, options = {}) {
  const created = asText(dto.create_time) || asText(dto.display_time)
  const updated = asText(dto.update_time) || created
  const rawContent = asText(dto.content)
  const limit = Number.isFinite(options.contentLimit) ? options.contentLimit : CONTENT_LIMIT
  return {
    id: asText(dto.id),
    title: memoTitle(dto),
    excerpt: memoExcerpt(dto),
    content: truncate(rawContent, limit),
    /** 列表窗口里被截断时告诉 client，详情页据此去拉全文。 */
    truncated: rawContent.length > limit,
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

/** 从允许的枚举里挑一个合法值；非法 / 缺省一律当没传（不过滤、不报错）。 */
function pickEnum(raw, allowed) {
  const value = asText(raw).trim()
  return allowed.includes(value) ? value : undefined
}

/** 统计计数：非法值折成 0，不把 undefined / NaN 漏给 client。 */
function countOf(value) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

// ── 实例身份 ────────────────────────────────────────────────────────

/**
 * 实例 id 由「规范化后的实例 URL」派生：同一个实例重新配对时 id 不变，
 * 不会在列表里长出两条重复记录。
 * @param {string} instanceUrl - normalized http(s) URL.
 * @returns {string} stable id (`inst_<10 hex>`).
 */
export function instanceIdFor(instanceUrl) {
  const hash = createHash('sha256').update(asText(instanceUrl)).digest('hex').slice(0, 10)
  return `inst_${hash}`
}

/**
 * 默认 alias：从实例 host 派生（`https://app.flaremo.app` → `app-flaremo-app`）。
 * @param {string} instanceUrl - normalized http(s) URL.
 * @returns {string} a slug usable as alias.
 */
export function aliasFromUrl(instanceUrl) {
  try {
    const url = new URL(asText(instanceUrl))
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const port = url.port === '' ? '' : `-${url.port}`
    const slug = `${host}${port}`
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    return slug === '' ? 'flaremo' : slug.slice(0, 32)
  } catch {
    return 'flaremo'
  }
}

/**
 * 校验并规整 alias：1–40 个字符，去掉首尾空白、内部连续空白压成一个空格。
 * @param {unknown} raw - user input.
 * @returns {string} normalized alias.
 */
export function normalizeAlias(raw) {
  const text = asText(raw).replace(/\s+/g, ' ').trim()
  if (text === '' || text.length > ALIAS_MAX) {
    throw new FlareMoError(CODES.INVALID_ALIAS, `实例名需要 1–${ALIAS_MAX} 个字符`, {
      params: { value: text, max: ALIAS_MAX },
    })
  }
  return text
}

/** alias 是否已被别的实例占用（大小写不敏感）。 */
function aliasTaken(instances, alias, exceptId) {
  const wanted = asText(alias).toLowerCase()
  return instances.some((instance) => instance.id !== exceptId && asText(instance.alias).toLowerCase() === wanted)
}

/** 在冲突时补 `-2` / `-3` …（自动生成的 alias 用，用户手动改的冲突直接报错）。 */
function uniqueAlias(instances, desired, exceptId) {
  const base = asText(desired) === '' ? 'flaremo' : asText(desired)
  if (!aliasTaken(instances, base, exceptId)) return base
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base}-${index}`
    if (!aliasTaken(instances, candidate, exceptId)) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

// ── 状态迁移与规整 ──────────────────────────────────────────────────

/** 空状态。 */
function emptyState() {
  return { version: STATE_VERSION, activeId: null, instances: [] }
}

/** 把 pending 记录收敛成可持久化的形状（缺 deviceCode/userCode 就当没有）。 */
function sanitizePending(raw, fallbackUrl = '') {
  if (!isRecord(raw)) return undefined
  const deviceCode = asText(raw.deviceCode)
  const userCode = asText(raw.userCode)
  if (deviceCode === '' || userCode === '') return undefined
  return {
    deviceCode,
    userCode,
    verificationUri: asText(raw.verificationUri),
    verificationUriComplete: asText(raw.verificationUriComplete) || asText(raw.verificationUri),
    expiresAt: asText(raw.expiresAt),
    intervalSeconds: clampInt(raw.intervalSeconds, 1, 60, 5),
    startedAt: asText(raw.startedAt) || undefined,
    instanceUrl: asText(raw.instanceUrl) || fallbackUrl,
    alias: asText(raw.alias) || undefined,
  }
}

/** 单条实例记录：只保留白名单字段，去掉 undefined。 */
function sanitizeInstance(raw) {
  const instanceUrl = asText(raw?.instanceUrl)
  if (instanceUrl === '') return undefined
  const record = {
    id: asText(raw.id) || instanceIdFor(instanceUrl),
    alias: asText(raw.alias) || aliasFromUrl(instanceUrl),
    instanceUrl,
  }
  if (isRecord(raw.account)) record.account = raw.account
  for (const key of ['scope', 'accessToken', 'refreshToken', 'accessExpiresAt', 'connectedAt', 'lastSyncAt', 'refreshedAt']) {
    const value = asText(raw[key])
    if (value !== '') record[key] = value
  }
  return record
}

/** v2 → 干净 v2（字段收敛、activeId 必须指向存在的实例）。 */
function normalizeState(payload) {
  const instances = []
  const seen = new Set()
  for (const raw of Array.isArray(payload?.instances) ? payload.instances : []) {
    const instance = isRecord(raw) ? sanitizeInstance(raw) : undefined
    if (instance === undefined || seen.has(instance.id)) continue
    seen.add(instance.id)
    instances.push(instance)
  }
  const activeCandidate = asText(payload?.activeId)
  const activeId = instances.some((instance) => instance.id === activeCandidate)
    ? activeCandidate
    : (instances[0]?.id ?? null)
  const pending = sanitizePending(payload?.pending)
  const state = { version: STATE_VERSION, activeId, instances }
  if (pending !== undefined) state.pending = pending
  return state
}

/** v1（单实例）→ v2（一条实例记录）。 */
function fromV1(payload) {
  const instanceUrl = asText(payload?.instanceUrl)
  const pending = sanitizePending(payload?.pending, instanceUrl)
  const state = emptyState()
  if (instanceUrl === '') {
    if (pending !== undefined) state.pending = pending
    return state
  }
  const instance = sanitizeInstance({
    id: instanceIdFor(instanceUrl),
    alias: aliasFromUrl(instanceUrl),
    instanceUrl,
    account: payload.account,
    scope: payload.scope,
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    accessExpiresAt: payload.accessExpiresAt,
    connectedAt: payload.connectedAt,
    lastSyncAt: payload.lastSyncAt,
  })
  if (instance !== undefined) {
    state.instances = [instance]
    state.activeId = instance.id
  }
  if (pending !== undefined) state.pending = pending
  return state
}

/**
 * 把任意持久化 payload 迁移/规整成 v2。
 * @param {unknown} payload - raw credential record payload.
 * @returns {object | undefined} normalized v2 state (undefined = 没有状态).
 */
export function migrateState(payload) {
  if (!isRecord(payload)) return undefined
  if (payload.version === STATE_VERSION) return normalizeState(payload)
  if (payload.version === 1) return fromV1(payload)
  return undefined
}

/** 连接视图里的实例摘要（无 token）。 */
function instanceSummary(instance, activeId) {
  return {
    id: instance.id,
    alias: instance.alias,
    instanceUrl: instance.instanceUrl,
    account: isRecord(instance.account) ? instance.account : null,
    connected: asText(instance.accessToken) !== '',
    connectedAt: asText(instance.connectedAt) || null,
    lastSyncAt: asText(instance.lastSyncAt) || null,
    active: instance.id === activeId,
  }
}

/** pending 的 wire 视图。 */
function pendingView(pending) {
  if (!isRecord(pending)) return null
  return {
    userCode: asText(pending.userCode),
    verificationUri: asText(pending.verificationUri),
    verificationUriComplete: asText(pending.verificationUriComplete) || asText(pending.verificationUri),
    expiresAt: asText(pending.expiresAt),
    intervalSeconds: Number(pending.intervalSeconds) > 0 ? pending.intervalSeconds : 5,
    instanceUrl: asText(pending.instanceUrl) || null,
    alias: asText(pending.alias) || null,
  }
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
    /** 单飞：同一个实例并发 401 只刷新一次（refresh_token 轮换后旧值立刻失效）。 */
    this.refreshPromises = new Map()
    /** 单飞：轮询按钮连点不会并行兑换 device_code。 */
    this.pollPromise = null
    /** 「最后同步」写回节流，按实例分别计时。 */
    this.lastSyncWrites = new Map()
    /** v1 → v2 落盘只做一次（并发读共享同一个 promise）。 */
    this.migration = null
  }

  // ── 状态读写 ──────────────────────────────────────────────────────

  /**
   * 当前完整状态（含 token，Host 内部用，绝不进 RPC 返回值）。
   *
   * 读到 v1（单实例）记录时顺手落盘成 v2：否则每次读都要重新迁移，
   * 而且凭据文件会一直停留在旧形状。写失败由 store 内部吞掉并退到内存。
   */
  async readState() {
    const raw = await this.store.read()
    const state = migrateState(raw)
    if (isRecord(raw) && raw.version === 1 && state !== undefined) {
      this.migration = this.migration ?? this.writeState(state).catch(() => {})
      await this.migration
    }
    return state
  }

  /**
   * 整体写状态（总是落成 v2）。
   * @param {object} state - normalized state.
   * @returns {Promise<object>} the state after the write.
   */
  async writeState(state) {
    const next = normalizeState(state)
    await this.store.write(next)
    return next
  }

  /**
   * 合并写顶层字段；值为 undefined 的键会被删除。
   * @param {Record<string, unknown>} patch - keys to merge.
   * @returns {Promise<object>} the state after the write.
   */
  async patchState(patch) {
    const current = (await this.readState()) ?? emptyState()
    const next = { ...current }
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete next[key]
      else next[key] = value
    }
    return this.writeState(next)
  }

  /** 更新一条实例记录（不存在就原样返回）。 */
  async updateInstance(id, mutate) {
    const state = (await this.readState()) ?? emptyState()
    let changed = false
    const instances = state.instances.map((instance) => {
      if (instance.id !== id) return instance
      changed = true
      return sanitizeInstance({ ...instance, ...mutate(instance) }) ?? instance
    })
    if (!changed) return state
    return this.writeState({ ...state, instances })
  }

  /** 清掉某实例的 token（保留记录，让用户能重新配对同一个实例）。 */
  async dropInstanceTokens(id) {
    return this.updateInstance(id, () => ({
      accessToken: undefined,
      refreshToken: undefined,
      accessExpiresAt: undefined,
    }))
  }

  // ── 实例选择 ──────────────────────────────────────────────────────

  /**
   * 解析实例：key 为空 → active；否则按 id 或 alias（大小写不敏感）匹配。
   * @param {object | undefined} state - current state.
   * @param {unknown} key - id / alias / empty.
   * @returns {object | undefined} the instance record.
   */
  resolveInstance(state, key) {
    const instances = Array.isArray(state?.instances) ? state.instances : []
    const wanted = asText(key).trim()
    if (wanted === '') {
      const activeId = asText(state?.activeId)
      return instances.find((instance) => instance.id === activeId) ?? instances[0]
    }
    const lower = wanted.toLowerCase()
    return (
      instances.find((instance) => instance.id === wanted) ??
      instances.find((instance) => asText(instance.alias).toLowerCase() === lower)
    )
  }

  /** 取一个已连接的实例；没有就抛 NOT_CONNECTED。 */
  async requireInstance(key) {
    const state = await this.readState()
    const instance = this.resolveInstance(state, key)
    if (instance === undefined || asText(instance.accessToken) === '') {
      throw new FlareMoError(CODES.NOT_CONNECTED, '还没有连接 FlareMo 实例')
    }
    return { state, instance }
  }

  /** 取一个已存在的实例（不管有没有 token）；不存在就抛 INSTANCE_NOT_FOUND。 */
  async requireExistingInstance(key) {
    const state = await this.readState()
    const instance = this.resolveInstance(state, key)
    if (instance === undefined) {
      throw new FlareMoError(CODES.INSTANCE_NOT_FOUND, '实例不存在，可能已被移除')
    }
    return { state, instance }
  }

  // ── 对 client 暴露的连接视图（无 token）───────────────────────────

  /** @returns {Promise<object>} connection view safe to cross the wire. */
  async status() {
    const state = await this.readState()
    if (state === undefined) {
      return {
        connected: false,
        instanceId: null,
        instanceUrl: null,
        alias: null,
        account: null,
        scope: null,
        accessExpiresAt: null,
        connectedAt: null,
        lastSyncAt: null,
        activeId: null,
        instances: [],
        pending: null,
      }
    }
    const active = this.resolveInstance(state, '')
    return {
      connected: active === undefined ? false : asText(active.accessToken) !== '',
      instanceId: active?.id ?? null,
      instanceUrl: asText(active?.instanceUrl) || null,
      alias: asText(active?.alias) || null,
      account: isRecord(active?.account) ? active.account : null,
      scope: asText(active?.scope) || null,
      accessExpiresAt: asText(active?.accessExpiresAt) || null,
      connectedAt: asText(active?.connectedAt) || null,
      lastSyncAt: asText(active?.lastSyncAt) || null,
      activeId: state.activeId,
      instances: state.instances.map((instance) => instanceSummary(instance, state.activeId)),
      pending: pendingView(state.pending),
    }
  }

  /** 实例列表（与 status().instances 同形）。 */
  async listInstances() {
    const state = await this.readState()
    if (state === undefined) return { instances: [], activeId: null }
    return {
      instances: state.instances.map((instance) => instanceSummary(instance, state.activeId)),
      activeId: state.activeId,
    }
  }

  /**
   * 切换 active 实例：之后所有数据面默认落到它。
   * @param {{ id?: unknown }} [args]
   * @returns {Promise<object>} the connection view.
   */
  async switchInstance(args = {}) {
    const { state, instance } = await this.requireExistingInstance(args.id)
    if (state.activeId !== instance.id) {
      await this.patchState({ activeId: instance.id })
    }
    return this.status()
  }

  /**
   * 改实例显示名（alias）：1–40 字符、大小写不敏感唯一。
   * @param {{ id?: unknown, alias?: unknown }} [args]
   * @returns {Promise<{ instances: object[], activeId: string | null }>}
   */
  async renameInstance(args = {}) {
    const { state, instance } = await this.requireExistingInstance(args.id)
    const alias = normalizeAlias(args.alias)
    if (aliasTaken(state.instances, alias, instance.id)) {
      throw new FlareMoError(CODES.ALIAS_TAKEN, '这个实例名已被占用', { params: { alias } })
    }
    await this.updateInstance(instance.id, () => ({ alias }))
    const next = await this.readState()
    return {
      instances: next.instances.map((row) => instanceSummary(row, next.activeId)),
      activeId: next.activeId,
    }
  }

  /**
   * 移除一个实例：删它的 token 与本地状态。移除 active 时把下一个实例设为 active。
   * @param {{ id?: unknown }} [args]
   * @returns {Promise<object>} the connection view.
   */
  async removeInstance(args = {}) {
    const { state, instance } = await this.requireExistingInstance(args.id)
    const instances = state.instances.filter((row) => row.id !== instance.id)
    const activeId = state.activeId === instance.id ? (instances[0]?.id ?? null) : state.activeId
    const pending = isRecord(state.pending) && asText(state.pending.instanceUrl) === instance.instanceUrl
      ? undefined
      : state.pending
    if (instances.length === 0 && pending === undefined) {
      // 最后一条也删掉：凭据记录整体清掉，避免留一个空壳。
      await this.store.clear()
      return this.status()
    }
    await this.writeState({ version: STATE_VERSION, activeId, instances, pending })
    return this.status()
  }

  // ── 设备授权 ──────────────────────────────────────────────────────

  /**
   * 校验实例地址并申请配对码。只新增/更新这一条实例，**不动其它实例**；
   * 配对成功前，这个实例原有的 token 继续有效（可以取消配对而不丢连接）。
   * @param {{ instanceUrl?: unknown, clientName?: unknown, alias?: unknown }} args - RPC args.
   * @returns {Promise<object>} the connection view with `pending`.
   */
  async connectStart(args = {}) {
    const instanceUrl = normalizeInstanceUrl(args.instanceUrl)
    if (instanceUrl === undefined) {
      throw new FlareMoError(CODES.INVALID_INSTANCE_URL, '实例地址必须是 http(s) URL', {
        params: { value: asText(args.instanceUrl) },
      })
    }
    const state = (await this.readState()) ?? emptyState()
    const existing = state.instances.find((instance) => instance.instanceUrl === instanceUrl)
    const requested = asText(args.alias).trim()
    let alias
    if (requested !== '') {
      alias = normalizeAlias(requested)
      if (aliasTaken(state.instances, alias, existing?.id)) {
        throw new FlareMoError(CODES.ALIAS_TAKEN, '这个实例名已被占用', { params: { alias } })
      }
    } else {
      alias = existing?.alias ?? uniqueAlias(state.instances, aliasFromUrl(instanceUrl))
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
      instanceUrl,
      alias,
    }
    await this.patchState({ pending })
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
    const instanceUrl = asText(pending?.instanceUrl)
    if (state === undefined || pending === undefined || instanceUrl === '') {
      throw new FlareMoError(CODES.NO_PENDING_CONNECT, '没有进行中的配对，请先发起配对')
    }
    if (millisUntil(pending.expiresAt, this.clock) <= 0) {
      await this.patchState({ pending: undefined })
      return { status: 'expired' }
    }

    try {
      const token = await this.client.exchangeDeviceCode(instanceUrl, asText(pending.deviceCode))
      const account = await this.client.getAccount(instanceUrl, token.accessToken)
      const now = this.clock()
      const current = (await this.readState()) ?? emptyState()
      const id = instanceIdFor(instanceUrl)
      const existing = current.instances.find((instance) => instance.id === id)
      const instance = sanitizeInstance({
        id,
        alias: existing?.alias ?? uniqueAlias(current.instances, asText(pending.alias) || aliasFromUrl(instanceUrl), id),
        instanceUrl,
        account,
        scope: token.scope ?? existing?.scope,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        accessExpiresAt: token.expiresInSeconds === undefined
          ? existing?.accessExpiresAt
          : new Date(now + token.expiresInSeconds * 1000).toISOString(),
        connectedAt: new Date(now).toISOString(),
        lastSyncAt: new Date(now).toISOString(),
      })
      const instances = [...current.instances.filter((row) => row.id !== id)]
      if (instance !== undefined) instances.push(instance)
      await this.writeState({ version: STATE_VERSION, activeId: id, instances })
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

  /** 取消进行中的配对：只清 pending，已保存的 token（含其它实例）不动。 */
  async cancelConnect() {
    await this.patchState({ pending: undefined })
    return this.status()
  }

  /** 移除当前 active 实例（服务端吊销去 FlareMo 的「已连接应用」页）。 */
  async disconnect() {
    const state = await this.readState()
    const active = this.resolveInstance(state, '')
    if (active === undefined) {
      if (state !== undefined) await this.store.clear()
      return this.status()
    }
    return this.removeInstance({ id: active.id })
  }

  // ── token 生命周期（按实例隔离）───────────────────────────────────

  /**
   * 单飞刷新：同一实例的并发调用共用同一个刷新请求，避免轮换互相作废；
   * 不同实例互不影响。
   * @param {object} instance - instance record (may be stale).
   * @returns {Promise<string>} the fresh access token.
   */
  async refreshAccessToken(instance) {
    const id = asText(instance?.id)
    if (id === '') throw new FlareMoError(CODES.NOT_CONNECTED, '还没有连接 FlareMo 实例')
    const inflight = this.refreshPromises.get(id)
    if (inflight !== undefined) return inflight
    const promise = this.refreshInstance(id).finally(() => {
      this.refreshPromises.delete(id)
    })
    this.refreshPromises.set(id, promise)
    return promise
  }

  async refreshInstance(id) {
    const state = await this.readState()
    const current = state?.instances.find((instance) => instance.id === id)
    const instanceUrl = asText(current?.instanceUrl)
    const refreshToken = asText(current?.refreshToken)
    if (current === undefined || instanceUrl === '' || asText(current.accessToken) === '') {
      throw new FlareMoError(CODES.NOT_CONNECTED, '还没有连接 FlareMo 实例')
    }
    if (refreshToken === '') {
      await this.dropInstanceTokens(id)
      throw new FlareMoError(CODES.AUTH_EXPIRED, '访问令牌已失效且没有刷新令牌，请重新配对')
    }
    try {
      const token = await this.client.refresh(instanceUrl, refreshToken)
      const now = this.clock()
      await this.updateInstance(id, () => ({
        accessToken: token.accessToken,
        // refresh_token 轮换：服务端只认新的这一对
        refreshToken: token.refreshToken ?? refreshToken,
        accessExpiresAt: token.expiresInSeconds === undefined
          ? current.accessExpiresAt
          : new Date(now + token.expiresInSeconds * 1000).toISOString(),
        scope: token.scope ?? current.scope,
        refreshedAt: new Date(now).toISOString(),
      }))
      return token.accessToken
    } catch (error) {
      if (
        error instanceof FlareMoError &&
        (error.code === 'invalid_grant' || error.code === 'expired_token' || error.status === 401)
      ) {
        await this.dropInstanceTokens(id)
        throw new FlareMoError(CODES.AUTH_EXPIRED, '刷新令牌已失效，请重新配对', { detail: error.message })
      }
      throw error
    }
  }

  /**
   * 带鉴权执行一次数据请求：先按需刷新，401 时刷新后重试一次。
   * @template T
   * @param {object} instance - instance record to use.
   * @param {(instanceUrl: string, accessToken: string) => Promise<T>} run - the data call.
   * @returns {Promise<T>} the call result.
   */
  async withAuth(instance, run) {
    const state = await this.readState()
    const current = state?.instances.find((row) => row.id === instance.id)
    const instanceUrl = asText(current?.instanceUrl)
    if (current === undefined || instanceUrl === '' || asText(current.accessToken) === '') {
      throw new FlareMoError(CODES.NOT_CONNECTED, '还没有连接 FlareMo 实例')
    }
    let accessToken = asText(current.accessToken)
    if (asText(current.accessExpiresAt) !== '' && millisUntil(current.accessExpiresAt, this.clock) < REFRESH_SKEW_MS) {
      accessToken = await this.refreshAccessToken(current)
    }
    try {
      return await run(instanceUrl, accessToken)
    } catch (error) {
      if (!(error instanceof FlareMoError) || error.status !== 401) throw error
      // Re-read the stored token first: the panel issues several requests at
      // once, so a sibling may already have rotated it while this one was in
      // flight. Using that token avoids a second refresh — refresh tokens are
      // single-use, so a redundant refresh would invalidate the good one and
      // turn one 401 into a cascade.
      const latest = (await this.readState())?.instances.find((row) => row.id === instance.id)
      const latestToken = asText(latest?.accessToken)
      if (latestToken !== '' && latestToken !== accessToken) {
        return run(instanceUrl, latestToken)
      }
      const fresh = await this.refreshAccessToken(latest ?? current)
      return run(instanceUrl, fresh)
    }
  }

  /** 「最后同步」写回，每个实例最多每 60s 一次（数据成功时调用）。 */
  async touchLastSync(instanceId) {
    const id = asText(instanceId)
    if (id === '') return
    const now = this.clock()
    const last = this.lastSyncWrites.get(id) ?? 0
    if (now - last < LAST_SYNC_THROTTLE_MS) return
    this.lastSyncWrites.set(id, now)
    await this.updateInstance(id, () => ({ lastSyncAt: new Date(now).toISOString() }))
  }

  // ── 数据面 ────────────────────────────────────────────────────────

  /**
   * 列笔记 / 搜索笔记共用。
   * @param {{ pageSize?: unknown, pageToken?: unknown, orderBy?: unknown,
   *   q?: unknown, tag?: unknown, state?: unknown, visibility?: unknown,
   *   instance?: unknown }} args - RPC args.
   * @returns {Promise<{ notes: object[], nextPageToken?: string }>}
   */
  async fetchNotes(args = {}) {
    const pageSize = clampInt(args.pageSize, 1, 100, 30)
    const state = pickEnum(args.state, NOTE_STATES)
    const visibility = pickEnum(args.visibility, NOTE_VISIBILITIES)
    const { instance } = await this.requireInstance(args.instance)
    const result = await this.withAuth(instance, (instanceUrl, accessToken) =>
      this.client.listMemos(instanceUrl, accessToken, {
        pageSize,
        pageToken: asText(args.pageToken) || undefined,
        orderBy: asText(args.orderBy) || 'created_at desc',
        q: asText(args.q) || undefined,
        tag: asText(args.tag) || undefined,
        state,
        visibility,
      }),
    )
    await this.touchLastSync(instance.id)
    return {
      notes: result.memos.map(toNoteView),
      ...(result.nextPageToken === undefined ? {} : { nextPageToken: result.nextPageToken }),
    }
  }

  /** 列表（默认按创建时间倒序）。 */
  async listNotes(args = {}) {
    return this.fetchNotes(args)
  }

  /**
   * 新建便签（网页版编写框用）。
   * @param {{ content?: unknown, visibility?: unknown, source?: unknown,
   *   instance?: unknown }} [args] - RPC args.
   * @returns {Promise<{ note: object }>} narrow note view.
   */
  async createNote(args = {}) {
    const content = asText(args.content).trim()
    if (content === '') {
      throw new FlareMoError(CODES.BAD_ARGS, '便签内容不能为空')
    }
    if (content.length > NOTE_CONTENT_MAX) {
      throw new FlareMoError(CODES.BAD_ARGS, `便签内容不能超过 ${NOTE_CONTENT_MAX} 个字符`, {
        params: { limit: NOTE_CONTENT_MAX },
      })
    }
    const rawVisibility = asText(args.visibility).trim()
    const visibility = rawVisibility === '' ? 'private' : rawVisibility
    if (!NOTE_VISIBILITIES.includes(visibility)) {
      throw new FlareMoError(CODES.BAD_ARGS, 'visibility 只支持 private / public', {
        params: { value: visibility },
      })
    }
    const source = asText(args.source).trim() || 'dsh'
    const { instance } = await this.requireInstance(args.instance)
    const dto = await this.withAuth(instance, (instanceUrl, accessToken) =>
      this.client.createMemo(instanceUrl, accessToken, { content, visibility, source }),
    )
    await this.touchLastSync(instance.id)
    return { note: toNoteView(dto) }
  }

  /** 服务端搜索：q 是 FlareMo 的检索语法（支持 has:attachment / is:pinned / before:…）。 */
  async searchNotes(args = {}) {
    const query = asText(args.query ?? args.q).trim()
    if (query === '') throw new FlareMoError(CODES.BAD_ARGS, '搜索关键词不能为空')
    return this.fetchNotes({ ...args, q: query })
  }

  /** 单条笔记 + 关系 / 反链。详情页要全文，所以正文上限放到服务端的 100k。 */
  async getNote(args = {}) {
    const id = asText(args.id).trim()
    if (id === '') throw new FlareMoError(CODES.BAD_ARGS, '缺少笔记 id')
    const { instance } = await this.requireInstance(args.instance)
    const result = await this.withAuth(instance, (instanceUrl, accessToken) =>
      this.client.getMemo(instanceUrl, accessToken, id),
    )
    const relations = result.relations.map(toNoteRef).filter(Boolean)
    const backlinks = result.backlinks.map(toNoteRef).filter(Boolean)
    return {
      note: toNoteView(result.memo, { contentLimit: NOTE_CONTENT_MAX }),
      relations,
      backlinks,
      canManage: result.canManage,
      canGovern: result.canGovern,
    }
  }

  /** 标签（拍平，带 count）。 */
  async listTags(args = {}) {
    const { instance } = await this.requireInstance(args.instance)
    const tree = await this.withAuth(instance, (instanceUrl, accessToken) =>
      this.client.listTags(instanceUrl, accessToken),
    )
    const tags = flattenTags(tree)
    return { tags: tags.sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name)) }
  }

  /**
   * 侧边栏统计卡 + 日历热力（服务端 snake_case → wire camelCase）。
   * @param {{ timeZone?: unknown, days?: unknown, until?: unknown, instance?: unknown }} [args]
   * @returns {Promise<{ counts: { normal: number, archived: number, trashed: number,
   *   total: number }, activeDays: number, tags: { name: string, count: number }[],
   *   activity: { date: string, count: number }[] }>}
   */
  async memoStats(args = {}) {
    const timeZone = asText(args.timeZone).trim() || 'UTC'
    const days = clampInt(args.days, 1, 366, 84)
    // 日历翻到历史月份时用它当初热力窗口的右端；格式不对就交给服务端按今天算。
    const until = DATE_KEY.test(asText(args.until)) ? asText(args.until) : undefined
    const { instance } = await this.requireInstance(args.instance)
    const body = await this.withAuth(instance, (instanceUrl, accessToken) =>
      this.client.getMemoStats(instanceUrl, accessToken, { timeZone, days, until }),
    )
    await this.touchLastSync(instance.id)
    const counts = body.counts
    const tags = Array.isArray(body.tags) ? body.tags.filter(isRecord) : []
    const activity = Array.isArray(body.activity) ? body.activity.filter(isRecord) : []
    return {
      counts: {
        normal: countOf(counts.normal),
        archived: countOf(counts.archived),
        trashed: countOf(counts.trashed),
        total: countOf(counts.total),
      },
      activeDays: countOf(body.active_days),
      tags: tags.map((tag) => ({ name: asText(tag.name), count: countOf(tag.count) })),
      activity: activity.map((entry) => ({ date: asText(entry.date), count: countOf(entry.count) })),
    }
  }

  // ── 洞察任务（执行器的数据面）──────────────────────────────────────

  /**
   * 拉取洞察任务（默认 pending）。
   * @param {{ status?: unknown, limit?: unknown, instance?: unknown }} [args]
   * @returns {Promise<{ insights: object[] }>}
   */
  async listInsights(args = {}) {
    const status = asText(args.status) || 'pending'
    const limit = clampInt(args.limit, 1, 100, 50)
    const { instance } = await this.requireInstance(args.instance)
    const result = await this.withAuth(instance, (instanceUrl, accessToken) =>
      this.client.listInsights(instanceUrl, accessToken, { status, limit }),
    )
    return { insights: result.insights.map(toInsightView) }
  }

  /**
   * 读一条洞察任务。
   * @param {{ id?: unknown, instance?: unknown }} [args]
   * @returns {Promise<{ insight: object }>}
   */
  async getInsight(args = {}) {
    const id = asText(args.id).trim()
    if (id === '') throw new FlareMoError(CODES.BAD_ARGS, '缺少洞察任务 id')
    const { instance } = await this.requireInstance(args.instance)
    const dto = await this.withAuth(instance, (instanceUrl, accessToken) =>
      this.client.getInsight(instanceUrl, accessToken, bareInsightId(id)),
    )
    return { insight: toInsightView(dto) }
  }

  /** 认领任务：pending → running（同一个任务重复认领是幂等的）。 */
  async claimInsight(insightId, options = {}) {
    const id = asText(insightId).trim()
    if (id === '') throw new FlareMoError(CODES.BAD_ARGS, '缺少洞察任务 id')
    const { instance } = await this.requireInstance(options.instance)
    const dto = await this.withAuth(instance, (instanceUrl, accessToken) =>
      this.client.writeInsight(instanceUrl, accessToken, id, {
        status: 'running',
        executor: EXECUTOR_NAME,
      }),
    )
    return toInsightView(dto)
  }

  /** 写回成功结果（done/failed 是 first-write-wins 的终态）。 */
  async completeInsight(insightId, result, options = {}) {
    const id = asText(insightId).trim()
    if (id === '') throw new FlareMoError(CODES.BAD_ARGS, '缺少洞察任务 id')
    const { instance } = await this.requireInstance(options.instance)
    const dto = await this.withAuth(instance, (instanceUrl, accessToken) =>
      this.client.writeInsight(instanceUrl, accessToken, id, {
        status: 'done',
        executor: EXECUTOR_NAME,
        result,
      }),
    )
    return toInsightView(dto)
  }

  /** 写回失败原因。 */
  async failInsight(insightId, message, options = {}) {
    const id = asText(insightId).trim()
    if (id === '') throw new FlareMoError(CODES.BAD_ARGS, '缺少洞察任务 id')
    const error = truncate(asText(message) || '洞察执行失败', ERROR_MAX_CHARS)
    const { instance } = await this.requireInstance(options.instance)
    const dto = await this.withAuth(instance, (instanceUrl, accessToken) =>
      this.client.writeInsight(instanceUrl, accessToken, id, {
        status: 'failed',
        executor: EXECUTOR_NAME,
        error,
      }),
    )
    return toInsightView(dto)
  }
}
