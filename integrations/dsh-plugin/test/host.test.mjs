/**
 * Host 半片测试：连接状态机、设备授权、401 刷新、数据映射、RPC envelope。
 *
 * 全部离线：fetch 用脚本化的假实现（返回真的 `Response`），时钟固定，
 * 凭据存储用进程内 ConnectionStore。TypertRemoteService 需要一个真的
 * Cordis Context（它的构造函数会注册服务），所以测试里 `new Context()`。
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'

import { PACKAGE, METHODS, INVOCATIONS, TYPERT_MANIFEST } from '../contract.js'
import { FlareMoError } from '../lib/errors.js'
import { FlareMoRuntime } from '../lib/runtime.js'
import { ConnectionStore } from '../lib/store.js'
import { aliasFromUrl, instanceIdFor } from '../lib/connection.js'
import * as host from '../index.js'

const NOW = Date.parse('2026-11-08T12:00:00Z')
const clock = () => NOW
const INSTANCE = 'https://flaremo.example.com'

/** 构造一个真的 `Response`。 */
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * 脚本化 fetch：按顺序消费 handler，并记录每次调用的 URL / method / body。
 * @param {Array<(call: object) => Response>} script - one handler per request.
 */
function scriptedFetch(script) {
  const calls = []
  let index = 0
  const fetchImpl = async (url, init = {}) => {
    const target = new URL(String(url))
    const call = {
      url: target,
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    }
    calls.push(call)
    const step = script[index]
    index += 1
    if (step === undefined) throw new Error(`unexpected fetch: ${call.method} ${target.pathname}`)
    return step(call)
  }
  return { fetchImpl, calls }
}

/** 造一个 runtime；store / model 可注入。 */
function createRuntime({ script = [], store, model, llm } = {}) {
  const ctx = new Context()
  const { fetchImpl, calls } = scriptedFetch(script)
  const runtime = new FlareMoRuntime(ctx, { fetchImpl, clock, store, model, llm })
  return { runtime, calls, ctx }
}

/**
 * 预置「已连接」状态（v2 多实例：一条实例记录 + activeId）。
 * @param {{ accessToken?: string, refreshToken?: string, accessExpiresAt?: string }} [options]
 * @returns {object} v2 state payload.
 */
function seededState(options = {}) {
  const id = instanceIdFor(INSTANCE)
  return {
    version: 2,
    activeId: id,
    instances: [
      {
        id,
        alias: aliasFromUrl(INSTANCE),
        instanceUrl: INSTANCE,
        accessToken: options.accessToken ?? 'access-1',
        refreshToken: options.refreshToken ?? 'refresh-1',
        scope: 'notes',
        accessExpiresAt: options.accessExpiresAt ?? new Date(NOW + 7 * 24 * 3600_000).toISOString(),
        account: { id: 'u1', name: 'Kim' },
        connectedAt: new Date(NOW).toISOString(),
        lastSyncAt: new Date(NOW).toISOString(),
      },
    ],
  }
}

/** 取 active 实例记录（v2 状态）。 */
function activeOf(state) {
  return state.instances.find((row) => row.id === state.activeId)
}

/** 预置「已连接」状态。 */
async function seededRuntime({ script = [], model } = {}) {
  const ctx = new Context()
  const store = new ConnectionStore(ctx)
  await store.write(seededState({ accessToken: 'access-1', refreshToken: 'refresh-1' }))
  const { fetchImpl, calls } = scriptedFetch(script)
  const runtime = new FlareMoRuntime(ctx, { fetchImpl, clock, store, model })
  return { runtime, calls, ctx, store }
}

// ── 契约 ────────────────────────────────────────────────────────────

test('contract：METHODS / INVOCATIONS / manifest / runtime 方法四者对得上', () => {
  assert.equal(PACKAGE, 'dsh-flaremo')
  assert.deepEqual(
    INVOCATIONS.map((row) => row.method),
    METHODS,
  )
  for (const row of INVOCATIONS) {
    assert.equal(row.namespace, 'flaremo')
    assert.equal(row.service, 'flaremo')
    assert.equal(row.id, `dsh-flaremo#flaremo/${row.method}`)
    assert.equal(row.parameters.length, 1)
    assert.equal(row.parameters[0].name, 'args')
    assert.equal(row.result.mode, 'strict')
    assert.equal(typeof row.result.schema.parse, 'function')
    assert.equal(typeof row.result.create, 'function')
  }
  const members = TYPERT_MANIFEST.model.services[0].members.map((row) => row.name)
  assert.deepEqual(members, METHODS)
  assert.equal(TYPERT_MANIFEST.model.services[0].key, 'flaremo')
  assert.equal(TYPERT_MANIFEST.model.services[0].exportName, 'FlareMoRuntime')
  for (const method of METHODS) {
    assert.equal(typeof FlareMoRuntime.prototype[method], 'function', `runtime 缺少 ${method}`)
  }
})

