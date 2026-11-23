/**
 * 内嵌网页版的本地反代。
 *
 * 面板里跑的是**真正的 FlareMo 网页版**（同一个 SPA 构建产物），不是复刻的 UI。
 * 但 DSH 的 renderer 和实例不同源，会话 cookie（`SameSite=Lax`）在跨站 iframe 里
 * 不会发送，所以网页版的守卫会一路弹回 `/login`。
 *
 * 这个反代解决的问题是：浏览器只跟 `http://127.0.0.1:<port>` 说话，host 把每个
 * 请求转发到当前 active 实例，并注入 device token 的 Bearer 头。
 *
 *   - token 只在 host 进程里拼进请求头，iframe 里的 JS 永远看不到；
 *   - 多实例切换时反代跟着换目标（见 `rebind`），页面 reload 即可；
 *   - `/api/auth/get-session` 是唯一要**合成**的响应：网页版的守卫读它，
 *     而服务端那个端点只认 cookie。这里用 `/api/app/me` 的结果拼成 Better Auth
 *     的形状，让 SPA 相信自己已登录。合成内容只有公开的账号信息。
 *
 * 只绑 127.0.0.1，不监听外部接口；每个 host 只起一个实例。
 */

import { createServer } from 'node:http'
import { Readable } from 'node:stream'

import { FlareMoError } from './errors.js'
import { asText } from './util.js'

/** 反代默认端口；被占用时依次往后试。 */
export const DEFAULT_PORT = 8788
/** 端口探测上限：够避开常见的本地服务。 */
const PORT_ATTEMPTS = 24

/** 这些请求头属于逐跳（hop-by-hop），不能透传。 */
const DROP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'accept-encoding',
  'cookie',
  'origin',
  'referer',
  'content-length',
])

/** 响应头同理；`set-cookie` 额外丢掉（iframe 里没有可用的 cookie 语义）。 */
const DROP_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'transfer-encoding',
  'connection',
  'content-length',
  'set-cookie',
])

/**
 * 不需要转发给实例的路径：Service Worker 与 PWA manifest 在 iframe 里没有
 * 意义（而且 SW 会缓存页面、让切换实例后看到旧的）。
 */
const BLOCKED_PATHS = new Set(['/sw.js', '/site.webmanifest'])

/**
 * 一次会话的账号视图：用来合成 `/api/auth/get-session`。
 * @param {object} me - `/api/app/me` 的响应。
 * @returns {object} Better Auth `get-session` shape.
 */
export function sessionFromAccount(me) {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 24 * 3600_000)
  return {
    session: {
      id: 'dsh-flaremo-embed',
      userId: asText(me?.id),
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      token: 'dsh-flaremo-embed',
      ipAddress: '127.0.0.1',
      userAgent: 'dsh-flaremo-embed',
    },
    user: {
      id: asText(me?.id),
      name: asText(me?.name) || asText(me?.username) || asText(me?.id),
      email: asText(me?.email),
      emailVerified: true,
      image: asText(me?.avatar_url) || null,
      username: asText(me?.username) || null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  }
}

/**
 * 本地反代。生命周期跟着插件走：`start()` 在 host 启动时调用，
 * `rebind()` 在切换实例时调用，`stop()` 在插件卸载时调用。
 */
export class EmbedProxy {
  /**
   * @param {{ connection: import('./connection.js').FlareMoConnection,
   *   logger?: { warn?: (message: string) => void },
   *   port?: number }} options
   */
  constructor(options) {
    this.connection = options.connection
    this.logger = options.logger
    this.preferredPort = Number.isFinite(options.port) ? options.port : DEFAULT_PORT
    /** @type {import('node:http').Server | null} */
    this.server = null
    this.port = null
    /** 目标实例（由 rebind 维护；null 表示还没连接）。 */
    this.instanceId = null
    /** `/api/app/me` 的缓存，避免每帧都打一次。 */
    this.account = null
    this.accountAt = 0
  }

  /** 当前可嵌入的地址；未启动时为 null。 */
  get url() {
    return this.port === null ? null : `http://127.0.0.1:${this.port}/`
  }

  /**
   * 绑定到某个实例。切实例时调用；实例 id 变了就清掉账号缓存。
   * @param {string | null} instanceId - active instance id.
   * @returns {void}
   */
  rebind(instanceId) {
    const next = asText(instanceId) || null
    if (next === this.instanceId) return
    this.instanceId = next
    this.account = null
    this.accountAt = 0
  }

