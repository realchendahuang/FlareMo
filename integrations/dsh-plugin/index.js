/**
 * dsh-flaremo — Host 半片入口（连接配置 + typert RPC + 真数据）。
 *
 * 这个文件只做装配：
 *   - `FlareMoRuntime`（Typert Remote 服务 `ctx.flaremo`）：连接状态机 + 数据接口；
 *   - `ctx.typert.register(TYPERT_MANIFEST)`：把 wire 描述符交给 Gateway，
 *     Client 半片用配套的 `ctx.remote.$mount()` 挂同一份 contract.js；
 *   - `/flaremo` 人类命令：报告连接状态 / 处理洞察队列（command 永远不会被送进模型）。
 *
 * 数据面全部在 host：client 只拿窄视图（标题/摘要/标签/时间/正文），
 * access_token / refresh_token 只存在 DSH 凭据服务的记录里，client 永远看不到。
 *
 * 数据面范围：列 / 搜 / 详情 / 标签 / 统计只读，外加新建便签（`createNote`）。
 * 改笔记、归档、回收站操作仍然只读；会话右栏与「选中注入 AI」也未做
 * （README「没验证 / 已知风险」与「下一步」有完整清单）。
 */

import { TYPERT_MANIFEST } from './contract.js'
import { FlareMoRuntime } from './lib/runtime.js'

/** `/flaremo insight` 的批量上限：每条都要一次模型调用，默认 3 条。 */
const INSIGHT_BATCH_LIMIT = 3

/** 单条执行结果 → 一行命令输出。 */
function formatRun(result) {
  if (result?.status === 'done') {
    return `✓ ${result.kind} ${result.id} → done（${result.notes ?? 0} 条笔记，模型 ${result.model ?? '未知'}）`
  }
  if (result?.status === 'skipped') {
    return `· ${result.id} 已经是 ${result.reason}，跳过`
  }
  return `✗ ${result.kind ?? '?'} ${result?.id ?? '?'} → failed：${result?.error ?? '未知错误'}`
}

/** 批量结果 → 多行命令输出。 */
function formatBatch(batch) {
  const lines = [
    `洞察队列：${batch.pendingBefore} 个 pending，本次处理 ${batch.results.length} 个` +
      `（done ${batch.done} / failed ${batch.failed} / skipped ${batch.skipped}）`,
  ]
  for (const result of batch.results) lines.push(formatRun(result))
  if (batch.model?.available === false) {
    lines.push(`模型不可用：${batch.model.reason ?? '未配置'}（先在 DSH 里选择默认模型）`)
  }
  return lines.join('\n')
}

/**
 * `/flaremo` 命令体。
 * @param {FlareMoRuntime} runtime - the host runtime.
 * @param {string} raw - text after the command name.
 */
async function runCommand(runtime, raw) {
  const argument = String(raw ?? '').trim()

  if (argument === 'insight' || argument.startsWith('insight ')) {
    const target = argument.slice('insight'.length).trim()
    try {
      if (target !== '') {
        const result = await runtime.executor.runOne(target)
        return {
          kind: result.status === 'failed' ? 'error' : 'success',
          text: formatRun(result),
        }
      }
      const batch = await runtime.executor.runPending({ limit: INSIGHT_BATCH_LIMIT })
      return {
        kind: batch.failed > 0 ? 'error' : 'success',
        text: formatBatch(batch),
      }
    } catch (error) {
      return {
        kind: 'error',
        text: `洞察执行失败：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  const status = await runtime.connection.status()
  if (status.connected) {
    const who = status.account?.name ?? status.account?.username ?? '已授权账号'
    const label = status.alias === null ? status.instanceUrl : `${status.alias}（${status.instanceUrl}）`
    const others = status.instances.length > 1
      ? `；另有 ${status.instances.length - 1} 个实例，可在工作台顶栏切换`
      : ''
    return {
      kind: 'success',
      text: `FlareMo 已连接：${label}（${who}）${others}。工作台在左栏「笔记」；\`/flaremo insight\` 在 active 实例上处理洞察任务。`,
    }
  }
  return {
    kind: 'success',
    text: 'FlareMo 还未连接。打开 设置 → FlareMo 连接，填实例地址并完成配对码授权。',
  }
}

/** Loader 诊断名；与 cordis.patch.yml 的 `id: dsh-flaremo` 对应。 */
export const name = 'dsh-flaremo'

/**
 * 静态依赖：`typert` 是硬依赖（没有它 RPC 就无从谈起，插件应保持休眠）。
 * 凭据服务刻意不列进来：拿不到时退化为进程内存，插件照常加载。
 */
export const inject = ['typert']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 */
export function apply(ctx) {
  // 构造即把服务注册到 ctx.flaremo（与 SERVICE_KEY 一致），并参与 Gateway 导出。
  const runtime = new FlareMoRuntime(ctx)

  ctx.effect(() => ctx.typert.register(TYPERT_MANIFEST), 'dsh-flaremo: typert manifest')

  // `/flaremo`：汇报状态 / 跑洞察；命令输出不进模型历史、不消耗 token。
  ctx.inject(['commands'], (ctx) => {
    ctx.effect(
      () =>
        ctx.commands.register({
          name: 'flaremo',
          description: 'FlareMo：查看连接状态 / 执行洞察队列（/flaremo insight [任务id]）',
          input: { hint: '[status|insight [id]]', attachments: false },
          async handler(invocation) {
            try {
              return await runCommand(runtime, invocation?.rawInput ?? '')
            } catch (error) {
              return {
                kind: 'error',
                text: `FlareMo 命令失败：${error instanceof Error ? error.message : String(error)}`,
              }
            }
          },
        }),
      'dsh-flaremo: /flaremo command',
    )
  })
}