test('host 入口导出 name / inject / apply，apply 注册 manifest 与 /flaremo', async () => {
  assert.equal(host.name, 'dsh-flaremo')
  assert.deepEqual([...host.inject], ['typert'])
  assert.equal(typeof host.apply, 'function')

  const ctx = new Context()
  const manifests = []
  const commands = []
  ctx.provide('typert', {
    register(manifest) {
      manifests.push(manifest)
      return () => {}
    },
  })
  ctx.provide('commands', {
    register(definition) {
      commands.push(definition)
      return () => {}
    },
  })
  host.apply(ctx)
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.equal(manifests.length, 1)
  assert.equal(manifests[0].package, PACKAGE)
  assert.equal(commands.length, 1)
  assert.equal(commands[0].name, 'flaremo')
  assert.equal(typeof ctx.get('flaremo'), 'object', '服务应注册为 ctx.flaremo')

  const result = await commands[0].handler({ rawInput: '', attachments: [], signal: new AbortController().signal })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /未连接/, '默认状态应是未连接')
})

// ── 连接状态 ────────────────────────────────────────────────────────

test('connectionStatus：未连接时 connected=false，且不泄漏 token', async () => {
  const { runtime } = createRuntime()
  const result = await runtime.connectionStatus({})
  assert.equal(result.ok, true)
  assert.equal(result.connection.connected, false)
  assert.equal(result.connection.instanceUrl, null)
  assert.equal(result.connection.pending, null)
  assert.doesNotMatch(JSON.stringify(result), /access_token|accessToken|refreshToken/)
})

test('connectStart：实例地址非法 → INVALID_INSTANCE_URL，不发请求', async () => {
  const { runtime, calls } = createRuntime({ script: [] })
  const result = await runtime.connectStart({ instanceUrl: 'ftp://nope' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'INVALID_INSTANCE_URL')
  assert.equal(calls.length, 0)
})

test('connectStart：请求 /connect/device 并保存配对码', async () => {
  const { runtime, calls } = createRuntime({
    script: [
      () =>
        jsonResponse(200, {
          device_code: 'device-1',
          user_code: 'ABCD2345',
          verification_uri: `${INSTANCE}/connect`,
          verification_uri_complete: `${INSTANCE}/connect?code=ABCD2345`,
          expires_in: 300,
          interval: 5,
        }),
    ],
  })
  const result = await runtime.connectStart({ instanceUrl: `${INSTANCE}/` })
  assert.equal(result.ok, true)
  assert.equal(result.connection.connected, false)
  assert.equal(result.connection.pending.userCode, 'ABCD2345')
  assert.equal(result.connection.pending.intervalSeconds, 5)
  assert.equal(result.connection.pending.instanceUrl, INSTANCE, '末尾斜杠应被去掉')
  assert.equal(result.connection.pending.alias, aliasFromUrl(INSTANCE), '应带默认 alias')

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url.pathname, '/connect/device')
  assert.equal(calls[0].method, 'POST')
  assert.deepEqual(calls[0].body, { client_name: 'DeepSeek Harness', client_type: 'device', scopes: ['notes'] })

  const state = await runtime.connection.readState()
  assert.equal(state.pending.deviceCode, 'device-1')
  assert.equal(state.pending.instanceUrl, INSTANCE)
  assert.equal(state.instances.length, 0, '发起配对不该凭空产生实例')
})

test('connectPoll：authorization_pending → status=pending', async () => {
  const { runtime } = createRuntime({
    script: [
      () =>
        jsonResponse(200, {
          device_code: 'device-1',
          user_code: 'ABCD2345',
          verification_uri: `${INSTANCE}/connect`,
          verification_uri_complete: `${INSTANCE}/connect?code=ABCD2345`,
          expires_in: 300,
          interval: 5,
        }),
      () => jsonResponse(400, { error: 'authorization_pending' }),
    ],
  })
  await runtime.connectStart({ instanceUrl: INSTANCE })
  const result = await runtime.connectPoll({})
  assert.equal(result.ok, true)
  assert.equal(result.status, 'pending')
  assert.equal(result.intervalSeconds, 5)
})

