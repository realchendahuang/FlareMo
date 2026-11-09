/**
 * dsh-flaremo — 两侧共用的 wire 契约。
 *
 * Host 半片用 `ctx.typert.register(TYPERT_MANIFEST)` 注册服务；Client 半片用
 * `ctx.remote.$mount({ package: PACKAGE, descriptors: INVOCATIONS })` 挂载同一份
 * 描述符。方法名两侧完全一致（服务方法就是 wire 方法），没有映射表可以漂移。
 *
 * 结构照抄 ~/code/dsh-provider-studio/contract.js：
 *  - 每个方法只有一条 `args` 参数（source: json），返回 envelope；
 *  - envelope：`{ ok:true, ...payload }` 或 `{ ok:false, code, message, params?, detail? }`；
 *  - codec 同时给出 `schema` 与 `create`，兼容 DSH 0.1.x（校验 schema.parse）与
 *    0.2.x（校验 codec.create）。
 */

export const PACKAGE = 'dsh-flaremo'
export const SERVICE_KEY = 'flaremo'

/** Host 服务类名（TYPERT_MANIFEST.model.services[0].exportName）。 */
export const SERVICE_EXPORT_NAME = 'FlareMoRuntime'

/**
 * 服务方法 = wire 方法。顺序也是文档顺序。
 *
 * connectionStatus  连接状态（不含 token；含实例列表与 activeId）
 * listInstances     具名实例列表（alias / 实例地址 / 账号 / 最后同步 / 是否 active）
 * switchInstance    切换 active 实例（时间线/搜索/详情/洞察全部跟随）
 * renameInstance    改实例 alias（显示名，唯一）
 * removeInstance    移除一个实例（清掉它的 token 与本地状态）
 * connectStart      校验实例 URL 并发起设备授权，返回配对码（可带 alias）
 * connectPoll       轮询一次：pending / connected / expired / denied
 * connectCancel     取消进行中的配对（清掉 host 里的 pending）
 * disconnect        移除当前 active 实例（不要求服务端吊销也成功）
 * listNotes         按时间/标签列出笔记（分页）
 * searchNotes       用 FlareMo 服务端搜索（q 语法，见 /api/app/memos）
 * getNote           单条笔记 + 关系/反链（会话右栏与详情会用到）
 * listTags          标签层级拍平后的列表（带 count）
 * listPendingInsights 拉 FlareMo 上 pending 的洞察任务（带模型可用性）
 * runInsight        跑一条洞察任务（拉取 → DSH 模型 → 写回 done/failed）
 * runPendingInsights 批量跑 pending 队列（默认 3 条，最多 10 条）
 */
export const METHODS = [
  'connectionStatus',
  'listInstances',
  'switchInstance',
  'renameInstance',
  'removeInstance',
  'connectStart',
  'connectPoll',
  'connectCancel',
  'disconnect',
  'listNotes',
  'searchNotes',
  'getNote',
  'listTags',
  'listPendingInsights',
  'runInsight',
  'runPendingInsights',
]

const parser = (parse) => ({ parse })
const strictCodec = (typeSymbol, parse) => ({
  mode: 'strict',
  typeSymbol,
  schema: parser(parse),
  create: () => parser(parse),
})

const argsParser = (value) => {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('expected an args object')
  return value
}

/** 与 provider-studio 相同的 envelope 校验：成功自由，失败必须带机器可读 code。 */
const envelopeParser = (value) => {
  if (value === null || typeof value !== 'object' || typeof value.ok !== 'boolean') {
    throw new TypeError('expected an { ok, ... } envelope')
  }
  if (value.ok === false && typeof value.code !== 'string') {
    throw new TypeError('expected a string `code` on a failed envelope')
  }
  return value
}

const argParam = {
  name: 'args',
  wire: 'args',
  source: 'json',
  codec: strictCodec(`${PACKAGE}#Args`, argsParser),
}

export const INVOCATIONS = METHODS.map((method) => ({
  id: `${PACKAGE}#${SERVICE_KEY}/${method}`,
  service: SERVICE_KEY,
  namespace: SERVICE_KEY,
  method,
  invocation: { kind: 'direct' },
  parameters: [argParam],
  result: strictCodec(`${PACKAGE}#${method}Result`, envelopeParser),
}))

export const TYPERT_MANIFEST = {
  package: PACKAGE,
  face: 'host',
  schemas: [],
  model: {
    services: [
      {
        key: SERVICE_KEY,
        exportName: SERVICE_EXPORT_NAME,
        description: 'FlareMo notes workbench — connection, memos, tags (device-authorized).',
        tags: [],
        members: METHODS.map((method) => ({
          kind: 'method',
          name: method,
          signature: `${method}(args: object): Promise<object>`,
        })),
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
  invocations: INVOCATIONS,
}
