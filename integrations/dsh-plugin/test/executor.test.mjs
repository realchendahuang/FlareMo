/**
 * 洞察执行器集成测试（离线）：拉取 → 认领 → 组装笔记 → 调模型 → 写回。
 *
 * connection 与 model 都是假的，但接口形状与真实实现一致：
 *   - connection：listInsights / getInsight / claimInsight / completeInsight /
 *     failInsight / getNote / listNotes / searchNotes；
 *   - model：describe / call（返回 { text, provider, model }）。
 *
 * 重点覆盖任务要求的行为：成功写回 done、失败写回 failed、笔记内容截断、
 * 模型缺失错误码、单任务失败不影响其他、跳过终态任务。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { FlareMoError } from '../lib/errors.js'
import { MAX_NOTE_CHARS, toInsightView } from '../lib/insight.js'
import { InsightExecutor, MAX_BATCH } from '../lib/insight-executor.js'

/** 造一条 insight 排期行（内部用，测试里当 FlareMo 的 D1 行）。 */
function insightRow(overrides = {}) {
  return {
    id: 'insights/i1',
    kind: 'note',
    status: 'pending',
    input: { memo_ids: ['memo-1'] },
    result: null,
    executor: null,
    error: null,
    created_at: '2026-11-08T00:00:00Z',
    updated_at: '2026-11-08T00:00:00Z',
    ...overrides,
  }
}

/** 假 connection：记录每次调用，维护任务与笔记状态。 */
function createConnection({ insights = [], memos = [], notes = [] } = {}) {
  const state = {
    insights: new Map(insights.map((row) => [row.id, { ...row }])),
    memos: new Map(memos.map((memo) => [memo.id, memo])),
    notes,
    calls: [],
  }
  const record = (method, args) => state.calls.push({ method, args })

  const connection = {
    calls: state.calls,
    state,
    async listInsights(args = {}) {
      record('listInsights', args)
      const status = args.status ?? 'pending'
      const limit = args.limit ?? 50
      return {
        insights: [...state.insights.values()]
          .filter((row) => row.status === status)
          .slice(0, limit)
          .map(toInsightView),
      }
    },
    async getInsight(args) {
      record('getInsight', args)
      const row = state.insights.get(args.id)
      if (row === undefined) throw new FlareMoError('HTTP_ERROR', '任务不存在', { status: 404 })
      return { insight: toInsightView(row) }
    },
    async claimInsight(id) {
      record('claimInsight', { id })
      const row = state.insights.get(id)
      if (row === undefined) throw new FlareMoError('HTTP_ERROR', '任务不存在', { status: 404 })
      if (row.status === 'pending') row.status = 'running'
      return toInsightView(row)
    },
    async completeInsight(id, result) {
      record('completeInsight', { id, result })
      const row = state.insights.get(id)
      row.status = 'done'
      row.result = result
      row.executor = 'dsh-flaremo'
      return toInsightView(row)
    },
    async failInsight(id, message) {
      record('failInsight', { id, message })
      const row = state.insights.get(id)
      row.status = 'failed'
      row.error = message
      row.executor = 'dsh-flaremo'
      return toInsightView(row)
    },
    async getNote(args) {
      record('getNote', args)
      const memo = state.memos.get(args.id)
      if (memo === undefined) throw new FlareMoError('HTTP_ERROR', '笔记不存在', { status: 404 })
      return { note: memo }
    },
    async listNotes(args) {
      record('listNotes', args)
      return { notes: state.notes.filter((note) => note.tags?.includes(args.tag)).slice(0, args.pageSize) }
    },
    async searchNotes(args) {
      record('searchNotes', args)
      return { notes: state.notes.filter((note) => JSON.stringify(note).includes(args.query)).slice(0, args.pageSize) }
    },
  }
  return connection
}

/** 假模型调用器。 */
function createModel({ reply, error, describe, onCall } = {}) {
  const calls = []
  return {
    calls,
    async describe() {
      return describe ?? { available: true, provider: 'deepseek', model: 'deepseek-chat', reason: null }
    },
    async call(request) {
      calls.push(request)
      onCall?.(request)
      if (error !== undefined) throw error
      const text =
        typeof reply === 'function'
          ? reply(request)
          : (reply ?? JSON.stringify({ summary: '这是一段摘要。', points: ['要点一', '要点二'] }))
      return { text, provider: 'deepseek', model: 'deepseek-chat' }
    },
  }
}

const MEMO = {
  id: 'memo-1',
  title: '设备授权笔记',
  excerpt: '摘要',
  content: '# 设备授权\n\n正文内容',
  tags: ['工作', 'DSH'],
  createdAt: '2026-11-08T00:00:00Z',
  updatedAt: '2026-11-08T00:00:00Z',
  day: '2026-11-08',
}