test('connectPoll：slow_down 会拉长轮询间隔', async () => {
  const { runtime } = createRuntime({
    script: [
      () =>
        jsonResponse(200, {
          device_code: 'device-1',
          user_code: 'ABCD2345',
          verification_uri: `${INSTANCE}/connect`,
          verification_uri_complete: `${INSTANCE}/connect?code=ABCD2345`,
          expires_in: 300,
          interval: 5,
        }),
      () => jsonResponse(429, { error: 'slow_down' }),
    ],
  })
  await runtime.connectStart({ instanceUrl: INSTANCE })
  const result = await runtime.connectPoll({})
  assert.equal(result.status, 'pending')
  assert.equal(result.intervalSeconds, 10)
})

test('connectPoll：批准后保存 token + 账号，且响应里没有 token', async () => {
  const { runtime, calls } = createRuntime({
    script: [
      () =>
        jsonResponse(200, {
          device_code: 'device-1',
          user_code: 'ABCD2345',
          verification_uri: `${INSTANCE}/connect`,
          verification_uri_complete: `${INSTANCE}/connect?code=ABCD2345`,
          expires_in: 300,
          interval: 5,
        }),
      () =>
        jsonResponse(200, {
          access_token: 'access-9',
          token_type: 'Bearer',
          expires_in: 1209600,
          refresh_token: 'refresh-9',
          scope: 'notes',
        }),
      () => jsonResponse(200, { id: 'u1', name: 'Kim', username: 'kim', email: 'kim@example.com', role: 'owner' }),
    ],
  })
  await runtime.connectStart({ instanceUrl: INSTANCE })
  const result = await runtime.connectPoll({})

  assert.equal(result.ok, true)
  assert.equal(result.status, 'connected')
  assert.equal(result.connection.connected, true)
  assert.equal(result.connection.account.name, 'Kim')
  assert.equal(result.connection.pending, null)
  assert.equal(calls[2].url.pathname, '/api/app/me')
  assert.equal(calls[2].headers.authorization, 'Bearer access-9')

  // 关键安全断言：token 绝不跨 wire
  const wire = JSON.stringify(result)
  assert.doesNotMatch(wire, /access-9|refresh-9/)

  const state = await runtime.connection.readState()
  const active = activeOf(state)
  assert.equal(active.accessToken, 'access-9')
  assert.equal(active.refreshToken, 'refresh-9')
  assert.equal(active.scope, 'notes')
  assert.ok(active.accessExpiresAt, '应记录 access token 过期时间')
  assert.equal(active.instanceUrl, INSTANCE)
  assert.equal(state.activeId, active.id)
})

test('connectCancel：清掉进行中的配对，状态回到未连接', async () => {
  const { runtime } = createRuntime({
    script: [
      () =>
        jsonResponse(200, {
          device_code: 'device-1',
          user_code: 'ABCD2345',
          verification_uri: `${INSTANCE}/connect`,
          verification_uri_complete: `${INSTANCE}/connect?code=ABCD2345`,
          expires_in: 300,
          interval: 5,
        }),
    ],
  })
  await runtime.connectStart({ instanceUrl: INSTANCE })
  const canceled = await runtime.connectCancel({})
  assert.equal(canceled.ok, true)
  assert.equal(canceled.connection.pending, null)

  const poll = await runtime.connectPoll({})
  assert.equal(poll.ok, false)
  assert.equal(poll.code, 'NO_PENDING_CONNECT')
})

test('connectPoll：authorization_pending 之外没有 pending 时给 NO_PENDING_CONNECT', async () => {
  const { runtime } = createRuntime()
  const result = await runtime.connectPoll({})
  assert.equal(result.ok, false)
  assert.equal(result.code, 'NO_PENDING_CONNECT')
})

// ── 数据面 ──────────────────────────────────────────────────────────

test('listNotes：把 MemoDto 折成窄视图（标题/摘要/标签/日期）', async () => {
  const { runtime, calls } = await seededRuntime({
    script: [
      () =>
        jsonResponse(200, {
          memos: [
            {
              id: 'memo-1',
              name: 'memos/memo-1',
              content: '# 有标题的笔记\n\n第一段正文\n第二段正文',
              payload: { tags: ['工作', 'DSH'] },
              create_time: '2026-11-08T10:00:00+08:00',
              update_time: '2026-11-08T11:00:00+08:00',
              pinned: false,
              visibility: 'private',
              state: 'normal',
              source: 'web',
              creator_name: 'Kim',
            },
          ],
          next_page_token: 'page-2',
        }),
    ],
  })
  const result = await runtime.listNotes({ pageSize: 50 })
  assert.equal(result.ok, true)
  assert.equal(result.notes.length, 1)
  const note = result.notes[0]
  assert.equal(note.id, 'memo-1')
  assert.equal(note.title, '有标题的笔记')
  assert.equal(note.excerpt, '第一段正文 第二段正文')
  assert.deepEqual(note.tags, ['工作', 'DSH'])
  assert.equal(note.day, '2026-11-08')
  assert.equal(note.creatorName, 'Kim')
  assert.match(note.content, /第一段正文/)
  assert.equal(result.nextPageToken, 'page-2')

  assert.equal(calls[0].url.pathname, '/api/app/memos')
  assert.equal(calls[0].url.searchParams.get('page_size'), '50')
  assert.equal(calls[0].url.searchParams.get('order_by'), 'created_at desc')
  assert.equal(calls[0].headers.authorization, 'Bearer access-1')
})

