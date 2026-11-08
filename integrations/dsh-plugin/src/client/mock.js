/**
 * 离线示例数据（连不上实例 / 还没配对时工作台显示这一份）。
 *
 * 真实数据由 host 的 typert RPC 提供；这里的笔记结构与 RPC 返回的窄视图
 * 保持一致（id / title / excerpt / tags / day / updatedAt / content），
 * 只是正文直接给成 `blocks`，省掉一次 Markdown 解析。
 *
 * 字段：
 *   id        稳定 id
 *   title     标题
 *   excerpt   列表里的一行摘要
 *   tags      标签
 *   day       时间线分组的自然日（YYYY-MM-DD）
 *   updatedAt ISO 时间
 *   source    来源（web / api / import）
 *   blocks    正文块数组（真实数据用 content + parseContent）
 *   insight   示例洞察；真实数据没有（下一版由 host 洞察执行器生成）
 */

/** 假的实例地址，只出现在状态条上。 */
export const SOURCE_HOST = 'flaremo.example.com'

/** 假的「最后同步」时间。 */
export const LAST_SYNC_AT = '2026-11-08T19:32:00+08:00'

/** 8 条笔记，跨 3 天。内容围绕这次 FlareMo × DSH 的设计讨论。 */
export const MOCK_NOTES = [
  {
    id: 'n-workbench-panel',
    title: '把 FlareMo 工作台搬进 DSH：全局面板就够了',
    excerpt: 'DSH 的中栏是 keyed slot，没有顶部 tab 栏扩展点，左栏多一行才是官方形态。',
    tags: ['DSH', '插件'],
    day: '2026-11-08',
    updatedAt: '2026-11-08T19:30:00+08:00',
    source: 'web',
    blocks: [
      {
        type: 'p',
        text: '之前一直想给 DSH 加一条顶部横向 tab 条，把「会话 / 笔记 / 设置」并排放。翻完 ui-layout 的实现后确认：外壳固定三栏，中栏是 keyed slot（main），同一时刻只渲染一个 key，conversation 是保留 key，没有顶部 tab 的扩展点。',
      },
      {
        type: 'p',
        text: '官方给的等价形态是「全局面板」：左栏多一行导航项，点进去中栏整块换掉。DSH 自带的「插件」页（key = plugins）就是这么做的，官方插件管理器把注册写在 apply 里的三条语句里。',
      },
      { type: 'heading', text: '最小注册面' },
      {
        type: 'code',
        text: "ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'flaremo' }, Workbench))\nctx.slots.inject('sidebar.panellist', () => ctx.slots.register({\n  name: 'sidebar.panellist', id: 'flaremo', order: 5, label: () => t('panel'),\n}, FlareMoIcon))",
      },
      {
        type: 'list',
        items: [
          '左栏行的 id 必须等于 main 的 key，外壳靠这个把点击映射成 selectPanel。',
          'label 收函数而不是字符串，locale 切换时外壳会重新取。',
          '面板组件只在被选中时渲染，不用自己判断可见性。',
          '想从别处打开：ctx.layout.selectPanel("flaremo")，回会话传 null。',
        ],
      },
      {
        type: 'quote',
        text: '所以「主界面新 tab」的真实形态是：左栏多一行导航项，点了中栏整块换成你的页面。',
      },
    ],
    insight: {
      summary: '结论已经收敛：用全局面板（main keyed slot + sidebar.panellist）而不是自造 tab 条，注册面只有两条 inject/register，导航由外壳代劳。',
      points: [
        'main 是 keyed slot，key 与左栏 id 必须一致；冲突或写错时面板不出现。',
        'label 是函数、locale 一并注册，才能跟着 DSH 的语言切换。',
        '面板按需渲染，工作台内部不需要再写可见性判断。',
      ],
      questions: [
        '如果以后要「会话里对照某条笔记」，是不是再加右栏 tab 更顺？',
        'selectPanel(null) 回会话时，工作台里选中的笔记要不要保留？',
      ],
    },
  },
  {
    id: 'n-panel-vs-dock',
    title: '全局面板 vs 右栏 tab：先做哪个',
    excerpt: '右栏是每会话的，没有会话就没有右栏；所以主体只能是全局面板。',
    tags: ['产品', '决策'],
    day: '2026-11-08',
    updatedAt: '2026-11-08T16:05:00+08:00',
    source: 'web',
    blocks: [
      {
        type: 'p',
        text: '两条候选路径：A 全局面板（工作台），B 会话右栏 tab（边聊边看某条笔记）。B 的体验更轻，但官方文档写得很清楚：右栏是「每会话」的停靠面，没有会话就没有按钮也没有面板。',
      },
      {
        type: 'list',
        ordered: true,
        items: [
          'A 作为主体：所有功能都能用，不依赖当前会话。',
          'B 作为增强：只在会话里出现，失败时整体降级到 A。',
          '设置页单独一节，负责实例地址与授权状态，不塞进工作台。',
        ],
      },
      {
        type: 'p',
        text: '第一版骨架只做 A。B 的注册是两阶段（sidebarRightTabs.register + sidebar.right.pane.tab），等数据通道跑通再加。',
      },
    ],
    insight: {
      summary: '决策：第一版只做全局面板；右栏 tab 定位为会话内增强，晚一版做，且必须能在缺失时自动降级。',
      points: [
        '右栏没有会话就不存在，不能承担「总入口」。',
        '两阶段注册（tab 类型 + 正文 slot）比全局面板复杂，不该和骨架一起上线。',
        '设置页与工作台分开，避免把授权状态混进笔记时间线。',
      ],
      questions: ['右栏 tab 的第一批用户场景到底是什么？', '没有会话时用户从哪里进入工作台？'],
    },
  },
  {
    id: 'n-insight-executor',
    title: 'AI 洞察先外置成执行器，别塞进浏览器',
    excerpt: 'host 拉 pending → 用 DSH 模型生成 → 写回；client 只负责展示。',
    tags: ['AI', '架构'],
    day: '2026-11-08',
    updatedAt: '2026-11-08T11:48:00+08:00',
    source: 'api',
    blocks: [
      {
        type: 'p',
        text: '洞察这个动作有三个可能的位置：浏览器里调模型、host 里调模型、独立的执行器进程。浏览器里做最省事，但 PAT 会进页面，而且刷新就丢进度。',
      },
      {
        type: 'p',
        text: '选 host 当执行器：FlareMo 侧维护 pending 队列与状态机，插件 host 定时拉 pending，用 DSH 自己的模型生成，再写回 FlareMo。client 只渲染结果，不接触密钥。',
      },
      {
        type: 'list',
        items: [
          'client 永远不拿 PAT：笔记数据走 host 代理，密钥走 DSH 凭据服务。',
          '生成是显式动作：用户点「问这条」才入队，不做自动总结。',
          '失败留在 pending / failed 状态，界面上可见、可重试。',
        ],
      },
      {
        type: 'code',
        text: '拉 pending → ctx.get("llm") 生成 → POST 回写状态机\n（第一版骨架不实现，只在右栏放固定的假洞察）',
      },
    ],
    insight: {
      summary: '把洞察做成 host 侧执行器：client 只展示，密钥与模型调用都留在 host；生成必须是用户显式触发。',
      points: [
        '浏览器不接触 PAT，数据只经 host 代理。',
        '状态机（pending / running / done / failed）让界面能恢复、能重试。',
        '不做自动同步或自动总结，避免把隐私决定交给后台。',
      ],
      questions: ['执行器的触发是定时还是 DSH 会话事件？', '失败重试几次后放弃？'],
    },
  },
  {
    id: 'n-device-auth',
    title: '设备授权走 RFC 8628 配对码',
    excerpt: '插件设置页输入配对码，token 存 DSH 凭据服务；不做匿名的动态注册。',
    tags: ['认证', '安全'],
    day: '2026-11-07',
    updatedAt: '2026-11-07T20:12:00+08:00',
    source: 'web',
    blocks: [
      {
        type: 'p',
        text: 'FlareMo 要接的第一个第三方客户端就是 DSH，但授权不该是「复制一个 PAT 粘贴」这种一次性体验。设计文档选了 RFC 8628 的设备授权：插件显示一个短码，用户在 FlareMo 网页确认，插件轮询拿 token。',
      },
      {
        type: 'list',
        items: [
          '三个端点：发起、轮询、吊销；轮询要处理 slow_down。',
          'token 只进 DSH 凭据服务，client 半片永远拿不到明文。',
          '「已连接应用」页能看见设备、最后使用时间，并能一键吊销。',
          '不做匿名的动态注册：客户端身份必须有归属。',
        ],
      },
      {
        type: 'quote',
        text: 'scope 保持粗粒度：notes / admin。不做细粒度的逐条笔记授权。',
      },
    ],
    insight: {
      summary: '授权侧已经定稿：设备授权码 + 凭据服务托管 token + 可吊销的设备列表；不开放匿名注册。',
      points: [
        'token 明文只存在于 DSH 凭据服务，插件设置页只显示状态。',
        '轮询状态机要覆盖 slow_down / expired / denied。',
        'scope 粗粒度，降低授权界面与后端校验的复杂度。',
      ],
      questions: ['多实例时授权是按实例还是按用户？', 'token 过期后是静默续期还是提示重新配对？'],
    },
  },
  {
    id: 'n-multi-instance',
    title: '多实例只切换，不混排',
    excerpt: '两个 FlareMo 实例的笔记如果混在一条时间线上，日期和标签都会互相污染。',
    tags: ['产品', '决策'],
    day: '2026-11-07',
    updatedAt: '2026-11-07T14:26:00+08:00',
    source: 'web',
    blocks: [
      {
        type: 'p',
        text: '有一阵想做一个「聚合视图」：把所有已连接 FlareMo 实例的笔记混排成一条时间线。试着想了两天，发现并发编辑、标签同名、id 冲突三件事都要额外定义语义，收益却只是少点一次切换。',
      },
      {
        type: 'p',
        text: '决定：多实例只切换，不混排。切换器放在工作台左上角，当前实例在状态条里可见。',
      },
    ],
    insight: {
      summary: '多实例的产品边界是「切换」：不做混排，避免标签、id、并发编辑的语义纠缠。',
      points: [
        '混排会带来 id 冲突与标签同名，需要额外语义。',
        '切换器 + 状态条足以表达「现在在看哪个实例」。',
        '这条决定同时约束了缓存目录：按实例分开存。',
      ],
      questions: ['切换实例时要不要保留上一条选中笔记？', '实例连接失败时的空态怎么写？'],
    },
  },
  {
    id: 'n-first-sync',
    title: '笔记第一次同步要快，别等全量',
    excerpt: '先拉最近 50 条渲染时间线，剩下的一边滚一边补。',
    tags: ['性能', '同步'],
    day: '2026-11-06',
    updatedAt: '2026-11-06T18:40:00+08:00',
    source: 'import',
    blocks: [
      {
        type: 'p',
        text: '工作台打开的第一秒决定印象。如果先同步全量再渲染，几千条笔记会让首屏空白好几秒。第一版策略：只拉最近 50 条填充时间线，滚动到底再增量拉。',
      },
      {
        type: 'list',
        items: [
          '首屏：50 条 + 上一条打开位置，300ms 内出内容。',
          '滚动到底：按游标拉下一页，避免 offset 分页在写入时错位。',
          '搜索：第一版交给 host 端，client 不再本地全量过滤。',
          '缓存：host 侧 state.json 存最近一批，跨端一致。',
        ],
      },
      {
        type: 'p',
        text: '骨架版里这些都不存在：8 条假数据一次性渲染，但组件结构刻意按「分页 + 滚动加载」的形态留了位置（左栏的列表容器与底部的加载占位）。',
      },
    ],
    insight: {
      summary: '首屏体验优先：先 50 条 + 恢复位置，滚动增量、游标分页、搜索交给 host；骨架版先按这个形态搭组件。',
      points: [
        '游标分页比 offset 更适合持续写入的笔记流。',
        '缓存落在 host，才能桌面端与 Web 端一致。',
        '骨架版保留列表容器与加载占位，接数据时不用改结构。',
      ],
      questions: ['50 条是否够填满一屏？', '搜索的空结果与未同步怎么区分？'],
    },
  },
  {
    id: 'n-explicit-ai',
    title: '把「问 AI」做成显式动作',
    excerpt: '只有用户勾选并点击才构造提示词；不做后台自动总结。',
    tags: ['交互', 'AI'],
    day: '2026-11-06',
    updatedAt: '2026-11-06T15:10:00+08:00',
    source: 'web',
    blocks: [
      {
        type: 'p',
        text: '笔记是很私人的东西，默认自动送进模型会让人收手。交互上设三道门：勾选（哪几条）、点击「问 AI」（现在）、在会话里按回车（真的发）。',
      },
      {
        type: 'list',
        ordered: true,
        items: [
          '勾选：卡片左上角的复选框，悬停才出现，避免视觉噪音。',
          '问 AI：顶栏按钮显示数量，0 条时禁用。',
          '注入：新开会话并填草稿（uiWorkspace.startSession），不打断当前对话。',
        ],
      },
      {
        type: 'p',
        text: '提示词里带条数上限与字节上限，client 侧硬截断，别把整本笔记塞进上下文。',
      },
    ],
    insight: {
      summary: '「问 AI」必须是三步显式动作，任何一步自动都会让人不敢用；注入走新会话草稿，不覆盖当前对话。',
      points: [
        '勾选 → 点击 → 回车，三次显式确认。',
        'startSession 填草稿而不是直接发送，保留最后的撤回机会。',
        '提示词在 client 侧截断条数与字节，保护上下文窗口。',
      ],
      questions: ['勾选状态在切换笔记后要不要保留？', '注入多条笔记时正文截断到多少？'],
    },
  },
  {
    id: 'n-density',
    title: '工作台三栏的信息密度',
    excerpt: '左 280 / 中自适应 / 右 320：右栏默认展开，但能一键收起。',
    tags: ['设计', '交互'],
    day: '2026-11-06',
    updatedAt: '2026-11-06T10:22:00+08:00',
    source: 'web',
    blocks: [
      {
        type: 'p',
        text: '三栏一起上会挤：左栏时间线要扫得快，中间正文要能读，右栏洞察又常常是可看可不看。折中方案：左栏固定 280–320，中栏吃掉剩余宽度，右栏 320 且默认可收起；窄屏（< 1100）自动收起右栏。',
      },
      {
        type: 'list',
        items: [
          '左栏：日期吸顶分组 + 两行摘要卡片，扫读优先。',
          '中栏：标题条 + 只读正文 + 底部操作条。',
          '右栏：摘要、要点、相关笔记、可追问，四块固定顺序。',
          '状态条：最后同步时间、条数、来源实例，一行足矣。',
        ],
      },
      {
        type: 'p',
        text: '颜色只走 --dsw-* token，深色主题不写第二套样式；正文用 --dsh-content-font-size，说明文字小一号。',
      },
    ],
    insight: {
      summary: '三栏的密度靠「左窄中宽右可收起」解决：扫读在左、阅读在中、可选信息在右，状态条只留一行。',
      points: [
        '右栏默认展开但可收起，窄屏自动收起。',
        '颜色与字号全走 DSH token，不写第二套深色样式。',
        '状态条只放同步时间、条数、来源三件事。',
      ],
      questions: ['右栏收起后要不要留一个竖条提示？', '左栏是否需要紧凑模式？'],
    },
  },
]

