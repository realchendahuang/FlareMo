/**
 * 客户端词典。DSH 的 locale 服务要求注册的每个 namespace 至少 zh / en 齐全；
 * 缺一个语言会露 key，所以两边永远同步增删。
 *
 * `err.<CODE>` 前缀是 RPC 失败码的文案表（host 的 lib/errors.js 与 client 的
 * api.js 用同一套机器码）；查不到时 UI 退回 host 返回的 message。
 *
 * `fallbackT` 是 locale 服务缺席时的兜底（例如没有 locale 插件的宿主），
 * 保证骨架版仍能显示中文而不是裸 key。
 */

/** 词典 namespace，同时也是 slot 注册里的 `locale` 字段。 */
export const NS = 'flaremo'

export const ZH = {
  // 面板 / 左栏
  panel: '笔记',

  'visibility.private': '仅自己',
  'visibility.protected': '团队',
  'visibility.public': '公开',

  // 未连接时的连接引导（不显示任何示例数据）
  guideTitle: '连接 FlareMo 实例',
  guideBody: '连接后这里显示你的笔记、标签和洞察队列。现在还没有连接任何实例。',
  guideRetry: '重新检查连接',
  guideInlineHint: '配对码在 FlareMo 网页批准一次即可；token 只存在本机 DSH 凭据里。',

  // 连接状态
  loadingNotes: '正在读取笔记…',
  loadFailed: '读取失败',
  embedUnavailable: '无法启动内嵌页面',
  embedUnavailableHint: '本机没有可用端口，或宿主不允许本地监听。关掉占用端口的程序后重试。',

  // 设置页
  settingsNav: 'FlareMo 连接',
  settingsTitle: 'FlareMo 连接',
  settingsIntro: '把笔记工作台连到一个 FlareMo 实例。授权用设备配对码，token 只存在 DSH 凭据服务里，不会进模型上下文。',
  instanceLabel: '实例地址',
  instancePlaceholder: 'https://notes.example.com',
  connectStart: '生成配对码',
  connectWorking: '请求配对码…',
  pairTitle: '在 FlareMo 里输入配对码',
  pairHint: '打开下面的地址，在「连接应用」页输入这串码：',
  pairOpen: '打开配对页',
  pairExpires: '{seconds} 秒后过期',
  pairExpired: '配对码已过期，请重新生成',
  pairDenied: '授权被拒绝，请重新生成配对码',
  pairPoll: '我已批准',
  pairCancel: '取消配对',
  pairWaiting: '等待批准…',
  statusLoading: '正在读取连接状态…',
  connectedTitle: '已连接',
  connectedAs: '已连接为 {name}',
  lastSyncLabel: '最后同步',
  connectedAtLabel: '连接于',
  neverSynced: '还没有同步过',
  scopeLabel: '授权范围',
  disconnect: '断开连接',
  disconnectHint: '断开只会删除本机保存的令牌；服务端的设备授权在 FlareMo「已连接应用」里吊销。',
  notConnectedTitle: '未连接',
  notConnectedHint: '完成配对后，工作台会显示这个实例的真实笔记。',
  serviceUnavailable: 'FlareMo 服务还没挂载（插件可能刚启动或被禁用）。',
  serviceUnavailableHint: '重启 DSH 或到「设置 → 插件」里看插件是否加载成功。',

  // 多实例（具名切换）
  instances: '实例',
  instancesEmpty: '还没有添加实例',
  instanceActive: '当前',
  switchInstance: '切换',
  addInstance: '添加实例',
  backToWorkbench: '返回工作台',
  renameInstance: '改名',
  removeInstance: '移除',
  removeInstanceConfirm: '确认移除这个实例？本机保存的令牌会被删除。',
  instanceAlias: '实例名',
  instanceAliasHint: '1–40 个字符，用来区分不同实例；显示名随时可改。',
  cancel: '取消',
  save: '保存',
  aliasInvalid: '实例名需要 1–40 个字符',
  aliasTaken: '这个实例名已被占用',
  instanceNotConnected: '未连接',

  // RPC 失败码
  'err.REMOTE_UNAVAILABLE': 'FlareMo 服务还没挂载',
  'err.NOT_CONNECTED': '还没有连接 FlareMo 实例',
  'err.NO_PENDING_CONNECT': '没有进行中的配对',
  'err.INVALID_INSTANCE_URL': '实例地址不是合法的 http(s) URL',
  'err.CONNECT_EXPIRED': '配对码已过期，请重新生成',
  'err.CONNECT_DENIED': '授权被拒绝',
  'err.AUTH_EXPIRED': '授权已失效，请重新配对',
  'err.NETWORK': '网络请求失败',
  'err.TIMEOUT': '请求超时',
  'err.HTTP_ERROR': 'FlareMo 返回了错误',
  'err.BAD_RESPONSE': 'FlareMo 返回了无法识别的响应',
  'err.BAD_ARGS': '参数不完整',
  'err.GATEWAY_ERROR': 'DSH 网关调用失败',
  'err.INTERNAL': '内部错误',
  'err.SERVICE_UNMOUNTED': 'FlareMo 服务还没挂载',
  'err.INSTANCE_NOT_FOUND': '实例不存在，可能已被移除',
  'err.ALIAS_TAKEN': '这个实例名已被占用',
  'err.INVALID_ALIAS': '实例名需要 1–40 个字符',
  'err.MODEL_UNAVAILABLE': 'DSH 里没有可用模型，先去「设置 → 模型」选一个默认模型',
  'err.MODEL_FAILED': '模型调用失败',
  'err.MODEL_BAD_OUTPUT': '模型输出不是可解析的 JSON，无法写回',
  'err.INSIGHT_NO_NOTES': '这条洞察任务没有可用的笔记（可能已被删除）',
  'err.INSIGHT_TERMINAL': '任务已经是终态，跳过',


  // 洞察执行器
  executorTitle: '洞察执行器',
  executorIntro: 'FlareMo 只存任务、不跑模型：这里拉取 pending 任务，用 DSH 的默认模型生成结果并写回。',
  executorPending: '{count} 个待处理任务',
  executorNone: '没有待处理的洞察任务',
  executorRun: '处理洞察任务',
  executorRunning: '正在处理…',
  executorLimitHint: '一次最多处理 3 个任务，每条会调用一次模型。',
  executorSummary: 'done {done} · failed {failed} · skipped {skipped}',
  executorModel: '模型',
  executorModelNone: '模型不可用：{reason}',
  executorTaskFailed: '任务 {id} 失败：{error}',
  executorTaskDone: '任务 {id} 完成',
}

