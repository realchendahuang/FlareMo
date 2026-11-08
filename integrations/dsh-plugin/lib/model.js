/**
 * DSH 模型调用（Host 侧）。
 *
 * 真实 API 形状来自同机已跑通的 dsh-web-access（`dist/llm-bridge.js`）与
 * dsh-media-desk（`src/ai.js`）：
 *
 *   const llm = ctx.get('llm')                       // LlmRuntime
 *   llm.listProviders() → [{ id, name }]             // 同步
 *   await llm.listModels(providerId) → [{ id, context, … }]
 *   const call = await llm.prepareCall({ provider, model, maxTokens }, signal)
 *   for await (const chunk of call.stream({ ...call.config, system, messages, signal })) { … }
 *
 * chunk 是 dsh-llm 的 StreamChunk：`text-delta` 累加文本，`finish` 带
 * FinishReason（`error` / `aborted` 里带 failure.message）。
 *
 * 模型选择优先 `ctx.get('agentDefaultModel').currentSelection()`（DSH 里
 * 「设置 → 模型」的默认模型），拿不到就退到第一个 provider 的第一个 model。
 * 两者都没有就抛 MODEL_UNAVAILABLE —— 绝不静默跳过，执行器会把它写回 failed。
 */

import { CODES, FlareMoError } from './errors.js'
import { asText, errorMessage } from './util.js'

/** 安全地读一个可选服务。 */
function safeGet(ctx, name) {
  try {
    const value = typeof ctx?.get === 'function' ? ctx.get(name) : undefined
    return value !== null && typeof value === 'object' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * 解析这次调用用哪个模型。
 * @param {object} ctx - host plugin context.
 * @param {object} llm - the llm runtime.
 * @param {{ provider?: string, model?: string }} [override] - test / config override.
 * @returns {Promise<{ provider: string, model: string } | undefined>}
 */
export async function resolveModelSelection(ctx, llm, override) {
  if (asText(override?.provider) !== '' && asText(override?.model) !== '') {
    return { provider: asText(override.provider), model: asText(override.model) }
  }

  // 1) DSH 的默认模型（设置 → 模型）
  const defaults = safeGet(ctx, 'agentDefaultModel')
  if (defaults !== undefined && typeof defaults.currentSelection === 'function') {
    try {
      const selection = defaults.currentSelection()
      if (asText(selection?.provider) !== '' && asText(selection?.model) !== '') {
        return { provider: asText(selection.provider), model: asText(selection.model) }
      }
    } catch {
      /* 默认模型读不到就继续往下退 */
    }
  }

  // 2) 退到第一个有模型的 provider
  if (llm === undefined || typeof llm.listProviders !== 'function') return undefined
  let providers = []
  try {
    providers = llm.listProviders()
  } catch {
    return undefined
  }
  for (const provider of Array.isArray(providers) ? providers : []) {
    const providerId = asText(provider?.id)
    if (providerId === '' || typeof llm.listModels !== 'function') continue
    try {
      const models = await llm.listModels(providerId)
      const first = Array.isArray(models) ? models[0] : undefined
      if (first !== undefined && asText(first.id) !== '') {
        return { provider: providerId, model: asText(first.id) }
      }
    } catch {
      /* 单个 provider 列模型失败不影响下一个 */
    }
  }
  return undefined
}

/**
 * 造一个模型调用器。`options.llm` / `options.selection` 是测试注入口。
 * @param {object} ctx - host plugin context.
 * @param {{ llm?: object, selection?: { provider: string, model: string }, maxTokens?: number }} [options]
 */
export function createModelCaller(ctx, options = {}) {
  const injectedLlm = options.llm

  /** 当前能不能用模型（设置页展示用，不抛错）。 */
  async function describe() {
    const llm = injectedLlm ?? safeGet(ctx, 'llm')
    if (llm === undefined) return { available: false, provider: null, model: null, reason: 'NO_LLM_SERVICE' }
    const selection = await resolveModelSelection(ctx, llm, options.selection)
    if (selection === undefined) return { available: false, provider: null, model: null, reason: 'NO_MODEL_CONFIGURED' }
    return { available: true, provider: selection.provider, model: selection.model, reason: null }
  }

  /**
   * 调一次模型并返回完整文本。
   * @param {{ system: string, prompt: string, maxTokens?: number, signal?: AbortSignal }} request
   * @returns {Promise<{ text: string, provider: string, model: string }>}
   */
  async function call(request) {
    const llm = injectedLlm ?? safeGet(ctx, 'llm')
    if (llm === undefined || typeof llm.prepareCall !== 'function') {
      throw new FlareMoError(CODES.MODEL_UNAVAILABLE, '当前宿主没有可用的 llm 服务（无法调用模型）')
    }
    const selection = await resolveModelSelection(ctx, llm, options.selection)
    if (selection === undefined) {
      throw new FlareMoError(CODES.MODEL_UNAVAILABLE, '没有配置可用的模型，请先在 DSH 里选择默认模型')
    }

    const maxTokens = Number.isFinite(request?.maxTokens) ? request.maxTokens : options.maxTokens
    const signal = request?.signal

    let prepared
    try {
      prepared = await llm.prepareCall(
        {
          provider: selection.provider,
          model: selection.model,
          ...(Number.isFinite(maxTokens) ? { maxTokens } : {}),
        },
        signal,
      )
    } catch (error) {
      throw new FlareMoError(
        CODES.MODEL_UNAVAILABLE,
        `模型 ${selection.provider}/${selection.model} 不可用：${errorMessage(error)}`,
        { detail: errorMessage(error) },
      )
    }

    let text = ''
    let finishReason
    try {
      for await (const chunk of prepared.stream({
        ...prepared.config,
        system: asText(request?.system),
        messages: [{ role: 'user', content: [{ type: 'text', text: asText(request?.prompt) }] }],
        ...(signal === undefined ? {} : { signal }),
      })) {
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
          text += chunk.text
          continue
        }
        if (chunk?.type === 'finish') {
          finishReason = chunk.reason
          if (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted') {
            const message = asText(chunk.reason?.failure?.message) || '模型调用失败'
            throw new FlareMoError(CODES.MODEL_FAILED, `模型调用失败：${message}`, {
              detail: message,
            })
          }
        }
      }
    } catch (error) {
      if (error instanceof FlareMoError) throw error
      if (signal?.aborted || error?.name === 'AbortError') {
        throw new FlareMoError(CODES.MODEL_FAILED, '模型调用已取消')
      }
      throw new FlareMoError(CODES.MODEL_FAILED, `模型调用失败：${errorMessage(error)}`, {
        detail: errorMessage(error),
      })
    }

    if (text.trim() === '') {
      throw new FlareMoError(
        CODES.MODEL_BAD_OUTPUT,
        finishReason?.kind === 'max-tokens' ? '模型输出达到 maxTokens 上限且没有文本' : '模型没有输出文本',
      )
    }
    return { text, provider: selection.provider, model: selection.model }
  }

  return { describe, call }
}
