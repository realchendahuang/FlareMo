/**
 * FlareMo 时间线面板（DSH 全局面板），版面与网页版 `/` 同构：
 *
 *   ┌ 侧栏（品牌 / 实例切换 / 统计 / 月历 / 导航 / 标签 / 洞察队列 / 同步）┐
 *   │ 主列：标题栏（页面名 + 搜索 + 刷新）                               │
 *   │       编写框 → 时间线便签流（按天分组）                            │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * 点便签进入详情（主列内切换，侧栏保留），由「返回时间线」回去——对应网页版
 * 的 /memo/:id 详情页。数据全部来自 host 的 typert RPC（token 不进 client）：
 *   connectionStatus / listNotes / memoStats / listTags / listPendingInsights /
 *   createNote / switchInstance / runPendingInsights。
 *
 * 未连接或添加实例时整块换成连接引导（connect.jsx 的状态机），不显示示例数据。
 */

import React from 'react'

import { asApiError } from './api.js'
import { Composer } from './composer.jsx'
import { ConnectForm, PairingCard, useConnectFlow } from './connect.jsx'
import { createTranslator, translateError } from './i18n.js'
import {
  formatDateTime,
  groupByDay,
  noteBlocks,
  noteCharCount,
  noteText,
  relatedByTag,
} from './notes.js'
import { activeInstanceOf, hostOf, Sidebar } from './sidebar.jsx'
import { C, S, T } from './styles.js'
import {
  IconArchive,
  IconCheck,
  IconChevronLeft,
  IconCopy,
  IconGrid,
  IconPanelLeft,
  IconRefresh,
  IconSearch,
  IconSparkle,
  IconTrash,
} from './icons.jsx'

/** 查看。 */
const VIEWS = {
  all: { icon: IconGrid, labelKey: 'navAll', emptyKey: 'timelineEmpty' },
  archived: { icon: IconArchive, labelKey: 'navArchived', emptyKey: 'archiveEmpty' },
  trashed: { icon: IconTrash, labelKey: 'navTrashed', emptyKey: 'trashEmpty' },
}

/** 侧栏切换后 day 过滤用的服务端查询：after 含、before 不含。 */
export function dayRangeQuery(day) {
  if (typeof day !== 'string' || day.length !== 10) return ''
  const base = new Date(`${day}T00:00:00`)
  if (Number.isNaN(base.getTime())) return ''
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1)
  const key = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
  return `after:${day} before:${key}`
}

/** 正文块渲染：语义标签交给 .fm-prose 排版（theme.js）。 */
export function BlockView({ block }) {
  switch (block.type) {
    case 'p':
      return <p>{block.text}</p>
    case 'heading': {
      const level = Number(block.level) > 0 ? Number(block.level) : 3
      const Tag = level <= 1 ? 'h1' : level === 2 ? 'h2' : 'h3'
      return <Tag>{block.text}</Tag>
    }
    case 'quote':
      return <blockquote>{block.text}</blockquote>
    case 'list': {
      const List = block.ordered === true ? 'ol' : 'ul'
      return (
        <List>
          {(block.items ?? []).map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </List>
      )
    }
    case 'code':
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      )
    case 'divider':
      return <hr />
    default:
      return null
  }
}