export const EN = {
  panel: 'Notes',

  'visibility.private': 'Only me',
  'visibility.protected': 'Team',
  'visibility.public': 'Public',

  guideTitle: 'Connect a FlareMo instance',
  guideBody: 'Once connected, this panel shows your notes, tags and insight queue. No instance is connected right now.',
  guideRetry: 'Recheck connection',
  guideInlineHint: 'Approve the code once in the FlareMo web app; the token stays in this machine’s DSH credentials.',

  loadingNotes: 'Loading notes…',
  loadFailed: 'Load failed',
  embedUnavailable: 'Could not start the embedded page',
  embedUnavailableHint: 'No local port is free, or this host forbids local listeners. Free a port and retry.',

  settingsNav: 'FlareMo connection',
  settingsTitle: 'FlareMo connection',
  settingsIntro: 'Connect the notes workbench to a FlareMo instance. Authorization uses a device pairing code; tokens stay in the DSH credential store and never reach the model context.',
  instanceLabel: 'Instance URL',
  instancePlaceholder: 'https://notes.example.com',
  connectStart: 'Generate pairing code',
  connectWorking: 'Requesting a pairing code…',
  pairTitle: 'Enter the pairing code in FlareMo',
  pairHint: 'Open the address below and enter this code on the connected-apps page:',
  pairOpen: 'Open pairing page',
  pairExpires: 'expires in {seconds}s',
  pairExpired: 'The pairing code expired — generate a new one',
  pairDenied: 'Authorization was denied — generate a new code',
  pairPoll: 'I approved it',
  pairCancel: 'Cancel pairing',
  pairWaiting: 'Waiting for approval…',
  statusLoading: 'Reading connection status…',
  connectedTitle: 'Connected',
  connectedAs: 'Connected as {name}',
  lastSyncLabel: 'Last sync',
  connectedAtLabel: 'Connected',
  neverSynced: 'Not synced yet',
  scopeLabel: 'Scope',
  disconnect: 'Disconnect',
  disconnectHint: 'Disconnecting only deletes the local tokens; revoke the device grant in FlareMo’s connected-apps page.',
  notConnectedTitle: 'Not connected',
  notConnectedHint: 'Once paired, the workbench shows the real notes of this instance.',
  serviceUnavailable: 'The FlareMo service is not mounted yet (the plugin may still be starting).',
  serviceUnavailableHint: 'Restart DSH, or check Settings → Plugins for load errors.',

  instances: 'Instances',
  instancesEmpty: 'No instances added yet',
  instanceActive: 'Current',
  switchInstance: 'Switch',
  addInstance: 'Add instance',
  backToWorkbench: 'Back to workbench',
  renameInstance: 'Rename',
  removeInstance: 'Remove',
  removeInstanceConfirm: 'Remove this instance? The token saved on this machine will be deleted.',
  instanceAlias: 'Instance name',
  instanceAliasHint: '1–40 characters to tell instances apart; the display name can change anytime.',
  cancel: 'Cancel',
  save: 'Save',
  aliasInvalid: 'Instance name must be 1–40 characters',
  aliasTaken: 'That instance name is already taken',
  instanceNotConnected: 'Not connected',

  'err.REMOTE_UNAVAILABLE': 'The FlareMo service is not mounted',
  'err.NOT_CONNECTED': 'No FlareMo instance is connected',
  'err.NO_PENDING_CONNECT': 'No pairing in progress',
  'err.INVALID_INSTANCE_URL': 'The instance URL is not a valid http(s) URL',
  'err.CONNECT_EXPIRED': 'The pairing code expired — generate a new one',
  'err.CONNECT_DENIED': 'Authorization was denied',
  'err.AUTH_EXPIRED': 'Authorization expired — pair again',
  'err.NETWORK': 'Network request failed',
  'err.TIMEOUT': 'Request timed out',
  'err.HTTP_ERROR': 'FlareMo returned an error',
  'err.BAD_RESPONSE': 'FlareMo returned an unrecognized response',
  'err.BAD_ARGS': 'Missing arguments',
  'err.GATEWAY_ERROR': 'The DSH gateway call failed',
  'err.INTERNAL': 'Internal error',
  'err.SERVICE_UNMOUNTED': 'The FlareMo service is not mounted',
  'err.INSTANCE_NOT_FOUND': 'Instance not found; it may have been removed',
  'err.ALIAS_TAKEN': 'That instance name is already taken',
  'err.INVALID_ALIAS': 'Instance name must be 1–40 characters',
  'err.MODEL_UNAVAILABLE': 'No DSH model is available — pick a default model in Settings → Models',
  'err.MODEL_FAILED': 'The model call failed',
  'err.MODEL_BAD_OUTPUT': 'The model output was not parseable JSON, so nothing was written back',
  'err.INSIGHT_NO_NOTES': 'This insight task has no usable notes (they may have been deleted)',
  'err.INSIGHT_TERMINAL': 'The task is already final; skipped',

  executorTitle: 'Insight executor',
  executorIntro: 'FlareMo stores tasks but never runs a model: this pulls pending tasks, generates with the DSH default model, and writes the result back.',
  executorPending: '{count} pending tasks',
  executorNone: 'No pending insight tasks',
  executorRun: 'Run insight tasks',
  executorRunning: 'Running…',
  executorLimitHint: 'Up to 3 tasks per run; each one calls the model once.',
  executorSummary: 'done {done} · failed {failed} · skipped {skipped}',
  executorModel: 'Model',
  executorModelNone: 'Model unavailable: {reason}',
  executorTaskFailed: 'Task {id} failed: {error}',
  executorTaskDone: 'Task {id} done',
}