/** 假洞察的兜底：没有写 insight 的笔记用它。 */
function defaultInsight(note) {
  return {
    summary: `「${note.title}」围绕 ${note.tags.map((tag) => `#${tag}`).join(' ')} 展开，骨架版先用固定文案占位，接入真实洞察后由 host 生成。`,
    points: [
      `这条笔记属于 ${note.day}，来源 ${note.source}。`,
      '真实洞察会从「主题脉络 / 被忽略的点 / 下一步」三个角度生成。',
      '第一版只演示右栏的版式与折叠，不调用模型。',
    ],
    questions: [`这条和 ${note.tags[0] ?? '相关主题'} 的其他笔记是什么关系？`, '下一步具体做什么？'],
  }
}

/**
 * 取一条笔记的假洞察，并按标签把「相关笔记」串起来。
 * @param {object|null} note - 当前选中的笔记。
 * @param {ReadonlyArray<object>} all - 全部笔记，用于算相关项。
 * @returns {object|null} 结构化洞察；没有笔记时返回 null。
 */
export function insightFor(note, all) {
  if (note === null || note === undefined) return null
  const base = note.insight ?? defaultInsight(note)
  const related = all
    .filter((other) => other.id !== note.id && other.tags.some((tag) => note.tags.includes(tag)))
    .slice(0, 3)
    .map((other) => ({ id: other.id, title: other.title, day: other.day }))
  return { ...base, related }
}