test('listNotes：payload.property.title 优先作为标题', async () => {
  const { runtime } = await seededRuntime({
    script: [
      () =>
        jsonResponse(200, {
          memos: [
            {
              id: 'memo-2',
              content: '正文第一行\n正文第二行',
              payload: { property: { title: '显式标题' }, tags: [] },
              create_time: '2026-11-07T10:00:00Z',
              update_time: '2026-11-07T10:00:00Z',
            },
          ],
        }),
    ],
  })
  const result = await runtime.listNotes({})
  assert.equal(result.notes[0].title, '显式标题')
  assert.equal(result.notes[0].excerpt, '正文第一行 正文第二行')
})

test('401：刷新 token 后用新 token 重试一次，并保存轮换后的一对', async () => {
  const { runtime, calls, store } = await seededRuntime({
    script: [
      () => jsonResponse(401, { error: 'unauthorized' }),
      () =>
        jsonResponse(200, {
          access_token: 'access-2',
          token_type: 'Bearer',
          expires_in: 1209600,
          refresh_token: 'refresh-2',
          scope: 'notes',
        }),
      () => jsonResponse(200, { memos: [] }),
    ],
  })
  const result = await runtime.listNotes({})
  assert.equal(result.ok, true)
  assert.deepEqual(result.notes, [])

  assert.equal(calls[0].headers.authorization, 'Bearer access-1')
  assert.equal(calls[1].url.pathname, '/connect/token')
  assert.deepEqual(calls[1].body, { grant_type: 'refresh_token', refresh_token: 'refresh-1' })
  assert.equal(calls[2].headers.authorization, 'Bearer access-2')

  const state = await store.read()
  const active = activeOf(state)
  assert.equal(active.accessToken, 'access-2')
  assert.equal(active.refreshToken, 'refresh-2')
})

test('refresh 返回 invalid_grant → AUTH_EXPIRED 并断开连接', async () => {
  const { runtime, store } = await seededRuntime({
    script: [
      () => jsonResponse(401, { error: 'expired' }),
      () => jsonResponse(400, { error: 'invalid_grant', error_description: 'refresh token is not valid' }),
    ],
  })
  const result = await runtime.listNotes({})
  assert.equal(result.ok, false)
  assert.equal(result.code, 'AUTH_EXPIRED')
  const state = await store.read()
  assert.equal(state.instances.length, 1, '实例记录要留着，方便重新配对')
  assert.equal(activeOf(state).accessToken, undefined, '失效后应清掉 token')

  const status = await runtime.connectionStatus({})
  assert.equal(status.connection.connected, false)
})

test('临近过期时先刷新再请求（不先撞 401）', async () => {
  const ctx = new Context()
  const store = new ConnectionStore(ctx)
  const soon = new Date(NOW + 10_000).toISOString()
  await store.write(seededState({ accessToken: 'stale', refreshToken: 'refresh-1', accessExpiresAt: soon }))
  const { fetchImpl, calls } = scriptedFetch([
    () =>
      jsonResponse(200, {
        access_token: 'fresh',
        token_type: 'Bearer',
        expires_in: 1209600,
        refresh_token: 'refresh-2',
        scope: 'notes',
      }),
    () => jsonResponse(200, { memos: [] }),
  ])
  const runtime = new FlareMoRuntime(ctx, { fetchImpl, clock, store })
  const result = await runtime.listNotes({})
  assert.equal(result.ok, true)
  assert.equal(calls[0].url.pathname, '/connect/token', '第一次调用应直接刷新')
  assert.equal(calls[1].headers.authorization, 'Bearer fresh')
})

test('未连接时数据方法返回 NOT_CONNECTED', async () => {
  const { runtime } = createRuntime()
  for (const method of ['listNotes', 'listTags']) {
    const result = await runtime[method]({})
    assert.equal(result.ok, false)
    assert.equal(result.code, 'NOT_CONNECTED')
  }
})

