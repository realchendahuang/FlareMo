/**
 * 洞察执行器：把 FlareMo 上 pending 的洞察任务跑成结果并写回。
 *
 * 一次任务的生命周期（对应 FlareMo 的状态机 pending → running → done | failed）：
 *   1. GET 任务（拿 kind / input）；
 *   2. PUT {status:"running"} 认领（可选但更稳：避免两个执行器同时跑同一条）；
 *   3. 按 kind 组装笔记（note=memo_ids 逐条取；digest/map=tag/query 列表）；
 *   4. 组装 prompt（笔记按不可信数据处理、单条与总量都截断）→ 调 DSH 模型；
 *   5. 解析 JSON → 收敛字段 → PUT {status:"done", result, executor}；
 *   6. 任何一步失败：PUT {status:"failed", error, executor}，并把错误回报给调用方。
 *
 * 关键取舍：失败**一定写回 failed**，绝不吞掉；写回本身失败时原始错误仍会返回，
 * 并在结果里带上 writeBackError，方便用户重试或手动处理。
 */

import { CODES, FlareMoError } from './errors.js'
import {
  EXECUTOR_NAME,
  MAX_NOTES,
  MAX_TOKENS,
  bareMemoId,
  buildSystemPrompt,
  buildUserPrompt,
  capResult,
  clampError,
  describeInsightTask,
  extractJsonObject,
  normalizeInsightResult,
} from './insight.js'
import { asText, clampInt, errorMessage } from './util.js'

/** 一次 `runPendingInsights` 默认跑几条（每条一次模型调用）。 */
export const DEFAULT_BATCH = 3
/** 一次批量最多跑几条。 */
export const MAX_BATCH = 10
/** 单条任务里模型调用的默认超时。 */
export const MODEL_TIMEOUT_MS = 120_000
/** 列表默认拉多少条 pending 用于显示。 */
export const PENDING_LIST_LIMIT = 50

/** 终态判定。 */
function isTerminal(status) {
  return status === 'done' || status === 'failed'
}

export class InsightExecutor {
  /**
   * @param {{ connection: import('./connection.js').FlareMoConnection,
   *   model: { describe?: Function, call: Function },
   *   timeoutMs?: number,
   *   logger?: { warn?: Function } }} options
   */
  constructor(options) {
    this.connection = options.connection
    this.model = options.model
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : MODEL_TIMEOUT_MS
    this.logger = options.logger
  }

  /** 模型可用性（设置页展示；不抛错）。 */
  async modelStatus() {
    try {
      if (typeof this.model?.describe !== 'function') return { available: true, provider: null, model: null, reason: null }
      return await this.model.describe()
    } catch (error) {
      return { available: false, provider: null, model: null, reason: errorMessage(error) }
    }
  }

  /**
   * 列出 pending 任务（给 UI 显示数量与队列）。
   * @param {{ limit?: unknown }} [args]
   * @returns {Promise<{ insights: object[], count: number, model: object }>}
   */
  async listPending(args = {}) {
    const limit = clampInt(args.limit, 1, 100, PENDING_LIST_LIMIT)
    const [listed, model] = await Promise.all([
      this.connection.listInsights({ status: 'pending', limit, instance: args.instance }),
      this.modelStatus(),
    ])
    return { insights: listed.insights, count: listed.insights.length, model }
  }

  /**
   * 跑一条任务。永不抛出业务异常：成功/失败都折成结果对象。
   * @param {string} insightId - insight id（`insights/<uuid>` 或裸 id）。
   * @returns {Promise<{ id: string, kind: string, status: 'done'|'failed'|'skipped',
   *   code?: string, error?: string|null, notes?: number, model?: string,
   *   result?: object, reason?: string, writeBackError?: string }>}
   */
  async runOne(insightId, options = {}) {
    const instance = options.instance
    const id = asText(insightId).trim()
    if (id === '') throw new FlareMoError(CODES.BAD_ARGS, '缺少洞察任务 id')

    // 1. 先读任务：已经是终态就不占用模型
    const existing = await this.connection.getInsight({ id, instance })
    if (isTerminal(existing.insight.status)) {
      return {
        id: existing.insight.id,
        kind: existing.insight.kind,
        status: 'skipped',
        reason: existing.insight.status,
        error: existing.insight.error,
      }
    }

    // 2. 认领：pending → running
    let task
    try {
      task = await this.connection.claimInsight(existing.insight.id, { instance })
    } catch (error) {
      // 竞态：别的执行器刚把它做完 —— 重新读一次，终态就当跳过
      try {
        const fresh = await this.connection.getInsight({ id: existing.insight.id, instance })
        if (isTerminal(fresh.insight.status)) {
          return {
            id: fresh.insight.id,
            kind: fresh.insight.kind,
            status: 'skipped',
            reason: fresh.insight.status,
            error: fresh.insight.error,
          }
        }
      } catch {
        /* 读不回来就把认领错误原样抛给调用方 */
      }
      throw error
    }
    if (isTerminal(task.status)) {
      return { id: task.id, kind: task.kind, status: 'skipped', reason: task.status, error: task.error }
    }

    let noteCount = 0
    try {
      // 3. 组装笔记
      const notes = await this.gatherNotes(task, { instance })
      noteCount = notes.length
      if (notes.length === 0) {
        throw new FlareMoError(CODES.INSIGHT_NO_NOTES, '任务没有可用的笔记（可能已删除或没有权限）')
      }

      // 4. 调模型（带超时；笔记内容按不可信数据处理）
      const { text, provider, model } = await this.callModel({
        system: buildSystemPrompt(),
        prompt: buildUserPrompt(task, notes),
        maxTokens: MAX_TOKENS,
      })

      // 5. 解析 + 收敛 + 裁剪，然后写回 done
      const result = capResult(normalizeInsightResult(extractJsonObject(text)))
      await this.connection.completeInsight(task.id, result, { instance })

      return {
        id: task.id,
        kind: task.kind,
        status: 'done',
        notes: noteCount,
        model: `${provider}/${model}`,
        result,
      }
    } catch (error) {
      // 6. 失败一定写回 failed
      const code = error instanceof FlareMoError ? error.code : CODES.INTERNAL
      const message = clampError(
        error instanceof FlareMoError ? `${error.code}: ${error.message}` : errorMessage(error),
      )
      let writeBackError
      try {
        await this.connection.failInsight(task.id, message, { instance })
      } catch (failure) {
        writeBackError = errorMessage(failure)
        try {
          this.logger?.warn?.(`[dsh-flaremo] 写回洞察失败: ${writeBackError}`)
        } catch {
          /* 日志不可用不影响返回 */
        }
      }
      return {
        id: task.id,
        kind: task.kind,
        status: 'failed',
        code,
        error: message,
        notes: noteCount,
        ...(writeBackError === undefined ? {} : { writeBackError }),
      }
    }
  }

