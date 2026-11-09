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
import { FlareMoConnection } from './connection.js'
import { failureFrom, ok } from './errors.js'
import { FlareMoClient } from './flaremo-client.js'
import { HttpClient } from './http.js'
import { InsightExecutor } from './insight-executor.js'
import { createModelCaller } from './model.js'
import { ConnectionStore } from './store.js'

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
    return this.execute(async () => ({ connection: await this.connection.status() }))
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

  /** 列笔记（默认 created_at desc，page_size 30）。 */
  async listNotes(args) {
    return this.execute(async () => this.connection.listNotes(args))
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