  /**
   * 启动监听。端口被占用时往后顺延，全部失败则抛出（调用方降级成提示）。
   * @returns {Promise<string>} the base URL.
   */
  async start() {
    if (this.server !== null) return this.url
    const server = createServer((req, res) => {
      void this.#handle(req, res).catch((error) => {
        this.logger?.warn?.(`[dsh-flaremo] embed proxy error: ${error?.message ?? error}`)
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('embed proxy error')
      })
    })

    for (let offset = 0; offset < PORT_ATTEMPTS; offset += 1) {
      const port = this.preferredPort + offset
      const bound = await new Promise((resolve) => {
        const onError = () => resolve(false)
        server.once('error', onError)
        server.listen(port, '127.0.0.1', () => {
          server.off('error', onError)
          resolve(true)
        })
      })
      if (bound) {
        this.server = server
        this.port = port
        return this.url
      }
    }
    throw new Error(`no free port in ${this.preferredPort}–${this.preferredPort + PORT_ATTEMPTS - 1}`)
  }

  /** 停止监听（幂等）。 */
  async stop() {
    const server = this.server
    this.server = null
    this.port = null
    if (server === null) return
    await new Promise((resolve) => server.close(() => resolve()))
  }

  /**
   * 取当前账号（带 60s 缓存）。取不到返回 null，SPA 会停在登录页。
   * @returns {Promise<object | null>}
   */
  async #account() {
    if (this.instanceId === null) return null
    const now = Date.now()
    if (this.account !== null && now - this.accountAt < 60_000) return this.account
    try {
      const me = await this.connection.withAuth({ id: this.instanceId }, async (instanceUrl, accessToken) => {
        const response = await fetch(`${instanceUrl}/api/app/me`, {
          headers: { authorization: `Bearer ${accessToken}` },
        })
        return response.ok ? await response.json() : null
      })
      this.account = me ?? null
      this.accountAt = now
      return this.account
    } catch {
      return null
    }
  }

  /**
   * 处理一次请求。
   * @param {import('node:http').IncomingMessage} req - inbound request.
   * @param {import('node:http').ServerResponse} res - outbound response.
   * @returns {Promise<void>}
   */
  async #handle(req, res) {
    const incoming = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (BLOCKED_PATHS.has(incoming.pathname)) {
      res.writeHead(404).end()
      return
    }

    // 网页版守卫读这个端点；服务端只认 cookie，所以这里合成。
    if (incoming.pathname === '/api/auth/get-session') {
      const me = await this.#account()
      const body = me === null ? 'null' : JSON.stringify(sessionFromAccount(me))
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(body)
      return
    }

    if (this.instanceId === null) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('no FlareMo instance is connected')
      return
    }

    let body
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      body = Buffer.concat(chunks)
    }

    const headers = {}
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined || DROP_REQUEST_HEADERS.has(key)) continue
      headers[key] = Array.isArray(value) ? value.join(', ') : value
    }

    // 数据面的每一个请求都带 Bearer。
    //
    // 这里**不**把 401 折成「令牌过期」去触发刷新：网页版会请求一些 PAT
    // 本来就无权访问的路径（账户安全、已连接应用等），它们回 401/403 是正常的，
    // 一旦被当成过期就会走刷新 → 没有 refresh token → 清掉整个连接。
    // 真正的过期由 `withAuth` 按 `accessExpiresAt` 提前刷新处理；
    // 这里只把状态码如实透传给页面，让它自己降级。
    let upstream
    try {
      upstream = await this.connection.withAuth({ id: this.instanceId }, (instanceUrl, accessToken) =>
        fetch(`${instanceUrl}${incoming.pathname}${incoming.search}`, {
          method: req.method,
          headers: { ...headers, authorization: `Bearer ${accessToken}` },
          body,
          redirect: 'manual',
        }),
      )
    } catch (error) {
      // 刷新/重试都失败：把「这条数据面不可用」如实告诉页面，而不是让整个
      // iframe 崩成 502——网页版对单个端点失败会自己降级（例如语音按钮不显示）。
      const status =
        error instanceof FlareMoError && Number.isFinite(error.status) ? Number(error.status) : 502
      res.writeHead(status >= 400 ? status : 502, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify({ error: { message: error?.message ?? 'upstream failed' } }))
      return
    }

    const outHeaders = {}
    for (const [key, value] of upstream.headers.entries()) {
      if (DROP_RESPONSE_HEADERS.has(key)) continue
      outHeaders[key] = value
    }
    // 嵌入页面的资源同源，不需要跨域头；保留实例自己给的即可。
    res.writeHead(upstream.status, outHeaders)
    if (upstream.body === null) {
      res.end()
      return
    }
    Readable.fromWeb(upstream.body).pipe(res)
  }
}