  /**
   * 批量跑 pending 队列（最多 {@link MAX_BATCH} 条，逐条串行：每条一次模型调用）。
   * @param {{ limit?: unknown }} [args]
   * @returns {Promise<{ results: object[], done: number, failed: number, skipped: number,
   *   pendingBefore: number, limit: number, model: object }>}
   */
  async runPending(args = {}) {
    const limit = clampInt(args.limit, 1, MAX_BATCH, DEFAULT_BATCH)
    const listed = await this.connection.listInsights({ status: 'pending', limit, instance: args.instance })
    const queue = listed.insights.slice(0, limit)
    const results = []
    for (const task of queue) {
      try {
        results.push(await this.runOne(task.id, { instance: args.instance }))
      } catch (error) {
        // runOne 内部已兜底；这里只剩 id 非法 / 认领主流程炸掉这类情况
        results.push({
          id: task.id,
          kind: task.kind,
          status: 'failed',
          code: error instanceof FlareMoError ? error.code : CODES.INTERNAL,
          error: clampError(errorMessage(error)),
        })
      }
    }
    const count = (status) => results.filter((row) => row.status === status).length
    return {
      results,
      done: count('done'),
      failed: count('failed'),
      skipped: count('skipped'),
      pendingBefore: listed.insights.length,
      limit,
      model: await this.modelStatus(),
    }
  }

  /**
   * 按任务的 kind 与 input 取笔记（最多 {@link MAX_NOTES} 条）。
   * 单条笔记取不到时跳过，不让整单失败。
   * @param {{ kind?: string, input?: object }} task - insight view.
   * @returns {Promise<object[]>} notes with content.
   */
  async gatherNotes(task, options = {}) {
    const input = task?.input ?? {}
    const notes = []

    if (Array.isArray(input.memo_ids) && input.memo_ids.length > 0) {
      for (const memoId of input.memo_ids.slice(0, MAX_NOTES)) {
        try {
          const fetched = await this.connection.getNote({ id: bareMemoId(memoId), instance: options.instance })
          if (fetched?.note?.id) notes.push(fetched.note)
        } catch (error) {
          try {
            this.logger?.warn?.(`[dsh-flaremo] 跳过取不到的笔记 ${memoId}: ${errorMessage(error)}`)
          } catch {
            /* ignore */
          }
        }
      }
      return notes
    }

    if (asText(input.tag) !== '') {
      const listed = await this.connection.listNotes({
        tag: asText(input.tag),
        pageSize: MAX_NOTES,
        instance: options.instance,
      })
      return Array.isArray(listed?.notes) ? listed.notes.slice(0, MAX_NOTES) : []
    }

    if (asText(input.query) !== '') {
      const founded = await this.connection.searchNotes({
        query: asText(input.query),
        pageSize: MAX_NOTES,
        instance: options.instance,
      })
      return Array.isArray(founded?.notes) ? founded.notes.slice(0, MAX_NOTES) : []
    }

    throw new FlareMoError(CODES.INSIGHT_NO_NOTES, '任务没有指定 memo_ids / tag / query')
  }

  /** 调模型并套一层超时（取消时抛出 MODEL_FAILED，会被写回 failed）。 */
  async callModel({ system, prompt, maxTokens }) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await this.model.call({ system, prompt, maxTokens, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }
}

// 便于 runtime / 命令复用，不在本模块重复实现
export { EXECUTOR_NAME, describeInsightTask }