/** 时间线便签卡（网页版 MemoCard 的只读简化版）。 */
export function MemoCard({ note, tr, selected, onOpen, onToggle, onCopy }) {
  const blocks = noteBlocks(note)
  return (
    <article className="fm-memo">
      <div className="fm-memo-head">
        <span className="fm-memo-time">{formatDateTime(note.updatedAt)}</span>
        {note.visibility ? (
          <span className="fm-badge" data-tone="neutral">
            {note.visibility}
          </span>
        ) : null}
        {note.commentCount > 0 ? (
          <span style={{ ...T.micro, color: C.textSecondary }}>
            {tr('noteCommentsCount', { count: note.commentCount })}
          </span>
        ) : null}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            type="button"
            className="fm-btn"
            data-variant="ghost"
            data-size="icon-sm"
            onClick={() => onCopy(note)}
            title={tr('copyContent')}
            aria-label={tr('copyContent')}
          >
            <IconCopy size={13} />
          </button>
          <button
            type="button"
            className="fm-btn"
            data-variant="ghost"
            data-size="icon-sm"
            aria-pressed={selected}
            onClick={() => onToggle(note.id)}
            title={selected ? tr('removeSelection') : tr('addSelection')}
            aria-label={selected ? tr('removeSelection') : tr('addSelection')}
          >
            <IconCheck size={13} style={{ color: selected ? C.accent : undefined }} />
          </button>
        </span>
      </div>

      <div
        className="fm-memo-body"
        role="button"
        tabIndex={0}
        aria-label={tr('openNote')}
        onClick={() => onOpen(note)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpen(note)
          }
        }}
        style={{ cursor: 'pointer' }}
      >
        <div className="fm-prose">
          {blocks.length === 0 ? (
            <p>{note.excerpt}</p>
          ) : (
            blocks.map((block, index) => <BlockView key={index} block={block} />)
          )}
        </div>
      </div>

      {(note.tags ?? []).length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(note.tags ?? []).map((tag) => (
            <span key={tag} className="fm-chip">
              #{tag}
            </span>
          ))}
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
        <span style={{ ...T.micro, color: C.textSecondary }}>{note.source ?? ''}</span>
        <button
          type="button"
          className="fm-btn"
          data-variant="ghost"
          data-size="xs"
          onClick={() => onOpen(note)}
          style={{ marginLeft: 'auto' }}
        >
          {tr('openNote')}
        </button>
      </div>
    </article>
  )
}

/** 便签详情（主列内页面，对应网页版 /memo/:id）。 */
function NoteDetail({ tr, note, related, selected, onBack, onCopy, onToggle, onOpen, openConversation }) {
  const blocks = noteBlocks(note)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" className="fm-btn" data-variant="ghost" data-size="sm" onClick={onBack}>
          <IconChevronLeft size={14} />
          {tr('backToTimeline')}
        </button>
      </div>

      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ margin: 0, ...T.h1, color: C.text }}>{note.title}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', ...T.caption, color: C.textSecondary }}>
          <span>{tr('noteUpdated', { time: formatDateTime(note.updatedAt) })}</span>
          {note.source ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{note.source}</span>
            </>
          ) : null}
          {note.visibility ? <span className="fm-badge" data-tone="neutral">{note.visibility}</span> : null}
          {(note.tags ?? []).map((tag) => (
            <span key={tag} className="fm-chip">
              #{tag}
            </span>
          ))}
        </div>
      </header>

      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
        <div className="fm-prose">
          {blocks.length === 0 ? (
            <p style={{ color: C.textSecondary }}>{note.excerpt}</p>
          ) : (
            blocks.map((block, index) => <BlockView key={index} block={block} />)
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: `1px solid ${C.border}`, paddingTop: 12, flexWrap: 'wrap' }}>
        <button type="button" className="fm-btn" data-variant="outline" data-size="sm" onClick={() => onCopy(note)}>
          <IconCopy size={14} />
          {tr('copyContent')}
        </button>
        <button
          type="button"
          className="fm-btn"
          data-variant="ghost"
          data-size="sm"
          aria-pressed={selected}
          onClick={() => onToggle(note.id)}
        >
          <IconCheck size={14} />
          {selected ? tr('removeSelection') : tr('addSelection')}
        </button>
        <span style={{ ...T.micro, color: C.textSecondary }}>{tr('noteWords', { count: noteCharCount(note) })}</span>
        {typeof openConversation === 'function' ? (
          <button
            type="button"
            className="fm-btn"
            data-variant="ghost"
            data-size="sm"
            onClick={openConversation}
            style={{ marginLeft: 'auto' }}
          >
            {tr('backToConversation')}
          </button>
        ) : null}
      </div>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        <h4 style={{ margin: 0, ...T.section, color: C.textSecondary }}>{tr('relatedByTag')}</h4>
        {related.length === 0 ? (
          <div style={{ ...T.caption, color: C.textSecondary }}>—</div>
        ) : (
          related.map((row) => (
            <button
              key={row.id}
              type="button"
              className="fm-nav-item"
              onClick={() => onOpen(row)}
              style={{ height: 'auto', padding: '7px 10px', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
            >
              <span style={{ ...T.caption, color: C.text, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.title}
              </span>
              <span style={{ ...T.micro, color: C.textSecondary }}>{row.day}</span>
            </button>
          ))
        )}
      </section>
    </div>
  )
}

/** 时间线加载骨架。 */
function TimelineSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[0, 1, 2].map((row) => (
        <div key={row} className="fm-memo">
          <div className="fm-skeleton" style={{ width: 90, height: 10 }} />
          <div className="fm-skeleton" style={{ width: '92%', height: 12 }} />
          <div className="fm-skeleton" style={{ width: '78%', height: 12 }} />
          <div className="fm-skeleton" style={{ width: '40%', height: 10 }} />
        </div>
      ))}
    </div>
  )
}

