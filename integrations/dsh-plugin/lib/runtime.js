/**
 * Typert Remote 服务：wire 方法 = 服务方法，方法名和 contract.js 的 METHODS 一致。
 *
 * 这一层只做三件事：
 *  1. 继承 `TypertRemoteService`，让 host 侧 `ctx.typert.register(TYPERT_MANIFEST)`
 *     能找到同名服务（`ctx.flaremo`）并把它导出给 client；
 *  2. 把参数原样转给 lib/connection.js（业务与状态机都在那边，纯逻辑好测）；
 *  3. 把异常统一折成 `{ ok:false, code, message }` envelope —— 绝不让异常漏到
 *     RPC 层（否则 client 只能看到 gateway/internal，拿不到可映射的机器码）。
 */

import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import { SERVICE_KEY } from '../contract.js'
import { EmbedProxy } from './embed-proxy.js'
import { FlareMoConnection } from './connection.js'
import { failureFrom, ok } from './errors.js'
import { FlareMoClient } from './flaremo-client.js'
import { HttpClient } from './http.js'
import { InsightExecutor } from './insight-executor.js'
import { createModelCaller } from './model.js'
import { ConnectionStore } from './store.js'
import { asText } from './util.js'

export class FlareMoRuntime extends TypertRemoteService {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
   * @param {{ fetchImpl?: typeof fetch, clock?: () => number, timeoutMs?: number,
   *   store?: ConnectionStore }} [options] - injection seams for tests.
   */
  constructor(ctx, options = {}) {
    super(ctx, SERVICE_KEY)
    this.ctx = ctx
    const clock = options.clock ?? (() => Date.now())
    const http = new HttpClient({
      fetchImpl: options.fetchImpl ?? globalThis.fetch,
      timeoutMs: options.timeoutMs,
      clock,
    })
    const client = new FlareMoClient({ http, clock })
    const store = options.store ?? new ConnectionStore(ctx)
    /** 业务与状态机；测试直接拿它断言。 */
    this.connection = new FlareMoConnection({ store, client, clock })
    /** 模型调用器（options.model 是测试注入口）。 */
    this.modelCaller = options.model ?? createModelCaller(ctx, { llm: options.llm })
    /** 洞察执行器：拉 pending → 调模型 → 写回。 */
    this.executor = new InsightExecutor({
      connection: this.connection,
      model: this.modelCaller,
      logger: pickLogger(ctx),
    })
    /**
     * 内嵌网页版的本地反代。`null` 表示宿主没有 `node:http`（例如纯浏览器
     * 环境）或已被显式关闭；面板会退回「未连接」提示而不是白屏。
     */
    this.embed = null
    if (options.embed !== false) {
      try {
        this.embed = new EmbedProxy({ connection: this.connection, logger: pickLogger(ctx), port: options.embedPort })
      } catch {
        this.embed = null
      }
    }
  }

  /**
   * 让反代跟上当前 active 实例，并在需要时启动/停止它。
   *
   * 这里不做「在 switchInstance 里插 hook」：连接状态有六个写入路径
   * （连接、轮询成功、切换、移除、断开、token 刷新），逐个插会漏。统一在
   * 每次 RPC 进入时同步一次，成本是一次 store 读（已有节流）。
   * @returns {Promise<void>}
   */
  async syncEmbed() {
    if (this.embed === null) return
    let activeId = null
    try {
      const state = await this.connection.readState()
      const active = state?.instances.find((row) => row.id === state.activeId)
      if (active !== undefined && asText(active.accessToken) !== '') activeId = active.id
    } catch {
      activeId = null
    }
    this.embed.rebind(activeId)
    if (activeId === null) {
      await this.embed.stop()
      return
    }
    if (this.embed.url === null) {
      try {
        await this.embed.start()
      } catch (error) {
        this.embed = null
        throw error
      }
    }
  }

  /**
   * 统一的 envelope 边界。
   * @template T
   * @param {() => Promise<T>} run - the business call.
   * @returns {Promise<object>} `{ ok:true, ...payload }` or a failure envelope.
   */
  async execute(run) {
    try {
      const payload = await run()
      return ok(payload ?? {})
    } catch (error) {
      return failureFrom(error)
    }
  }

  // ── wire 方法 ─────────────────────────────────────────────────────

  /** 连接状态（不含任何 token）。 */
  async connectionStatus(args) {
    return this.execute(async () => {
      const connection = await this.connection.status()
      // 只对齐绑定，不在这里起服务：面板没显示 iframe 时不该占端口。
      if (this.embed !== null) {
        this.embed.rebind(activeInstanceIdOf(connection))
        if (this.embed.url !== null && connection.connected !== true) await this.embed.stop()
      }
      return { connection, embedUrl: this.embed?.url ?? null }
    })
  }