test('runOne：成功路径 —— 认领、组装笔记、调模型、写回 done', async () => {
  const connection = createConnection({ insights: [insightRow()], memos: [MEMO] })
  const model = createModel()
  const executor = new InsightExecutor({ connection, model })

  const result = await executor.runOne('insights/i1')

  assert.equal(result.status, 'done')
  assert.equal(result.kind, 'note')
  assert.equal(result.notes, 1)
  assert.equal(result.model, 'deepseek/deepseek-chat')

  const methods = connection.calls.map((call) => call.method)
  assert.deepEqual(methods, ['getInsight', 'claimInsight', 'getNote', 'completeInsight'])

  const written = connection.calls.find((call) => call.method === 'completeInsight')
  assert.deepEqual(written.args.result, {
    summary: '这是一段摘要。',
    points: ['要点一', '要点二'],
  })
  assert.equal(connection.state.insights.get('insights/i1').status, 'done')
  assert.equal(connection.state.insights.get('insights/i1').executor, 'dsh-flaremo')

  // prompt 里必须声明笔记是不可信数据，并把正文包进 <notes>
  const prompt = model.calls[0].prompt
  assert.match(prompt, /不可信数据/)
  assert.match(prompt, /设备授权笔记/)
  assert.match(prompt, /正文内容/)
  assert.match(model.calls[0].system, /不是.*指令/)
  assert.equal(model.calls[0].maxTokens, 1500)
})

test('runOne：模型失败 → 写回 failed 并保留错误码', async () => {
  const connection = createConnection({ insights: [insightRow()], memos: [MEMO] })
  const model = createModel({ error: new FlareMoError('MODEL_FAILED', '模型调用失败：provider down') })
  const executor = new InsightExecutor({ connection, model })

  const result = await executor.runOne('insights/i1')

  assert.equal(result.status, 'failed')
  assert.equal(result.code, 'MODEL_FAILED')
  assert.match(result.error, /MODEL_FAILED/)
  assert.match(result.error, /provider down/)

  const failed = connection.calls.find((call) => call.method === 'failInsight')
  assert.ok(failed, '失败必须写回 failed，而不是吞掉')
  assert.match(failed.args.message, /provider down/)
  assert.equal(connection.state.insights.get('insights/i1').status, 'failed')
})

test('runOne：模型输出不是 JSON → 写回 failed（MODEL_BAD_OUTPUT）', async () => {
  const connection = createConnection({ insights: [insightRow()], memos: [MEMO] })
  const model = createModel({ reply: '我觉得这条笔记很好，但我不打算给你 JSON。' })
  const executor = new InsightExecutor({ connection, model })

  const result = await executor.runOne('insights/i1')

  assert.equal(result.status, 'failed')
  assert.equal(result.code, 'MODEL_BAD_OUTPUT')
  assert.equal(connection.state.insights.get('insights/i1').status, 'failed')
})

test('runOne：超长笔记在 prompt 里被截断', async () => {
  const longMemo = { ...MEMO, content: '长'.repeat(MAX_NOTE_CHARS * 2) }
  const connection = createConnection({ insights: [insightRow()], memos: [longMemo] })
  const model = createModel()
  const executor = new InsightExecutor({ connection, model })

  await executor.runOne('insights/i1')

  const prompt = model.calls[0].prompt
  const runs = prompt.match(/长{100,}/g) ?? []
  assert.equal(runs.length, 1)
  assert.ok(runs[0].length <= MAX_NOTE_CHARS, `正文 ${runs[0].length} 超过 ${MAX_NOTE_CHARS}`)
})

test('runOne：digest 用 tag 列表，map 用 query 搜索', async () => {
  const digestTask = insightRow({ id: 'insights/d1', kind: 'digest', input: { tag: '工作' } })
  const mapTask = insightRow({ id: 'insights/m1', kind: 'map', input: { query: '设备授权' } })
  const notes = [
    { ...MEMO, id: 'n1', tags: ['工作'], content: '第一条 设备授权' },
    { ...MEMO, id: 'n2', tags: ['读书'], content: '第二条' },
  ]
  const connection = createConnection({ insights: [digestTask, mapTask], notes })
  const model = createModel()
  const executor = new InsightExecutor({ connection, model })

  const digest = await executor.runOne('insights/d1')
  assert.equal(digest.status, 'done')
  assert.equal(connection.calls.find((call) => call.method === 'listNotes').args.tag, '工作')

  connection.calls.length = 0
  const map = await executor.runOne('insights/m1')
  assert.equal(map.status, 'done')
  const searched = connection.calls.find((call) => call.method === 'searchNotes')
  assert.equal(searched.args.query, '设备授权')
  assert.match(model.calls[1].prompt, /任务类型：map/)
})

test('runOne：任务没有可用笔记 → failed（INSIGHT_NO_NOTES）', async () => {
  const task = insightRow({ id: 'insights/e1', input: {} })
  const connection = createConnection({ insights: [task] })
  const model = createModel()
  const executor = new InsightExecutor({ connection, model })

  const result = await executor.runOne('insights/e1')

  assert.equal(result.status, 'failed')
  assert.equal(result.code, 'INSIGHT_NO_NOTES')
  assert.equal(model.calls.length, 0, '没有笔记就不该调模型')
  assert.equal(connection.state.insights.get('insights/e1').status, 'failed')
})