test('searchNotes：把 query 映射到 q，并拒绝空关键词', async () => {
  const { runtime, calls } = await seededRuntime({
    script: [() => jsonResponse(200, { memos: [] })],
  })
  const empty = await runtime.searchNotes({ query: '   ' })
  assert.equal(empty.ok, false)
  assert.equal(empty.code, 'BAD_ARGS')

  const result = await runtime.searchNotes({ query: '设备授权' })
  assert.equal(result.ok, true)
  assert.equal(calls[0].url.searchParams.get('q'), '设备授权')
})

test('getNote：返回笔记 + 关系/反链引用', async () => {
  const { runtime, calls } = await seededRuntime({
    script: [
      () =>
        jsonResponse(200, {
          memo: {
            id: 'memo-1',
            content: '主笔记正文',
            payload: { tags: ['工作'] },
            create_time: '2026-11-08T10:00:00Z',
            update_time: '2026-11-08T11:00:00Z',
          },
          relations: [{ relation: { type: 'reference' }, memo: { id: 'memo-2', content: '被引用', create_time: '2026-11-07T10:00:00Z' } }],
          backlinks: [{ relation: { type: 'reference' }, memo: { id: 'memo-3', content: '反向链接', create_time: '2026-11-06T10:00:00Z' } }],
          can_manage: true,
          can_govern: false,
          attachments: [],
          shares: [],
          revisions: [],
        }),
    ],
  })
  const result = await runtime.getNote({ id: 'memo-1' })
  assert.equal(result.ok, true)
  assert.equal(result.note.id, 'memo-1')
  assert.equal(result.note.title, '主笔记正文')
  assert.deepEqual(result.relations, [{ id: 'memo-2', title: '被引用', day: '2026-11-07' }])
  assert.deepEqual(result.backlinks, [{ id: 'memo-3', title: '反向链接', day: '2026-11-06' }])
  assert.equal(result.canManage, true)
  assert.equal(calls[0].url.pathname, '/api/app/memos/memo-1')
})

test('listTags：层级树拍平并按 count 排序', async () => {
  const { runtime } = await seededRuntime({
    script: [
      () =>
        jsonResponse(200, {
          tags: [
            {
              name: '工作',
              count: 3,
              children: [{ name: '工作/项目A', count: 2, children: [] }],
            },
            { name: '读书', count: 5, children: [] },
          ],
        }),
    ],
  })
  const result = await runtime.listTags({})
  assert.equal(result.ok, true)
  assert.deepEqual(result.tags, [
    { name: '读书', count: 5 },
    { name: '工作', count: 3 },
    { name: '工作/项目A', count: 2 },
  ])
})

test('disconnect：清掉本地凭据', async () => {
  const { runtime, store } = await seededRuntime({ script: [] })
  const result = await runtime.disconnect({})
  assert.equal(result.ok, true)
  assert.equal(result.connection.connected, false)
  assert.equal(await store.read(), undefined)
})

test('网络错误折成 NETWORK，不泄漏异常类型', async () => {
  const ctx = new Context()
  const store = new ConnectionStore(ctx)
  await store.write(seededState({ accessToken: 'a', refreshToken: 'r' }))
  const runtime = new FlareMoRuntime(ctx, {
    fetchImpl: async () => {
      throw new TypeError('fetch failed')
    },
    clock,
    store,
  })
  const result = await runtime.listNotes({})
  assert.equal(result.ok, false)
  assert.equal(result.code, 'NETWORK')
  assert.match(result.message, /请求 .* 失败/)
})

// ── 洞察执行器（RPC 层）─────────────────────────────────────────────

/** 假模型调用器。 */
function createModel({ reply, error, describe } = {}) {
  const calls = []
  return {
    calls,
    async describe() {
      return describe ?? { available: true, provider: 'deepseek', model: 'deepseek-chat', reason: null }
    },
    async call(request) {
      calls.push(request)
      if (error !== undefined) throw error
      return {
        text: reply ?? JSON.stringify({ summary: '真实摘要', points: ['要点一'] }),
        provider: 'deepseek',
        model: 'deepseek-chat',
      }
    },
  }
}

/** 一条 pending 洞察任务的 GET 响应。 */
function insightBody(overrides = {}) {
  return {
    insight: {
      id: 'insights/task-1',
      kind: 'note',
      status: 'pending',
      input: { memo_ids: ['memo-1'] },
      result: null,
      executor: null,
      error: null,
      created_at: '2026-11-08T00:00:00Z',
      updated_at: '2026-11-08T00:00:00Z',
      ...overrides,
    },
  }
}

/** 一条 memo context 响应。 */
function memoBody() {
  return {
    memo: {
      id: 'memo-1',
      content: '# 设备授权\n\n正文内容',
      payload: { tags: ['工作'] },
      create_time: '2026-11-08T00:00:00Z',
      update_time: '2026-11-08T00:00:00Z',
    },
    relations: [],
    backlinks: [],
    can_manage: true,
    can_govern: true,
  }
}