  /**
   * 内嵌网页版的入口地址。
   *
   * 返回 `{ url }`：面板把它塞进 iframe 即可。`null` 表示宿主不支持本地监听
   * （或端口全被占用），此时面板显示一条可读的降级提示。
   */
  async embedTarget(args) {
    return this.execute(async () => {
      await this.syncEmbed()
      return { url: this.embed?.url ?? null }
    })
  }

  /** 停止内嵌反代（插件卸载 / 面板关闭时调用，幂等）。 */
  async shutdownEmbed() {
    await this.embed?.stop()
  }

  /** 具名实例列表（alias / 地址 / 账号 / 最后同步 / 是否 active）。 */
  async listInstances(args) {
    return this.execute(async () => this.connection.listInstances())
  }

  /** 切换 active 实例：之后数据面默认落到它。 */
  async switchInstance(args) {
    return this.execute(async () => {
      const connection = await this.connection.switchInstance(args)
      return { connection, instances: connection.instances, activeId: connection.activeId }
    })
  }

  /** 改实例显示名（alias，1–40 字符、唯一）。 */
  async renameInstance(args) {
    return this.execute(async () => this.connection.renameInstance(args))
  }

  /** 移除一个实例（清掉它的 token 与本地状态）。 */
  async removeInstance(args) {
    return this.execute(async () => {
      const connection = await this.connection.removeInstance(args)
      return { connection, instances: connection.instances, activeId: connection.activeId }
    })
  }

  /** 校验实例地址、申请配对码。 */
  async connectStart(args) {
    return this.execute(async () => ({ connection: await this.connection.connectStart(args) }))
  }

  /** 轮询一次配对：pending / connected / expired / denied。 */
  async connectPoll(args) {
    return this.execute(async () => this.connection.connectPoll(args))
  }

  /** 取消进行中的配对。 */
  async connectCancel(args) {
    return this.execute(async () => ({ connection: await this.connection.cancelConnect() }))
  }

  /** 断开本地连接。 */
  async disconnect(args) {
    return this.execute(async () => ({ connection: await this.connection.disconnect() }))
  }

  /** 列笔记（默认 created_at desc，page_size 30；可过滤 state / visibility）。 */
  async listNotes(args) {
    return this.execute(async () => this.connection.listNotes(args))
  }

  /** 新建便签（返回 `{ note }` 窄视图）。 */
  async createNote(args) {
    return this.execute(async () => this.connection.createNote(args))
  }

  /** 服务端搜索（FlareMo 的 q 语法）。 */
  async searchNotes(args) {
    return this.execute(async () => this.connection.searchNotes(args))
  }

  /** 单条笔记 + 关系 / 反链。 */
  async getNote(args) {
    return this.execute(async () => this.connection.getNote(args))
  }

  /** 标签（层级拍平，带 count）。 */
  async listTags(args) {
    return this.execute(async () => this.connection.listTags(args))
  }

  /** 侧边栏统计卡 + 日历热力（counts / activeDays / tags / activity）。 */
  async memoStats(args) {
    return this.execute(async () => this.connection.memoStats(args))
  }

  /** FlareMo 上 pending 的洞察任务（附带「DSH 模型是否可用」）。 */
  async listPendingInsights(args) {
    return this.execute(async () => this.executor.listPending(args))
  }

  /** 跑一条洞察任务：成功写回 done，失败写回 failed。 */
  async runInsight(args) {
    return this.execute(async () => ({
      result: await this.executor.runOne(args?.id, { instance: args?.instance }),
    }))
  }

  /** 批量跑 pending 队列（默认 3 条，最多 10 条，逐条串行）。 */
  async runPendingInsights(args) {
    return this.execute(async () => this.executor.runPending(args))
  }
}

/** 可选日志：宿主没提供 logger 服务时返回 undefined。 */
function pickLogger(ctx) {
  try {
    if (typeof ctx?.logger !== 'function') return undefined
    return ctx.logger('dsh-flaremo')
  } catch {
    return undefined
  }
}

/**
 * 连接视图里的 active 实例 id；没连接或没实例时返回 null。
 * @param {{ connected?: boolean, activeId?: string | null } | null} connection - status view.
 * @returns {string | null} the active instance id.
 */
function activeInstanceIdOf(connection) {
  if (connection?.connected !== true) return null
  return asText(connection.activeId) || null
}
