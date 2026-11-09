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
  title: 'FlareMo 工作台',
  subtitle: '时间线 · 详情 · AI 洞察',
  badgeLive: '实时',
  badgeOffline: '未连接',
  searchPlaceholder: '搜索标题、标签或正文…',
  searchRemoteHint: '回车在实例上搜索',
  askAi: '问 AI',
  refresh: '刷新',
  timeline: '时间线',
  noteCount: '{count} 条',
  emptyRemote: '这个实例还没有笔记',
  selected: '已选 {count} 条',
  copyContent: '复制正文',
  addSelection: '加入选择',
  removeSelection: '取消选择',
  backToConversation: '回到会话',

  // 时间线页（与网页版同构）：侧栏统计 / 日历 / 导航 / 编写框
  statsRecords: '记录',
  statsTags: '标签',
  statsStreak: '连续',
  calendarPrev: '上个月',
  calendarNext: '下个月',
  calendarToday: '今天',
  navAll: '全部记录',
  navArchived: '归档',
  navTrashed: '回收站',
  tagsTitle: '标签',
  tagsAll: '全部标签',
  tagsEmpty: '还没有标签',
  composePlaceholder: '写点什么…',
  composeSend: '发布',
  composeHint: '⌘↵ 发布',
  composeEmpty: '先写点什么',
  composePosted: '已发布',
  composeFailed: '发布失败',
  timelineEmpty: '还没有便签',
  timelineEmptyHint: '在上面写第一条，或者切换实例看看。',
  archiveEmpty: '归档里还没有便签',
  trashEmpty: '回收站是空的',
  filterDay: '日期：{day}',
  filterTag: '标签：#{tag}',
  filterQuery: '搜索：{query}',
  clearFilter: '清除筛选',
  backToTimeline: '返回时间线',
  openNote: '打开便签',
  noteCommentsCount: '{count} 条评论',
  sidebarCollapse: '收起侧栏',
  sidebarExpand: '展开侧栏',
  loadingStats: '正在统计…',

  // 工作台右侧
  insight: '洞察',
  askThis: '问这条',
  quoteToChat: '引用到会话',
  collapse: '收起洞察',
  expand: '展开洞察',
  emptyInsight: '选一条笔记，右侧显示信息',
  noteInfo: '笔记信息',
  noteWords: '字数 {count}',
  noteUpdated: '更新于 {time}',
  noteTags: '标签 {count} 个',
  noteVisibility: '可见性',
  noteSource: '来源',
  noteCreator: '作者',
  noteComments: '评论 {count} 条',
  relatedByTag: '同标签笔记',
  insightComingSoon: 'AI 洞察由 host 的洞察执行器生成，下一版接入。',

  // 未连接时的连接引导（不显示任何示例数据）
  guideTitle: '连接 FlareMo 实例',
  guideBody: '连接后这里显示你的笔记、标签和洞察队列。现在还没有连接任何实例。',
  guideRetry: '重新检查连接',
  guideInlineHint: '配对码在 FlareMo 网页批准一次即可；token 只存在本机 DSH 凭据里。',
  footerDisconnected: '未连接实例',

  // 连接状态
  loadingNotes: '正在读取笔记…',
  loadFailed: '读取失败',
  syncHint: '最后同步 {time} · {count} 条',

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
  connectedAt: '连接于 {time}',
  lastSync: '最后同步 {time}',
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

  // 工作台里的临时提示（骨架版没有真实动作）
  noticeAsk: '已按选中内容拼好注入提示词的骨架（{count} 条笔记）；真正的 AI 注入等下一版。',
  noticeCopy: '已复制笔记正文到剪贴板。',
  noticeCopyFailed: '复制失败：当前环境不允许写剪贴板。',
  noticeRefresh: '已重新读取。',
  noticeQuote: '骨架版还没有会话右栏：引用动作等下一版接 uiWorkspace / inputActions。',

  // 洞察执行器
  executorTitle: '洞察执行器',
  executorIntro: 'FlareMo 只存任务、不跑模型：这里拉取 pending 任务，用 DSH 的默认模型生成结果并写回。',
  executorPending: '{count} 个待处理任务',
  executorNone: '没有待处理的洞察任务',
  executorRun: '处理洞察任务',
  executorRunning: '正在处理…',
  executorLimitHint: '一次最多处理 3 个任务，每条会调用一次模型。',
  executorDone: '完成 {done} 个',
  executorSummary: 'done {done} · failed {failed} · skipped {skipped}',
  executorModel: '模型',
  executorModelNone: '模型不可用：{reason}',
  executorRefreshed: '已刷新队列',
  executorTaskFailed: '任务 {id} 失败：{error}',
  executorTaskDone: '任务 {id} 完成',
  executorQueue: '洞察队列',
  executorRunShort: '处理',
}