test('listPendingInsights：拉队列并附带模型可用性', async () => {
  const model = createModel()
  const { runtime, calls } = await seededRuntime({
    model,
    script: [() => jsonResponse(200, { insights: [insightBody().insight, insightBody({ id: 'insights/task-2' }).insight] })],
  })

  const result = await runtime.listPendingInsights({ limit: 5 })
  assert.equal(result.ok, true)
  assert.equal(result.count, 2)
  assert.equal(result.insights.length, 2)
  assert.equal(result.model.available, true)
  assert.equal(calls[0].url.pathname, '/api/app/insights')
  assert.equal(calls[0].url.searchParams.get('status'), 'pending')
  assert.equal(calls[0].url.searchParams.get('limit'), '5')
})

test('runInsight：认领 → 取笔记 → 调模型 → 写回 done', async () => {
  const model = createModel()
  const { runtime, calls } = await seededRuntime({
    model,
    script: [
      () => jsonResponse(200, insightBody()),
      (call) => jsonResponse(200, insightBody({ status: 'running', executor: 'dsh-flaremo' })),
      () => jsonResponse(200, memoBody()),
      () => jsonResponse(200, insightBody({ status: 'done', executor: 'dsh-flaremo', result: { summary: '真实摘要' } })),
    ],
  })

  const result = await runtime.runInsight({ id: 'insights/task-1' })
  assert.equal(result.ok, true)
  assert.equal(result.result.status, 'done')
  assert.equal(result.result.notes, 1)
  assert.equal(result.result.model, 'deepseek/deepseek-chat')

  // 请求序列：GET 任务 → PUT running → GET memo → PUT done
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url.pathname}`),
    [
      'GET /api/app/insights/task-1',
      'PUT /api/app/insights/task-1',
      'GET /api/app/memos/memo-1',
      'PUT /api/app/insights/task-1',
    ],
  )
  assert.equal(calls[1].body.status, 'running')
  assert.equal(calls[1].body.executor, 'dsh-flaremo')
  assert.equal(calls[3].body.status, 'done')
  assert.equal(calls[3].body.executor, 'dsh-flaremo')
  assert.deepEqual(calls[3].body.result, { summary: '真实摘要', points: ['要点一'] })
  assert.equal(calls[0].headers.authorization, 'Bearer access-1')

  // prompt 里带上了笔记正文与「不可信」声明
  assert.match(model.calls[0].prompt, /正文内容/)
  assert.match(model.calls[0].prompt, /不可信数据/)
})

test('runPendingInsights：模型不可用时写回 failed，不吞错误', async () => {
  const model = createModel({ error: new FlareMoError('MODEL_UNAVAILABLE', '没有配置可用的模型') })
  const { runtime, calls } = await seededRuntime({
    model,
    script: [
      () => jsonResponse(200, { insights: [insightBody().insight] }),
      () => jsonResponse(200, insightBody()),
      () => jsonResponse(200, insightBody({ status: 'running' })),
      () => jsonResponse(200, memoBody()),
      () => jsonResponse(200, insightBody({ status: 'failed', executor: 'dsh-flaremo', error: 'MODEL_UNAVAILABLE: 没有配置可用的模型' })),
    ],
  })

  const batch = await runtime.runPendingInsights({ limit: 3 })
  assert.equal(batch.ok, true)
  assert.equal(batch.failed, 1)
  assert.equal(batch.done, 0)
  assert.equal(batch.results[0].status, 'failed')
  assert.equal(batch.results[0].code, 'MODEL_UNAVAILABLE')

  const failedPut = calls.filter((call) => call.method === 'PUT').at(-1)
  assert.equal(failedPut.body.status, 'failed')
  assert.match(failedPut.body.error, /MODEL_UNAVAILABLE/)
  assert.equal(failedPut.body.executor, 'dsh-flaremo')
})

test('runPendingInsights：未连接时返回 NOT_CONNECTED，不写任何东西', async () => {
  const { runtime, calls } = createRuntime({ model: createModel() })
  const result = await runtime.runPendingInsights({ limit: 3 })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'NOT_CONNECTED')
  assert.equal(calls.length, 0)
})

test('/flaremo insight：未连接时给出清晰错误，而不是静默成功', async () => {
  const ctx = new Context()
  const commands = []
  ctx.provide('typert', { register: () => () => {} })
  ctx.provide('commands', { register: (definition) => (commands.push(definition), () => {}) })
  host.apply(ctx)
  await new Promise((resolve) => setTimeout(resolve, 20))

  const result = await commands[0].handler({ rawInput: 'insight', attachments: [], signal: new AbortController().signal })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /还没有连接|NOT_CONNECTED/)
})


// ── 多实例（具名切换）──────────────────────────────────────────────

const SECOND = 'https://second.example.com'

/**
 * 造一个两条实例的状态：A（INSTANCE）+ B（SECOND），active 默认 A。
 * @param {{ activeId?: string }} [options]
 * @returns {object} v2 state payload.
 */
function twoInstanceState(options = {}) {
  const first = seededState().instances[0]
  const secondId = instanceIdFor(SECOND)
  return {
    version: 2,
    activeId: options.activeId ?? first.id,
    instances: [
      first,
      {
        id: secondId,
        alias: aliasFromUrl(SECOND),
        instanceUrl: SECOND,
        accessToken: 'access-b',
        refreshToken: 'refresh-b',
        scope: 'notes',
        accessExpiresAt: new Date(NOW + 7 * 24 * 3600_000).toISOString(),
        account: { id: 'u2', name: 'Second' },
        connectedAt: new Date(NOW).toISOString(),
        lastSyncAt: new Date(NOW).toISOString(),
      },
    ],
  }
}

/** 只返回一条空笔记列表的 fetch handler。 */
function emptyListHandler() {
  return () => jsonResponse(200, { memos: [], next_page_token: undefined })
}

test('listInstances：返回具名列表与 activeId，不含 token', async () => {
  const ctx = new Context()
  const store = new ConnectionStore(ctx)
  await store.write(twoInstanceState())
  const runtime = new FlareMoRuntime(ctx, { fetchImpl: async () => jsonResponse(200, {}), clock, store })
  const result = await runtime.listInstances({})
  assert.equal(result.ok, true)
  assert.equal(result.instances.length, 2)
  assert.equal(result.activeId, instanceIdFor(INSTANCE))
  assert.deepEqual(
    result.instances.map((row) => row.alias),
    [aliasFromUrl(INSTANCE), aliasFromUrl(SECOND)],
  )
  assert.equal(result.instances[1].connected, true)
  assert.equal(result.instances[1].active, false)
  assert.doesNotMatch(JSON.stringify(result), /access-b|refresh-b/)
})

test('switchInstance：切 active 后数据面落到新实例', async () => {
  const ctx = new Context()
  const store = new ConnectionStore(ctx)
  await store.write(twoInstanceState())
  const { fetchImpl, calls } = scriptedFetch([emptyListHandler()])
  const runtime = new FlareMoRuntime(ctx, { fetchImpl, clock, store })

  const switched = await runtime.switchInstance({ id: instanceIdFor(SECOND) })
  assert.equal(switched.ok, true)
  assert.equal(switched.connection.activeId, instanceIdFor(SECOND))
  assert.equal(switched.connection.alias, aliasFromUrl(SECOND))
  assert.equal(switched.connection.connected, true)

  const listed = await runtime.listNotes({})
  assert.equal(listed.ok, true)
  assert.equal(calls[0].url.host, 'second.example.com', '数据请求应落到切换后的实例')
  assert.equal(calls[0].headers.authorization, 'Bearer access-b')
})

test('switchInstance：id 不存在 → INSTANCE_NOT_FOUND', async () => {
  const ctx = new Context()
  const store = new ConnectionStore(ctx)
  await store.write(twoInstanceState())
  const runtime = new FlareMoRuntime(ctx, { fetchImpl: async () => jsonResponse(200, {}), clock, store })
  const result = await runtime.switchInstance({ id: 'inst_nope' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'INSTANCE_NOT_FOUND')
})

test('renameInstance：改名成功 / 重名 → ALIAS_TAKEN / 空名 → INVALID_ALIAS', async () => {
  const ctx = new Context()
  const store = new ConnectionStore(ctx)
  await store.write(twoInstanceState())
  const runtime = new FlareMoRuntime(ctx, { fetchImpl: async () => jsonResponse(200, {}), clock, store })

  const renamed = await runtime.renameInstance({ id: instanceIdFor(SECOND), alias: 'kosx' })
  assert.equal(renamed.ok, true)
  assert.equal(renamed.instances.find((row) => row.id === instanceIdFor(SECOND)).alias, 'kosx')

  const taken = await runtime.renameInstance({ id: instanceIdFor(SECOND), alias: 'kosx'.toUpperCase() })
  assert.equal(taken.ok, true, '同名实例自己改名（大小写不同）不算冲突')

  const conflict = await runtime.renameInstance({ id: instanceIdFor(SECOND), alias: aliasFromUrl(INSTANCE) })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.code, 'ALIAS_TAKEN')

  const empty = await runtime.renameInstance({ id: instanceIdFor(SECOND), alias: '   ' })
  assert.equal(empty.ok, false)
  assert.equal(empty.code, 'INVALID_ALIAS')
})

test('removeInstance：移除非 active 不影响当前；移除 active 自动顶上下一个；最后一条清记录', async () => {
  const ctx = new Context()
  const store = new ConnectionStore(ctx)
  await store.write(twoInstanceState())
  const runtime = new FlareMoRuntime(ctx, { fetchImpl: async () => jsonResponse(200, {}), clock, store })

  const removedSecond = await runtime.removeInstance({ id: instanceIdFor(SECOND) })
  assert.equal(removedSecond.ok, true)
  assert.equal(removedSecond.connection.activeId, instanceIdFor(INSTANCE), 'active 不变')
  assert.equal(removedSecond.connection.instances.length, 1)

  const removedActive = await runtime.removeInstance({ id: instanceIdFor(INSTANCE) })
  assert.equal(removedActive.ok, true)
  assert.equal(removedActive.connection.connected, false)
  assert.equal(removedActive.connection.instances.length, 0)
  assert.equal(await store.read(), undefined, '最后一条移除后记录整体清掉')
})

test('connectStart：只新增 pending，不动其它实例', async () => {
  const ctx = new Context()
  const store = new ConnectionStore(ctx)
  await store.write(twoInstanceState())
  const { fetchImpl } = scriptedFetch([
    () =>
      jsonResponse(200, {
        device_code: 'device-2',
        user_code: 'WXYZ9876',
        verification_uri: `${SECOND}/connect`,
        expires_in: 300,
        interval: 5,
      }),
  ])
  const runtime = new FlareMoRuntime(ctx, { fetchImpl, clock, store })
  const result = await runtime.connectStart({ instanceUrl: 'https://third.example.com', alias: 'local' })
  assert.equal(result.ok, true)
  assert.equal(result.connection.pending.alias, 'local')
  assert.equal(result.connection.instances.length, 2, '原有两条实例不能被清掉')
  assert.equal(result.connection.connected, true, '当前 active 实例仍然可用')
})

test('每实例独立刷新：一个实例 401 不影响另一个实例的 token', async () => {
  const ctx = new Context()
  const store = new ConnectionStore(ctx)
  const state = twoInstanceState()
  state.instances[0].accessToken = 'access-a'
  state.instances[0].refreshToken = 'refresh-a'
  state.instances[0].accessExpiresAt = new Date(NOW + 10_000).toISOString()
  await store.write(state)

  // 只给 A 的刷新脚本；B 不应该发任何请求。
  const { fetchImpl, calls } = scriptedFetch([
    () =>
      jsonResponse(200, {
        access_token: 'access-a2',
        refresh_token: 'refresh-a2',
        expires_in: 1209600,
        scope: 'notes',
      }),
    () => jsonResponse(200, { memos: [] }),
  ])
  const runtime = new FlareMoRuntime(ctx, { fetchImpl, clock, store })
  const result = await runtime.listNotes({})
  assert.equal(result.ok, true)
  assert.equal(calls[0].url.pathname, '/connect/token')
  assert.equal(calls[1].headers.authorization, 'Bearer access-a2')

  const after = await store.read()
  assert.equal(activeOf(after).accessToken, 'access-a2')
  const second = after.instances.find((row) => row.id === instanceIdFor(SECOND))
  assert.equal(second.accessToken, 'access-b', '另一个实例的 token 不能被顺手改掉')
  assert.equal(second.refreshToken, 'refresh-b')
})

test('v1 单实例状态：自动迁移成一条具名实例', async () => {
  const ctx = new Context()
  const store = new ConnectionStore(ctx)
  // 绕过 store.write（它总是写 v2），模拟磁盘上还留着旧版本记录。
  store.memory = {
    version: 1,
    instanceUrl: INSTANCE,
    accessToken: 'legacy',
    refreshToken: 'legacy-refresh',
    accessExpiresAt: new Date(NOW + 7 * 24 * 3600_000).toISOString(),
    account: { id: 'u1', name: 'Kim' },
    connectedAt: new Date(NOW).toISOString(),
  }
  const runtime = new FlareMoRuntime(ctx, { fetchImpl: async () => jsonResponse(200, { memos: [] }), clock, store })
  const status = await runtime.connectionStatus({})
  assert.equal(status.connection.connected, true)
  assert.equal(status.connection.instanceUrl, INSTANCE)
  assert.equal(status.connection.alias, aliasFromUrl(INSTANCE))
  assert.equal(status.connection.instances.length, 1)

  const state = await runtime.connection.readState()
  assert.equal(state.version, 2)
  assert.equal(activeOf(state).accessToken, 'legacy')
})