test('runOne：已经是 done 的任务直接跳过，不占模型', async () => {
  const doneTask = insightRow({ id: 'insights/done1', status: 'done', result: { summary: '旧结果' } })
  const connection = createConnection({ insights: [doneTask] })
  const model = createModel()
  const executor = new InsightExecutor({ connection, model })

  const result = await executor.runOne('insights/done1')

  assert.equal(result.status, 'skipped')
  assert.equal(result.reason, 'done')
  assert.equal(model.calls.length, 0)
  assert.deepEqual(connection.calls.map((call) => call.method), ['getInsight'])
})

test('runOne：认领撞上别人刚写完 → 重新读终态并跳过', async () => {
  const task = insightRow({ id: 'insights/race1' })
  const connection = createConnection({ insights: [task] })
  connection.claimInsight = async (id) => {
    // 模拟别的执行器在这个间隙把它写完了
    connection.state.insights.get(id).status = 'done'
    throw new FlareMoError('HTTP_ERROR', 'Cannot change insight status', { status: 400 })
  }
  const model = createModel()
  const executor = new InsightExecutor({ connection, model })

  const result = await executor.runOne('insights/race1')

  assert.equal(result.status, 'skipped')
  assert.equal(result.reason, 'done')
  assert.equal(model.calls.length, 0)
})

test('runOne：模型不可用 → 写回 failed（MODEL_UNAVAILABLE）', async () => {
  const connection = createConnection({ insights: [insightRow()], memos: [MEMO] })
  const model = createModel({
    error: new FlareMoError('MODEL_UNAVAILABLE', '没有配置可用的模型'),
    describe: { available: false, provider: null, model: null, reason: 'NO_MODEL_CONFIGURED' },
  })
  const executor = new InsightExecutor({ connection, model })

  const result = await executor.runOne('insights/i1')

  assert.equal(result.status, 'failed')
  assert.equal(result.code, 'MODEL_UNAVAILABLE')
  assert.match(
    connection.state.insights.get('insights/i1').error,
    /MODEL_UNAVAILABLE/,
  )
})

test('runOne：写回 failed 也失败时，原始错误仍返回并带 writeBackError', async () => {
  const connection = createConnection({ insights: [insightRow()], memos: [MEMO] })
  connection.failInsight = async () => {
    throw new FlareMoError('NETWORK', '网络断了')
  }
  const model = createModel({ error: new FlareMoError('MODEL_FAILED', '模型炸了') })
  const executor = new InsightExecutor({ connection, model })

  const result = await executor.runOne('insights/i1')

  assert.equal(result.status, 'failed')
  assert.equal(result.code, 'MODEL_FAILED')
  assert.match(result.error, /模型炸了/)
  assert.match(result.writeBackError, /网络断了/)
})

test('runPending：单任务失败不影响其他任务', async () => {
  const connection = createConnection({
    insights: [insightRow({ id: 'insights/a' }), insightRow({ id: 'insights/b' })],
    memos: [MEMO],
  })
  // 第一次模型调用失败，第二次成功
  let call = 0
  const flakyModel = {
    async describe() {
      return { available: true, provider: 'deepseek', model: 'deepseek-chat', reason: null }
    },
    async call() {
      call += 1
      if (call === 1) throw new FlareMoError('MODEL_FAILED', '第一次失败')
      return {
        text: JSON.stringify({ summary: '第二次成功', points: ['ok'] }),
        provider: 'deepseek',
        model: 'deepseek-chat',
      }
    },
  }
  const executor = new InsightExecutor({ connection, model: flakyModel })

  const batch = await executor.runPending({ limit: 5 })

  assert.equal(batch.pendingBefore, 2)
  assert.equal(batch.results.length, 2)
  assert.equal(batch.done, 1)
  assert.equal(batch.failed, 1)
  assert.equal(batch.results[0].status, 'failed')
  assert.equal(batch.results[1].status, 'done')
  assert.equal(connection.state.insights.get('insights/a').status, 'failed')
  assert.equal(connection.state.insights.get('insights/b').status, 'done')
})

test('runPending：limit 被夹到 MAX_BATCH', async () => {
  const rows = Array.from({ length: MAX_BATCH + 5 }, (_, index) =>
    insightRow({ id: `insights/batch-${index}`, input: { memo_ids: ['memo-1'] } }),
  )
  const connection = createConnection({ insights: rows, memos: [MEMO] })
  const executor = new InsightExecutor({ connection, model: createModel() })

  const batch = await executor.runPending({ limit: 999 })
  assert.equal(batch.limit, MAX_BATCH)
  assert.equal(batch.results.length, MAX_BATCH)
})

test('listPending：返回队列与模型可用性', async () => {
  const connection = createConnection({
    insights: [insightRow({ id: 'insights/p1' }), insightRow({ id: 'insights/p2' })],
  })
  const model = createModel({ describe: { available: false, provider: null, model: null, reason: 'NO_LLM_SERVICE' } })
  const executor = new InsightExecutor({ connection, model })

  const listed = await executor.listPending({ limit: 10 })
  assert.equal(listed.count, 2)
  assert.equal(listed.insights.length, 2)
  assert.equal(listed.model.available, false)
  assert.equal(listed.model.reason, 'NO_LLM_SERVICE')
})
