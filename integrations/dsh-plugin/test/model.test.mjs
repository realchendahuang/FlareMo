/**
 * DSH 模型调用器测试：模型选择（默认模型 / 第一个 provider）、stream 文本累加、
 * finish 错误、模型缺席与输出为空。
 *
 * 用的是假 llm（形状对齐 dsh-llm 的 LlmRuntime：listProviders / listModels /
 * prepareCall → { config, stream }），不碰真实 provider。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createModelCaller, resolveModelSelection } from '../lib/model.js'

/** 造一个假 llm：记录 prepareCall / stream 的参数。 */
function createLlm({ chunks = [], prepareError = null, providers = [{ id: 'deepseek', name: 'DeepSeek' }], models = { deepseek: [{ id: 'deepseek-chat' }] } } = {}) {
  const calls = { prepared: [], streams: [] }
  return {
    calls,
    listProviders: () => providers,
    listModels: async (providerId) => models[providerId] ?? [],
    async prepareCall(config) {
      calls.prepared.push(config)
      if (prepareError !== null) throw prepareError
      return {
        config: { ...config, materialized: true },
        stream: (options) => {
          calls.streams.push(options)
          return (async function* () {
            for (const chunk of chunks) yield chunk
          })()
        },
      }
    },
  }
}

/** 假 ctx：get(name) 返回注入的服务。 */
function createCtx({ llm, selection } = {}) {
  return {
    get(name) {
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel' && selection !== undefined) {
        return { currentSelection: () => selection }
      }
      return undefined
    },
  }
}

test('resolveModelSelection：优先 DSH 默认模型', async () => {
  const llm = createLlm()
  const ctx = createCtx({ llm, selection: { provider: 'deepseek', model: 'deepseek-chat' } })
  assert.deepEqual(await resolveModelSelection(ctx, llm), { provider: 'deepseek', model: 'deepseek-chat' })
})

test('resolveModelSelection：没有默认模型时退到第一个 provider 的第一个模型', async () => {
  const llm = createLlm({ providers: [{ id: 'pi-ai', name: 'Pi' }], models: { 'pi-ai': [{ id: 'gpt-x' }] } })
  const ctx = createCtx({ llm })
  assert.deepEqual(await resolveModelSelection(ctx, llm), { provider: 'pi-ai', model: 'gpt-x' })
})

test('resolveModelSelection：没有 provider 时返回 undefined', async () => {
  const llm = createLlm({ providers: [] })
  assert.equal(await resolveModelSelection(createCtx({ llm }), llm), undefined)
})

test('call：prepareCall 用选中的模型，stream 累加 text-delta 并返回完整文本', async () => {
  const llm = createLlm({
    chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '{"summary":' },
      { type: 'text-delta', index: 0, text: '"好"}' },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  })
  const caller = createModelCaller(createCtx({ llm, selection: { provider: 'deepseek', model: 'deepseek-chat' } }))
  const result = await caller.call({ system: '系统提示', prompt: '用户提示', maxTokens: 900 })

  assert.equal(result.text, '{"summary":"好"}')
  assert.equal(result.provider, 'deepseek')
  assert.equal(result.model, 'deepseek-chat')
  assert.deepEqual(llm.calls.prepared[0], { provider: 'deepseek', model: 'deepseek-chat', maxTokens: 900 })

  const streamOptions = llm.calls.streams[0]
  assert.equal(streamOptions.system, '系统提示')
  assert.deepEqual(streamOptions.messages, [{ role: 'user', content: [{ type: 'text', text: '用户提示' }] }])
  assert.equal(streamOptions.maxTokens, 900, 'stream 应带上 prepareCall 的 config（含 maxTokens）')
  assert.equal(streamOptions.materialized, true)
})

test('call：没有 llm 服务 → MODEL_UNAVAILABLE', async () => {
  const caller = createModelCaller(createCtx({}))
  await assert.rejects(
    () => caller.call({ system: 's', prompt: 'p' }),
    (error) => error.code === 'MODEL_UNAVAILABLE',
  )
})

test('call：没有可用模型 → MODEL_UNAVAILABLE（不静默跳过）', async () => {
  const llm = createLlm({ providers: [] })
  const caller = createModelCaller(createCtx({ llm }))
  await assert.rejects(
    () => caller.call({ system: 's', prompt: 'p' }),
    (error) => error.code === 'MODEL_UNAVAILABLE' && /没有配置可用的模型/.test(error.message),
  )
})

test('call：prepareCall 抛错（模型不可用/没密钥）→ MODEL_UNAVAILABLE', async () => {
  const llm = createLlm({ prepareError: new Error('missing api key') })
  const caller = createModelCaller(createCtx({ llm, selection: { provider: 'deepseek', model: 'deepseek-chat' } }))
  await assert.rejects(
    () => caller.call({ system: 's', prompt: 'p' }),
    (error) => error.code === 'MODEL_UNAVAILABLE' && /missing api key/.test(error.message),
  )
})

test('call：finish reason=error → MODEL_FAILED', async () => {
  const llm = createLlm({
    chunks: [{ type: 'finish', reason: { kind: 'error', failure: { message: 'provider exploded', code: 'E' } } }],
  })
  const caller = createModelCaller(createCtx({ llm, selection: { provider: 'deepseek', model: 'deepseek-chat' } }))
  await assert.rejects(
    () => caller.call({ system: 's', prompt: 'p' }),
    (error) => error.code === 'MODEL_FAILED' && /provider exploded/.test(error.message),
  )
})

test('call：模型只回了空白 → MODEL_BAD_OUTPUT', async () => {
  const llm = createLlm({
    chunks: [
      { type: 'text-delta', index: 0, text: '  ' },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  })
  const caller = createModelCaller(createCtx({ llm, selection: { provider: 'deepseek', model: 'deepseek-chat' } }))
  await assert.rejects(
    () => caller.call({ system: 's', prompt: 'p' }),
    (error) => error.code === 'MODEL_BAD_OUTPUT',
  )
})

test('describe：报告模型是否可用', async () => {
  const llm = createLlm()
  const available = createModelCaller(createCtx({ llm, selection: { provider: 'deepseek', model: 'deepseek-chat' } }))
  assert.deepEqual(await available.describe(), {
    available: true,
    provider: 'deepseek',
    model: 'deepseek-chat',
    reason: null,
  })

  const missing = createModelCaller(createCtx({}))
  const status = await missing.describe()
  assert.equal(status.available, false)
  assert.equal(status.reason, 'NO_LLM_SERVICE')
})