/**
 * 连接引导（未连接 / 添加实例）。不渲染任何示例数据，也不把用户赶去设置页：
 * 实例地址 + 配对码 + 轮询全部长在面板里（与设置页共用 connect.jsx 的状态机）。
 */
export function ConnectGuide({ tr, loadError, onRetry, call, connection, onConnected, adding = false, onBack }) {
  const flow = useConnectFlow({
    call,
    tr,
    initialConnection: connection ?? { connected: false },
    onConnected: () => onConnected?.(),
  })
  const statusErrorText = flow.statusError === null ? null : translateError(tr, flow.statusError)
  const flowErrorText = flow.error === null ? null : translateError(tr, flow.error)
  const loadErrorText =
    loadError === null || loadError === undefined ? null : `${tr('loadFailed')}：${translateError(tr, loadError)}`
  const problems = [statusErrorText, flowErrorText, loadErrorText].filter((text) => text !== null)

  return (
    <div
      className="dsh-flaremo-guide fm-scroll"
      style={{
        flex: '1 1 auto',
        minHeight: 0,
        overflow: 'auto',
        display: 'flex',
        justifyContent: 'center',
        padding: '56px 24px 40px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 520 }}>
        {adding ? (
          <div style={{ marginBottom: 16 }}>
            <button type="button" className="fm-btn" data-variant="ghost" data-size="sm" onClick={onBack}>
              <IconChevronLeft size={14} />
              {tr('backToWorkbench')}
            </button>
          </div>
        ) : null}
        <div className="fm-empty" style={{ padding: '0 0 20px' }}>
          <div className="fm-empty-icon">
            <IconSparkle size={18} />
          </div>
          <div className="fm-empty-title">{adding ? tr('addInstance') : tr('guideTitle')}</div>
          {adding ? null : (
            <p className="fm-empty-desc" style={{ margin: 0 }}>
              {tr('guideBody')}
            </p>
          )}
        </div>

        {problems.map((text) => (
          <div key={text} className="fm-alert" data-tone="danger" style={{ marginBottom: 12 }}>
            {text}
          </div>
        ))}

        {flow.connected ? (
          <div style={{ ...T.body, color: C.textSecondary }}>{tr('loadingNotes')}</div>
        ) : flow.pending !== null ? (
          <PairingCard
            tr={tr}
            pending={flow.pending}
            now={flow.now}
            polling={flow.polling}
            onPoll={flow.pollNow}
            onCancel={flow.cancelPairing}
          />
        ) : (
          <ConnectForm
            tr={tr}
            instanceUrl={flow.instanceUrl}
            onChange={flow.setInstanceUrl}
            busy={flow.busy}
            onStart={flow.startPairing}
          />
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
          <button type="button" className="fm-btn" data-variant="ghost" data-size="sm" onClick={onRetry}>
            <IconRefresh size={14} />
            {tr('guideRetry')}
          </button>
          <span style={{ ...T.micro, color: C.textSecondary, lineHeight: '17px' }}>{tr('guideInlineHint')}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * 时间线面板主组件。props 来自 slot：标准 props（t）+ entry.jsx 的 inject face。
 * @param {{ t?: (key: string) => string, call?: (method: string, args?: object) => Promise<object>,
 *   openConversation?: () => void }} props
 * @returns {React.ReactElement} the timeline panel.
 */
export function Workbench({ t, call, openConversation }) {
  const tr = React.useMemo(() => createTranslator(t), [t])
  const hasCall = typeof call === 'function'

  const [connection, setConnection] = React.useState(null)
  const [connected, setConnected] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState(null)
  const [reloadKey, setReloadKey] = React.useState(0)
  const [notes, setNotes] = React.useState([])
  const [stats, setStats] = React.useState(null)
  const [tags, setTags] = React.useState([])
  const [insights, setInsights] = React.useState(null)
  const [runningInsights, setRunningInsights] = React.useState(false)
  const [view, setView] = React.useState('all')
  const [activeTag, setActiveTag] = React.useState(null)
  const [selectedDay, setSelectedDay] = React.useState(null)
  const [queryInput, setQueryInput] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState(() => new Set())
  const [activeNote, setActiveNote] = React.useState(null)
  const [composerPending, setComposerPending] = React.useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false)
  const [addingInstance, setAddingInstance] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState(null)

  // 搜索防抖 300ms
  React.useEffect(() => {
    const timer = setTimeout(() => setQuery(queryInput), 300)
    return () => clearTimeout(timer)
  }, [queryInput])

  // 提示条 3.2s 自动消失；同文案重复触发也要重新计时，所以带 seq。
  React.useEffect(() => {
    if (notice === null) return undefined
    const timer = setTimeout(() => setNotice(null), 3200)
    return () => clearTimeout(timer)
  }, [notice])

  const showNotice = React.useCallback((text) => {
    setNotice((previous) => ({ text, seq: (previous?.seq ?? 0) + 1 }))
  }, [])

  // 加载：连接状态 → 列表（view/tag/day/搜索）+ 统计 + 标签 + 洞察队列
  React.useEffect(() => {
    let live = true
    setLoading(true)
    setLoadError(null)
    ;(async () => {
      let statusView = null
      try {
        if (hasCall) {
          const reply = await call('connectionStatus')
          statusView = reply?.connection ?? null
        }
        if (!live) return
        setConnection(statusView)
        if (statusView?.connected !== true) {
          setNotes([])
          setTags([])
          setStats(null)
          setInsights(null)
          setConnected(false)
          return
        }
        setConnected(true)

        const params = { pageSize: 50 }
        if (view !== 'all') params.state = view
        if (activeTag !== null) params.tag = activeTag
        const parts = []
        if (selectedDay !== null) parts.push(dayRangeQuery(selectedDay))
        if (query.trim() !== '') parts.push(query.trim())
        const merged = parts.filter((part) => part !== '').join(' ')
        if (merged !== '') params.q = merged

        const listed = await call('listNotes', params)
        if (!live) return
        setNotes(Array.isArray(listed?.notes) ? listed.notes : [])

        // 侧栏三块并行加载；单块失败只影响自己，不挡时间线。
        void (async () => {
          try {
            const next = await call('memoStats', {})
            if (live) setStats(next ?? null)
          } catch {
            if (live) setStats(null)
          }
        })()
        void (async () => {
          try {
            const next = await call('listTags', {})
            if (live) setTags(Array.isArray(next?.tags) ? next.tags : [])
          } catch {
            if (live) setTags([])
          }
        })()
        void (async () => {
          try {
            const next = await call('listPendingInsights', { limit: 50 })
            if (live) {
              setInsights({
                count: Number(next?.count) > 0 ? Number(next.count) : 0,
                model: next?.model ?? null,
              })
            }
          } catch {
            if (live) setInsights(null)
          }
        })()
      } catch (failure) {
        if (!live) return
        setLoadError(asApiError(failure))
        setConnection(statusView)
        setNotes([])
        setConnected(false)
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [call, hasCall, reloadKey, view, activeTag, selectedDay, query])

  const toggleSelected = React.useCallback((id) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const copyNote = React.useCallback(
    async (note) => {
      const text = typeof note?.content === 'string' && note.content !== '' ? note.content : noteText(note)
      try {
        if (typeof navigator === 'undefined' || navigator.clipboard === undefined) throw new Error('no clipboard')
        await navigator.clipboard.writeText(text)
        showNotice(tr('noticeCopy'))
      } catch {
        showNotice(tr('noticeCopyFailed'))
      }
    },
    [showNotice, tr],
  )

  const refresh = React.useCallback(() => {
    setReloadKey((value) => value + 1)
    showNotice(tr('noticeRefresh'))
  }, [showNotice, tr])

  const createNote = React.useCallback(
    async (text) => {
      if (!hasCall) throw new Error('unavailable')
      setComposerPending(true)
      try {
        await call('createNote', { content: text })
        setView('all')
        setActiveTag(null)
        setSelectedDay(null)
        setQueryInput('')
        setQuery('')
        setActiveNote(null)
        setReloadKey((value) => value + 1)
        showNotice(tr('composePosted'))
      } catch (failure) {
        const error = asApiError(failure)
        showNotice(`${tr('composeFailed')}：${translateError(tr, error)}`)
        throw error
      } finally {
        setComposerPending(false)
      }
    },
    [call, hasCall, showNotice, tr],
  )

  const switchInstance = React.useCallback(
    async (id) => {
      if (!hasCall) return
      setBusy(true)
      try {
        const reply = await call('switchInstance', { id })
        if (reply?.connection !== undefined) setConnection(reply.connection)
        setView('all')
        setActiveTag(null)
        setSelectedDay(null)
        setQueryInput('')
        setQuery('')
        setActiveNote(null)
        setSelected(new Set())
        setReloadKey((value) => value + 1)
      } catch (failure) {
        showNotice(translateError(tr, asApiError(failure)))
      } finally {
        setBusy(false)
      }
    },
    [call, hasCall, showNotice, tr],
  )

  /** 跑一批洞察任务（面板只处理 2 条，避免长时间占用）。 */
  const runInsights = React.useCallback(async () => {
    if (!hasCall) return
    setRunningInsights(true)
    try {
      const reply = await call('runPendingInsights', { limit: 2 })
      setInsights((previous) =>
        previous === null
          ? previous
          : { ...previous, count: Math.max(0, previous.count - (reply?.done ?? 0) - (reply?.failed ?? 0)) },
      )
      const failed = Array.isArray(reply?.results) ? reply.results.find((row) => row.status === 'failed') : undefined
      showNotice(
        tr('executorSummary', { done: reply?.done ?? 0, failed: reply?.failed ?? 0, skipped: reply?.skipped ?? 0 }) +
          (failed === undefined ? '' : ` · ${failed.error ?? ''}`),
      )
    } catch (failure) {
      showNotice(translateError(tr, asApiError(failure)))
    } finally {
      setRunningInsights(false)
    }
  }, [call, hasCall, showNotice, tr])

  const groups = groupByDay(notes)
  const activeMeta = VIEWS[view] ?? VIEWS.all
  const ActiveIcon = activeMeta.icon
  const related = activeNote === null ? [] : relatedByTag(activeNote, notes)
  const hasFilters = activeTag !== null || selectedDay !== null || query.trim() !== ''
  const syncLabel = tr('syncHint', {
    time: connection?.lastSyncAt ? formatDateTime(connection.lastSyncAt) : '—',
    count: stats?.counts?.total ?? notes.length,
  })

  const openNote = React.useCallback((note) => setActiveNote(note), [])
  const closeNote = React.useCallback(() => setActiveNote(null), [])
  const switchView = React.useCallback((next) => {
    setView(next)
    setActiveNote(null)
    setSelected(new Set())
  }, [])
  const selectTag = React.useCallback((tag) => {
    setActiveTag(tag)
    setActiveNote(null)
  }, [])
  const selectDay = React.useCallback((day) => {
    setSelectedDay(day)
    setActiveNote(null)
  }, [])

  return (
    <div className="dsh-flaremo-root" style={{ height: '100%', minHeight: 0 }}>
      {!loading && !connected && !addingInstance ? (
        <ConnectGuide
          tr={tr}
          loadError={loadError}
          onRetry={refresh}
          call={call}
          connection={connection}
          onConnected={() => setReloadKey((value) => value + 1)}
        />
      ) : (
        <div style={{ display: 'flex', flex: '1 1 auto', minHeight: 0, height: '100%' }}>
          {sidebarCollapsed ? null : (
            <Sidebar
              tr={tr}
              connection={connection}
              stats={stats}
              tags={tags}
              view={view}
              activeTag={activeTag}
              selectedDay={selectedDay}
              onToggleCollapse={() => setSidebarCollapsed(true)}
              onView={switchView}
              onTag={selectTag}
              onDay={selectDay}
              insights={insights}
              runningInsights={runningInsights}
              onRunInsights={runInsights}
              onSwitchInstance={switchInstance}
              onAddInstance={() => setAddingInstance(true)}
              busy={busy}
              syncLabel={syncLabel}
            />
          )}

          <main style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {addingInstance ? (
              <ConnectGuide
                tr={tr}
                loadError={loadError}
                onRetry={refresh}
                call={call}
                connection={{ connected: false }}
                adding
                onBack={() => setAddingInstance(false)}
                onConnected={() => {
                  setAddingInstance(false)
                  setReloadKey((value) => value + 1)
                }}
              />
            ) : (
            <>
            <header
              style={{
                flex: '0 0 auto',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                height: 56,
                padding: '0 20px',
                borderBottom: `1px solid ${C.border}`,
              }}
            >
              {sidebarCollapsed ? (
                <button
                  type="button"
                  className="fm-btn"
                  data-variant="ghost"
                  data-size="icon-sm"
                  onClick={() => setSidebarCollapsed(false)}
                  aria-label={tr('sidebarExpand')}
                  title={tr('sidebarExpand')}
                >
                  <IconPanelLeft size={14} />
                </button>
              ) : null}
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span aria-hidden="true" style={{ display: 'flex', color: C.textSecondary }}>
                  <ActiveIcon size={15} />
                </span>
                <span style={{ ...T.h2, color: C.text, whiteSpace: 'nowrap' }}>{tr(activeMeta.labelKey)}</span>
                {activeNote === null && loading === false ? (
                  <span className="fm-badge" data-tone="neutral">
                    {tr('noteCount', { count: notes.length })}
                  </span>
                ) : null}
              </span>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', minWidth: 0 }}>
                {activeNote === null ? (
                  <label style={{ position: 'relative', display: 'flex', alignItems: 'center', width: 230 }}>
                    <span style={{ position: 'absolute', left: 9, display: 'flex', color: C.textSecondary, pointerEvents: 'none' }}>
                      <IconSearch size={14} />
                    </span>
                    <input
                      className="fm-input"
                      data-size="search"
                      type="text"
                      value={queryInput}
                      placeholder={tr('searchPlaceholder')}
                      aria-label={tr('searchPlaceholder')}
                      onChange={(event) => setQueryInput(event.target.value)}
                      style={{ paddingLeft: 30 }}
                    />
                  </label>
                ) : null}
                <button
                  type="button"
                  className="fm-btn"
                  data-variant="outline"
                  data-size="icon-sm"
                  onClick={refresh}
                  title={tr('refresh')}
                  aria-label={tr('refresh')}
                >
                  <IconRefresh size={14} />
                </button>
              </div>
            </header>

            <div className="fm-scroll" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
              <div
                style={{
                  width: '100%',
                  maxWidth: 680,
                  margin: '0 auto',
                  padding: '20px 24px 48px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                {activeNote !== null ? (
                  <NoteDetail
                    tr={tr}
                    note={activeNote}
                    related={related}
                    selected={selected.has(activeNote.id)}
                    onBack={closeNote}
                    onCopy={copyNote}
                    onToggle={toggleSelected}
                    onOpen={openNote}
                    openConversation={openConversation}
                  />
                ) : (
                  <>
                    <Composer tr={tr} disabled={!connected} pending={composerPending} onSubmit={createNote} />

                    {loadError !== null ? (
                      <div className="fm-alert" data-tone="danger">
                        {loadFailedText(tr, loadError)}
                      </div>
                    ) : null}

                    {hasFilters ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                        {query.trim() !== '' ? (
                          <button
                            type="button"
                            className="fm-pill"
                            data-active="true"
                            onClick={() => {
                              setQueryInput('')
                              setQuery('')
                            }}
                          >
                            {tr('filterQuery', { query: query.trim() })}
                          </button>
                        ) : null}
                        {selectedDay !== null ? (
                          <button type="button" className="fm-pill" data-active="true" onClick={() => setSelectedDay(null)}>
                            {tr('filterDay', { day: selectedDay })}
                          </button>
                        ) : null}
                        {activeTag !== null ? (
                          <button type="button" className="fm-pill" data-active="true" onClick={() => setActiveTag(null)}>
                            {tr('filterTag', { tag: activeTag })}
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    {loading ? (
                      <TimelineSkeleton />
                    ) : groups.length === 0 ? (
                      <div className="fm-empty" style={{ paddingTop: 32 }}>
                        <div className="fm-empty-icon">
                          <ActiveIcon size={18} />
                        </div>
                        <div className="fm-empty-title">{tr(activeMeta.emptyKey)}</div>
                        <p className="fm-empty-desc" style={{ margin: 0 }}>
                          {tr('timelineEmptyHint')}
                        </p>
                      </div>
                    ) : (
                      groups.map((group) => (
                        <section key={group.day} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              ...T.micro,
                              fontWeight: 600,
                              color: C.textSecondary,
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {group.day}
                            <span style={{ fontWeight: 400 }}>{group.rows.length}</span>
                          </div>
                          {group.rows.map((note) => (
                            <MemoCard
                              key={note.id}
                              note={note}
                              tr={tr}
                              selected={selected.has(note.id)}
                              onOpen={openNote}
                              onToggle={toggleSelected}
                              onCopy={copyNote}
                            />
                          ))}
                        </section>
                      ))
                    )}
                  </>
                )}
              </div>
            </div>
            </>
            )}
          </main>
        </div>
      )}

      {notice !== null ? (
        <div
          key={notice.seq}
          role="status"
          className="fm-fade-in"
          style={{
            position: 'absolute',
            right: 20,
            bottom: 20,
            zIndex: 40,
            maxWidth: 380,
            padding: '10px 12px',
            border: `1px solid ${C.border}`,
            borderRadius: C.radiusLg,
            background: C.bgBase,
            color: C.text,
            boxShadow: C.shadowProminent,
            ...T.caption,
          }}
        >
          {notice.text}
        </div>
      ) : null}
    </div>
  )
}

/** 读取失败的完整文案（带错误码翻译）。 */
function loadFailedText(tr, error) {
  return `${tr('loadFailed')}：${translateError(tr, error)}`
}