/** `{name}` 占位替换；locale 服务的 t 不一定做插值，这里统一自己补。 */
export function interpolate(template, vars) {
  if (typeof template !== 'string') return ''
  if (vars === undefined || vars === null) return template
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match,
  )
}

/**
 * 直接读中文词典的兜底翻译器（shape 与 locale.bind(NS) 返回的一致）。
 * @param {string} key - dictionary key.
 * @returns {string} the zh string, or the key itself when missing.
 */
export function fallbackT(key) {
  return Object.prototype.hasOwnProperty.call(ZH, key) ? ZH[key] : key
}

/**
 * 造一个稳定的翻译器：能用 locale 绑定就用，不能用就退回内置中文；
 * 统一做 `{name}` 插值，并给未知 key 一个非空兜底。
 * @param {((key: string) => string) | undefined} t - locale-bound translator.
 * @returns {(key: string, vars?: Record<string, unknown>) => string} translator.
 */
export function createTranslator(t) {
  return (key, vars) => {
    let text
    try {
      text = typeof t === 'function' ? t(key) : undefined
    } catch {
      text = undefined
    }
    if (typeof text !== 'string' || text === '' || text === key) text = fallbackT(key)
    return interpolate(text, vars)
  }
}

/**
 * RPC 失败码 → 文案：先查 `err.<CODE>`，查不到就用 host 的 message。
 * @param {(key: string, vars?: Record<string, unknown>) => string} tr - translator.
 * @param {{ code?: string, message?: string }} error - ApiError-like failure.
 * @returns {string} human message.
 */
export function translateError(tr, error) {
  const code = typeof error?.code === 'string' ? error.code : 'INTERNAL'
  const key = `err.${code}`
  const text = tr(key)
  if (text !== key) return text
  return typeof error?.message === 'string' && error.message !== '' ? error.message : tr('err.INTERNAL')
}