export const EN = {
  panel: 'Notes',
  title: 'FlareMo Workbench',
  subtitle: 'Timeline · Detail · Insight',
  // Timeline page (mirrors the web app): sidebar stats / calendar / nav / composer
  statsRecords: 'Notes',
  statsTags: 'Tags',
  statsStreak: 'Streak',
  calendarPrev: 'Previous month',
  calendarNext: 'Next month',
  calendarToday: 'Today',
  navAll: 'All notes',
  navArchived: 'Archive',
  navTrashed: 'Trash',
  tagsTitle: 'Tags',
  tagsAll: 'All tags',
  tagsEmpty: 'No tags yet',
  composePlaceholder: 'Write something…',
  composeSend: 'Post',
  composeHint: '⌘↵ to post',
  composeEmpty: 'Write something first',
  composePosted: 'Posted',
  composeFailed: 'Post failed',
  timelineEmpty: 'No notes yet',
  timelineEmptyHint: 'Write the first one above, or switch instances.',
  archiveEmpty: 'Nothing archived yet',
  trashEmpty: 'Trash is empty',
  filterDay: 'Date: {day}',
  filterTag: 'Tag: #{tag}',
  filterQuery: 'Search: {query}',
  clearFilter: 'Clear filters',
  backToTimeline: 'Back to timeline',
  openNote: 'Open note',
  noteCommentsCount: '{count} comments',
  sidebarCollapse: 'Collapse sidebar',
  sidebarExpand: 'Expand sidebar',
  loadingStats: 'Loading stats…',

  badgeLive: 'Live',
  badgeOffline: 'Not connected',
  searchPlaceholder: 'Search title, tag or body…',
  searchRemoteHint: 'Press Enter to search the instance',
  askAi: 'Ask AI',
  refresh: 'Refresh',
  timeline: 'Timeline',
  noteCount: '{count} notes',
  emptyRemote: 'This instance has no notes yet',
  selected: '{count} selected',
  copyContent: 'Copy body',
  addSelection: 'Select',
  removeSelection: 'Unselect',
  backToConversation: 'Back to conversation',

  insight: 'Insight',
  askThis: 'Ask about this',
  quoteToChat: 'Quote into chat',
  collapse: 'Collapse insight',
  expand: 'Expand insight',
  emptyInsight: 'Pick a note to see its details on the right',
  noteInfo: 'Note info',
  noteWords: '{count} words',
  noteUpdated: 'Updated {time}',
  noteTags: '{count} tags',
  noteVisibility: 'Visibility',
  noteSource: 'Source',
  noteCreator: 'Creator',
  noteComments: '{count} comments',
  relatedByTag: 'Same tag',
  insightComingSoon: 'AI insight is produced by the host insight executor in the next version.',

  guideTitle: 'Connect a FlareMo instance',
  guideBody: 'Once connected, this panel shows your notes, tags and insight queue. No instance is connected right now.',
  guideRetry: 'Recheck connection',
  guideInlineHint: 'Approve the code once in the FlareMo web app; the token stays in this machine’s DSH credentials.',
  footerDisconnected: 'No instance connected',

  loadingNotes: 'Loading notes…',
  loadFailed: 'Load failed',
  syncHint: 'Last sync {time} · {count} notes',

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
  connectedAt: 'Connected {time}',
  lastSync: 'Last sync {time}',
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

  noticeAsk: 'Built a skeleton injection prompt from {count} selected note(s); real AI injection lands next version.',
  noticeCopy: 'Copied the note body to the clipboard.',
  noticeCopyFailed: 'Copy failed: this environment does not allow clipboard writes.',
  noticeRefresh: 'Reloaded.',
  noticeQuote: 'No session right bar yet: quoting lands next version via uiWorkspace / inputActions.',

  executorTitle: 'Insight executor',
  executorIntro: 'FlareMo stores tasks but never runs a model: this pulls pending tasks, generates with the DSH default model, and writes the result back.',
  executorPending: '{count} pending tasks',
  executorNone: 'No pending insight tasks',
  executorRun: 'Run insight tasks',
  executorRunning: 'Running…',
  executorLimitHint: 'Up to 3 tasks per run; each one calls the model once.',
  executorDone: 'Finished {done}',
  executorSummary: 'done {done} · failed {failed} · skipped {skipped}',
  executorModel: 'Model',
  executorModelNone: 'Model unavailable: {reason}',
  executorRefreshed: 'Queue refreshed',
  executorTaskFailed: 'Task {id} failed: {error}',
  executorTaskDone: 'Task {id} done',
  executorQueue: 'Insight queue',
  executorRunShort: 'Run',
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
