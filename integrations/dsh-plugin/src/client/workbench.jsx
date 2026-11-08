/**
 * FlareMo 工作台（全局面板的组件）。
 *
 * 数据只有一条来源：已连接实例时用 `call('listNotes')` / `call('searchNotes')`
 * 从 host 的 typert RPC 拿真实笔记（host 持有 token，client 只拿窄视图）。
 * 未连接 / RPC 不可用时**不造假数据**：整块换成连接引导（`ConnectGuide`）。
 *
 * 视觉与 FlareMo 网页端同一套 Ember 设计语言（token / 字号阶梯 / 组件造型见
 * theme.js 与 styles.js）：暖白纸面 + 墨色文字 + 火焰色只留给唯一主 CTA；
 * 形状靠 class（fm-btn / fm-card / fm-note / fm-badge …），版面走内联 style。
 */

import React from 'react'

import { asApiError } from './api.js'
import { ConnectForm, PairingCard, useConnectFlow } from './connect.jsx'
import { createTranslator, translateError } from './i18n.js'
import {
  formatClock,
  formatDateTime,
  groupByDay,
  matchesQuery,
  noteBlocks,
  noteCharCount,
  noteText,
  relatedByTag,
} from './notes.js'
import { C, S, T } from './styles.js'
import {
  IconCheck,
  IconChevronRight,
  IconClock,
  IconCopy,
  IconQuote,
  IconRefresh,
  IconSearch,
  IconSparkle,
} from './icons.jsx'

/** 正文块渲染：输出语义标签，排版由 .fm-prose 统一（theme.js）。 */
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

/** 时间线记录行：左侧正文是 <button>；右上角选择框是兄弟 <button>。 */
export function NoteCard({ note, active, selected, tr, onOpen, onToggle }) {
  return (
    <div className="fm-note-row" style={{ marginBottom: 2 }}>
      <button
        type="button"
        className="fm-note"
        data-active={active ? 'true' : 'false'}
        aria-current={active ? 'true' : undefined}
        onClick={() => onOpen(note.id)}
      >
        <span
          style={{
            display: 'block',
            paddingRight: 24,
            ...T.h3,
            color: C.text,
            ...S.clamp2,
          }}
        >
          {note.title}
        </span>
        <span
          style={{
            display: 'block',
            marginTop: 3,
            ...T.caption,
            color: C.textSecondary,
            ...S.clamp2,
          }}
        >
          {note.excerpt}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
          {(note.tags ?? []).slice(0, 3).map((tag) => (
            <span key={tag} className="fm-chip">
              #{tag}
            </span>
          ))}
          <span
            style={{
              marginLeft: 'auto',
              ...T.micro,
              color: C.textSecondary,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatClock(note.updatedAt)}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="fm-note-check"
        data-selected={selected ? 'true' : 'false'}
        aria-pressed={selected}
        aria-label={selected ? tr('removeSelection') : tr('addSelection')}
        title={selected ? tr('removeSelection') : tr('addSelection')}
        onClick={() => onToggle(note.id)}
      >
        {selected ? <IconCheck size={11} /> : null}
      </button>
    </div>
  )
}

/** 右栏的一小块：小标题 + 内容（Ember 栏目标签 12px/600）。 */
function InsightSection({ title, children }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <h4 style={{ margin: '0 0 8px', ...T.section, color: C.textSecondary }}>{title}</h4>
      {children}
    </section>
  )
}

/** 右栏的只读信息行；value 为空时只渲染标签（「字数 142」这类统计行）。 */
function InfoLine({ label, value }) {
  if (label === null || label === undefined || label === '') return null
  const hasValue = value !== null && value !== undefined && value !== ''
  return (
    <div style={{ ...S.infoRow, marginBottom: 4 }}>
      <span style={S.infoLabel}>{label}</span>
      {hasValue ? <span style={S.infoValue}>{value}</span> : null}
    </div>
  )
}

/**
 * 未连接时的连接引导。**不渲染任何示例数据**，也不把用户赶去设置页：
 * 实例地址 + 配对码 + 轮询全部长在面板里（与设置页共用 connect.jsx 的状态机）。
 *
 * 造型是 Ember 的「空状态 → 一张卡片里的表单」：40px 小纸片图标、15px 标题、
 * 正文 14px muted；错误用 alert，表单/配对卡由 connect.jsx 自己渲染。
 *
 * @param {{ tr: (key: string, vars?: object) => string, loadError: object | null,
 *   onRetry: () => void, call?: (method: string, args?: object) => Promise<object>,
 *   connection?: object | null, onConnected?: () => void }} props
 * @returns {React.ReactElement} the connection guide.
 */
export function ConnectGuide({ tr, loadError, onRetry, call, connection, onConnected }) {
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
        <div className="fm-empty" style={{ padding: '0 0 20px' }}>
          <div className="fm-empty-icon">
            <IconSparkle size={18} />
          </div>
          <div className="fm-empty-title">{tr('guideTitle')}</div>
          <p className="fm-empty-desc" style={{ margin: 0 }}>
            {tr('guideBody')}
          </p>
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
 * 工作台主组件。props 来自 slot：标准 props（t）+ entry.jsx 的 inject face。
 * @param {{ t?: (key: string) => string, call?: (method: string, args?: object) => Promise<object>,
 *   openConversation?: () => void }} props
 * @returns {React.ReactElement} the workbench panel.
 */
export function Workbench({ t, call, openConversation }) {
  const tr = React.useMemo(() => createTranslator(t), [t])
  const hasCall = typeof call === 'function'

  const [reloadKey, setReloadKey] = React.useState(0)
  /** @type {[object | null, Function]} connection view from the host */
  const [connection, setConnection] = React.useState(null)
  /** @type {[object[] | null, Function]} notes (null = loading) */
  const [notes, setNotes] = React.useState(null)
  /** 是否已连上实例并加载了真实数据；false 时整块只显示连接引导。 */
  const [connected, setConnected] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState(null)
  const [query, setQuery] = React.useState('')
  const [remoteResults, setRemoteResults] = React.useState(null)
  const [searching, setSearching] = React.useState(false)
  const [searchError, setSearchError] = React.useState(null)
  /** FlareMo 上 pending 的洞察队列（执行器入口，只有已连接时才有）。 */
  const [pendingInsights, setPendingInsights] = React.useState(null)
  const [runningInsights, setRunningInsights] = React.useState(false)
  const [activeId, setActiveId] = React.useState(null)
  const [selected, setSelected] = React.useState(() => new Set())
  const [insightOpen, setInsightOpen] = React.useState(
    () => typeof window === 'undefined' || window.innerWidth >= 1120,
  )
  const [notice, setNotice] = React.useState(null)

  // 提示条 3.2s 自动消失；同文案重复触发也要重新计时，所以带 seq。
  React.useEffect(() => {
    if (notice === null) return undefined
    const timer = setTimeout(() => setNotice(null), 3200)
    return () => clearTimeout(timer)
  }, [notice])

  const showNotice = React.useCallback((text) => {
    setNotice((previous) => ({ text, seq: (previous?.seq ?? 0) + 1 }))
  }, [])

  // 首次加载 / 刷新：连接状态 → 真实笔记；未连接或失败 → 连接引导（不放假数据）
  React.useEffect(() => {
    let live = true
    setLoading(true)
    setLoadError(null)
    setActiveId(null)
    ;(async () => {
      let view = null
      try {
        if (hasCall) {
          const reply = await call('connectionStatus')
          view = reply?.connection ?? null
        }
        if (!live) return
        setConnection(view)
        if (view?.connected === true) {
          const listed = await call('listNotes', { pageSize: 50 })
          if (!live) return
          setNotes(Array.isArray(listed?.notes) ? listed.notes : [])
          setConnected(true)
          try {
            const queue = await call('listPendingInsights', { limit: 50 })
            if (!live) return
            setPendingInsights({
              count: Number(queue?.count) > 0 ? Number(queue.count) : 0,
              model: queue?.model ?? null,
            })
          } catch {
            if (live) setPendingInsights(null)
          }
        } else {
          setNotes([])
          setConnected(false)
        }
      } catch (failure) {
        if (!live) return
        setLoadError(asApiError(failure))
        setConnection(view)
        setNotes([])
        setConnected(false)
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [call, hasCall, reloadKey])

  // 服务端搜索：已连接 + 关键词 >= 2 才发，350ms 防抖
  React.useEffect(() => {
    const text = query.trim()
    if (!connected || !hasCall || text.length < 2) {
      setRemoteResults(null)
      setSearching(false)
      setSearchError(null)
      return undefined
    }
    let live = true
    const timer = setTimeout(() => {
      setSearching(true)
      setSearchError(null)
      void (async () => {
        try {
          const reply = await call('searchNotes', { query: text, pageSize: 50 })
          if (live) setRemoteResults(Array.isArray(reply?.notes) ? reply.notes : [])
        } catch (failure) {
          if (!live) return
          setSearchError(asApiError(failure))
          setRemoteResults([])
        } finally {
          if (live) setSearching(false)
        }
      })()
    }, 350)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, connected, call, hasCall])

  const baseNotes = Array.isArray(notes) ? notes : []
  const trimmed = query.trim()
  const localFiltered = trimmed === '' ? baseNotes : baseNotes.filter((note) => matchesQuery(note, trimmed))
  const shownNotes = connected && trimmed !== '' ? (remoteResults ?? localFiltered) : localFiltered
  const groups = groupByDay(shownNotes)
  const active =
    (activeId === null ? null : shownNotes.find((note) => note.id === activeId) ?? baseNotes.find((note) => note.id === activeId)) ??
    shownNotes[0] ??
    null
  const activeBlocks = noteBlocks(active)
  const isRemote = connected
  const remoteRelated = active !== null ? relatedByTag(active, baseNotes) : []

  const openNote = React.useCallback((id) => setActiveId(id), [])

  const toggleSelected = React.useCallback((id) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const askAi = React.useCallback(() => {
    showNotice(tr('noticeAsk', { count: selected.size }))
  }, [selected.size, showNotice, tr])

  const refresh = React.useCallback(() => {
    setReloadKey((value) => value + 1)
    setRemoteResults(null)
    showNotice(tr('noticeRefresh'))
  }, [showNotice, tr])

  const copyActive = React.useCallback(async () => {
    if (active === null) return
    const text = typeof active.content === 'string' ? active.content : noteText(active)
    try {
      if (typeof navigator === 'undefined' || navigator.clipboard === undefined) throw new Error('no clipboard')
      await navigator.clipboard.writeText(text)
      showNotice(tr('noticeCopy'))
    } catch {
      showNotice(tr('noticeCopyFailed'))
    }
  }, [active, showNotice, tr])

  /** 跑一批洞察任务（工作台只处理 2 条，避免长时间占用面板）。 */
  const runInsights = React.useCallback(async () => {
    setRunningInsights(true)
    try {
      const reply = await call('runPendingInsights', { limit: 2 })
      setPendingInsights((previous) => (previous === null ? previous : { ...previous, count: Math.max(0, previous.count - (reply?.done ?? 0) - (reply?.failed ?? 0)) }))
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
  }, [call, showNotice, tr])

  const askThisNote = React.useCallback(() => {
    if (active === null) return
    const next = new Set(selected)
    next.add(active.id)
    setSelected(next)
    setInsightOpen(true)
    showNotice(tr('noticeAsk', { count: next.size }))
  }, [active, selected, showNotice, tr])

  const syncLabel = tr('syncHint', {
    time: connection?.lastSyncAt ? formatDateTime(connection.lastSyncAt) : '—',
    count: baseNotes.length,
  })

  return (
    <div className="dsh-flaremo-root" style={{ height: '100%', minHeight: 0 }}>
      {/* ── 顶栏（h-14 工具栏：墨色标题图标 + 标题 + 搜索 + 唯一火焰 CTA） ── */}
      <header
        className="dsh-flaremo-head"
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 20px',
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              flex: 'none',
              border: `1px solid ${C.border}`,
              borderRadius: C.radiusLg,
              background: C.bgBase,
              color: C.textSecondary,
              boxShadow: C.shadowSoft,
            }}
          >
            <IconSparkle size={16} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...T.h3, fontSize: 15, color: C.text, whiteSpace: 'nowrap' }}>{tr('title')}</div>
            <div
              style={{
                ...T.micro,
                color: C.textSecondary,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {connection?.instanceUrl ?? tr('subtitle')}
            </div>
          </div>
          <span className="fm-badge" data-tone={isRemote ? 'success' : 'neutral'}>
            {isRemote ? tr('badgeLive') : tr('badgeOffline')}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginLeft: 'auto',
            minWidth: 0,
          }}
        >
          {isRemote ? (
            <>
              <label style={{ position: 'relative', display: 'flex', alignItems: 'center', width: 240 }}>
                <span
                  style={{
                    position: 'absolute',
                    left: 9,
                    display: 'flex',
                    color: C.textSecondary,
                    pointerEvents: 'none',
                  }}
                >
                  <IconSearch size={14} />
                </span>
                <input
                  className="fm-input"
                  data-size="search"
                  type="text"
                  value={query}
                  placeholder={tr('searchRemoteHint')}
                  aria-label={tr('searchPlaceholder')}
                  onChange={(event) => setQuery(event.target.value)}
                  style={{ paddingLeft: 30 }}
                />
              </label>
              {selected.size > 0 ? (
                <span className="fm-badge" data-tone="brand">
                  {tr('selected', { count: selected.size })}
                </span>
              ) : null}
              <button
                type="button"
                className="fm-btn"
                data-variant={selected.size > 0 ? 'brand' : 'outline'}
                data-size="sm"
                disabled={selected.size === 0}
                onClick={askAi}
              >
                <IconSparkle size={13} />
                {selected.size > 0 ? `${tr('askAi')} (${selected.size})` : tr('askAi')}
              </button>
            </>
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

      {/* ── 主体：已连接（或首帧还在读状态）走三栏；未连接只给连接引导 ──── */}
      {!loading && !isRemote ? (
        <ConnectGuide
          tr={tr}
          loadError={loadError}
          onRetry={refresh}
          call={call}
          connection={connection}
          onConnected={() => setReloadKey((value) => value + 1)}
        />
      ) : (
        <div style={{ display: 'flex', flex: '1 1 auto', minHeight: 0 }}>
          {/* 左：时间线 */}
          <aside
            style={{
              flex: '0 0 300px',
              width: 300,
              minWidth: 240,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              borderRight: `1px solid ${C.border}`,
              background: C.page,
            }}
          >
            <div
              style={{
                flex: '0 0 auto',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '12px 16px 8px',
                ...T.section,
                color: C.textSecondary,
              }}
            >
              <IconClock size={13} />
              {tr('timeline')}
              <span style={{ marginLeft: 'auto', ...T.micro, fontWeight: 400, color: C.textSecondary }}>
                {tr('noteCount', { count: shownNotes.length })}
              </span>
            </div>
            <div className="fm-scroll" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '0 8px 12px' }}>
              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 6px' }}>
                  {[0, 1, 2, 3].map((row) => (
                    <div key={row} style={{ padding: '10px 8px', borderRadius: C.radiusXl, border: `1px solid ${C.border}` }}>
                      <div className="fm-skeleton" style={{ width: '72%', height: 12 }} />
                      <div className="fm-skeleton" style={{ width: '94%', height: 10, marginTop: 8 }} />
                      <div className="fm-skeleton" style={{ width: '44%', height: 10, marginTop: 6 }} />
                    </div>
                  ))}
                </div>
              ) : groups.length === 0 ? (
                <div className="fm-empty" style={{ paddingTop: 32 }}>
                  <div className="fm-empty-icon">
                    <IconClock size={18} />
                  </div>
                  <div className="fm-empty-title">{tr('emptyRemote')}</div>
                </div>
              ) : (
                groups.map((group) => (
                  <section key={group.day}>
                    <div
                      style={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '10px 8px 6px',
                        background: C.page,
                        ...T.micro,
                        fontWeight: 600,
                        color: C.textSecondary,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {group.day}
                      <span style={{ fontWeight: 400, color: C.textSecondary }}>{group.rows.length}</span>
                    </div>
                    {group.rows.map((note) => (
                      <NoteCard
                        key={note.id}
                        note={note}
                        active={active?.id === note.id}
                        selected={selected.has(note.id)}
                        tr={tr}
                        onOpen={openNote}
                        onToggle={toggleSelected}
                      />
                    ))}
                  </section>
                ))
              )}
              {searching ? (
                <div style={{ padding: 8, textAlign: 'center', ...T.micro, color: C.textSecondary }}>
                  {tr('loadingNotes')}
                </div>
              ) : null}
              {searchError !== null ? (
                <div style={{ padding: 8, textAlign: 'center', ...T.micro, color: C.danger }}>
                  {translateError(tr, searchError)}
                </div>
              ) : null}
            </div>
          </aside>

          {/* 中：详情 */}
          <main style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {active === null ? (
              <div className="fm-empty" style={{ flex: '1 1 auto', paddingTop: 40 }}>
                <div className="fm-empty-icon">
                  <IconSearch size={18} />
                </div>
                <div className="fm-empty-title">{loading ? tr('loadingNotes') : tr('emptyRemote')}</div>
              </div>
            ) : (
              <>
                <div style={{ flex: '0 0 auto', padding: '20px 24px 14px', borderBottom: `1px solid ${C.border}` }}>
                  <h1 style={{ margin: 0, ...T.h1, color: C.text }}>{active.title}</h1>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                      marginTop: 8,
                      ...T.caption,
                      color: C.textSecondary,
                    }}
                  >
                    <span>{tr('noteUpdated', { time: formatDateTime(active.updatedAt) })}</span>
                    {active.source ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          {tr('noteSource')} {active.source}
                        </span>
                      </>
                    ) : null}
                    {(active.tags ?? []).map((tag) => (
                      <span key={tag} className="fm-chip">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div
                  className="fm-scroll"
                  style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '20px 24px 28px' }}
                >
                  {activeBlocks.length === 0 ? (
                    <p style={{ margin: 0, ...T.body, color: C.textSecondary }}>{tr('emptyRemote')}</p>
                  ) : (
                    <div className="fm-prose" style={{ maxWidth: 720 }}>
                      {activeBlocks.map((block, index) => (
                        <BlockView key={index} block={block} />
                      ))}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    flex: '0 0 auto',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 24px',
                    borderTop: `1px solid ${C.border}`,
                  }}
                >
                  <button type="button" className="fm-btn" data-variant="ghost" data-size="sm" onClick={copyActive}>
                    <IconCopy size={14} />
                    {tr('copyContent')}
                  </button>
                  <button
                    type="button"
                    className="fm-btn"
                    data-variant="ghost"
                    data-size="sm"
                    aria-pressed={selected.has(active.id)}
                    onClick={() => toggleSelected(active.id)}
                  >
                    <IconCheck size={14} />
                    {selected.has(active.id) ? tr('removeSelection') : tr('addSelection')}
                  </button>
                  {typeof openConversation === 'function' ? (
                    <button
                      type="button"
                      className="fm-btn"
                      data-variant="outline"
                      data-size="sm"
                      onClick={openConversation}
                      style={{ marginLeft: 'auto' }}
                    >
                      {tr('backToConversation')}
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </main>

          {/* 右：洞察 / 笔记信息 */}
          {insightOpen ? (
            <aside
              style={{
                flex: '0 0 340px',
                width: 340,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                borderLeft: `1px solid ${C.border}`,
                background: C.page,
              }}
            >
              <div
                style={{
                  flex: '0 0 auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '12px 12px 8px 16px',
                  ...T.section,
                  color: C.textSecondary,
                }}
              >
                <IconSparkle size={13} />
                {tr('noteInfo')}
                <button
                  type="button"
                  className="fm-btn"
                  data-variant="ghost"
                  data-size="icon-sm"
                  onClick={() => setInsightOpen(false)}
                  title={tr('collapse')}
                  aria-label={tr('collapse')}
                  style={{ marginLeft: 'auto' }}
                >
                  <IconChevronRight size={14} />
                </button>
              </div>

              {active === null ? (
                <div style={{ padding: '24px 16px', ...T.body, color: C.textSecondary }}>{tr('emptyInsight')}</div>
              ) : (
                <>
                  <div
                    className="fm-scroll"
                    style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '4px 16px 12px' }}
                  >
                    <div className="fm-card" data-size="sm" style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ ...T.section, color: C.text }}>{tr('executorQueue')}</span>
                        <span
                          className="fm-badge"
                          data-tone={(pendingInsights?.count ?? 0) > 0 ? 'brand' : 'neutral'}
                        >
                          {pendingInsights === null
                            ? '—'
                            : (pendingInsights.count ?? 0) > 0
                              ? tr('executorPending', { count: pendingInsights.count })
                              : tr('executorNone')}
                        </span>
                        <button
                          type="button"
                          className="fm-btn"
                          data-variant="outline"
                          data-size="xs"
                          onClick={runInsights}
                          disabled={runningInsights || (pendingInsights?.count ?? 0) === 0}
                          style={{ marginLeft: 'auto' }}
                        >
                          {runningInsights ? tr('executorRunning') : tr('executorRunShort')}
                        </button>
                      </div>
                      {pendingInsights?.model?.available === false ? (
                        <div className="fm-alert" data-tone="warning" style={{ padding: '6px 8px', fontSize: 12 }}>
                          {tr('executorModelNone', { reason: pendingInsights.model.reason ?? '未配置' })}
                        </div>
                      ) : null}
                    </div>

                    <div className="fm-card" data-size="sm" style={{ marginBottom: 12 }}>
                      <InfoLine label={tr('noteWords', { count: noteCharCount(active) })} value={null} />
                      <InfoLine label={tr('noteVisibility')} value={active.visibility} />
                      <InfoLine label={tr('noteSource')} value={active.source} />
                      <InfoLine label={tr('noteCreator')} value={active.creatorName} />
                      {(active.commentCount ?? 0) > 0 ? (
                        <InfoLine label={tr('noteComments', { count: active.commentCount })} value={null} />
                      ) : null}
                    </div>

                    <InsightSection title={tr('noteTags', { count: (active.tags ?? []).length })}>
                      {(active.tags ?? []).length === 0 ? (
                        <div style={{ ...T.caption, color: C.textSecondary }}>—</div>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {(active.tags ?? []).map((tag) => (
                            <span key={tag} className="fm-chip">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </InsightSection>

                    <InsightSection title={tr('relatedByTag')}>
                      {remoteRelated.length === 0 ? (
                        <div style={{ ...T.caption, color: C.textSecondary }}>—</div>
                      ) : (
                        remoteRelated.map((row) => (
                          <button
                            key={row.id}
                            type="button"
                            className="fm-btn"
                            data-variant="ghost"
                            data-size="sm"
                            onClick={() => openNote(row.id)}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'flex-start',
                              gap: 2,
                              width: '100%',
                              height: 'auto',
                              padding: '6px 8px',
                              textAlign: 'left',
                              fontWeight: 400,
                            }}
                          >
                            <span style={{ ...T.caption, color: C.text }}>{row.title}</span>
                            <span style={{ ...T.micro, color: C.textSecondary }}>{row.day}</span>
                          </button>
                        ))
                      )}
                    </InsightSection>

                    <p style={{ margin: 0, ...T.micro, color: C.textSecondary, lineHeight: '17px' }}>
                      {tr('insightComingSoon')}
                    </p>
                  </div>

                  <div
                    style={{
                      flex: '0 0 auto',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 16px',
                      borderTop: `1px solid ${C.border}`,
                    }}
                  >
                    <button
                      type="button"
                      className="fm-btn"
                      data-variant="ghost"
                      data-size="sm"
                      onClick={askThisNote}
                    >
                      <IconSparkle size={14} />
                      {tr('askThis')}
                    </button>
                    <button
                      type="button"
                      className="fm-btn"
                      data-variant="ghost"
                      data-size="sm"
                      onClick={() => showNotice(tr('noticeQuote'))}
                      style={{ marginLeft: 'auto' }}
                    >
                      <IconQuote size={14} />
                      {tr('quoteToChat')}
                    </button>
                  </div>
                </>
              )}
            </aside>
          ) : (
            <div
              style={{
                flex: '0 0 auto',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'center',
                paddingTop: 10,
                width: 36,
                borderLeft: `1px solid ${C.border}`,
                background: C.page,
              }}
            >
              <button
                type="button"
                className="fm-btn"
                data-variant="ghost"
                data-size="icon-sm"
                onClick={() => setInsightOpen(true)}
                title={tr('expand')}
                aria-label={tr('expand')}
              >
                <IconSparkle size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── 状态条 ───────────────────────────────────────────────────── */}
      <footer
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 20px',
          borderTop: `1px solid ${C.border}`,
          ...T.micro,
          color: C.textSecondary,
          lineHeight: '16px',
        }}
      >
        <span
          style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              flex: 'none',
              borderRadius: 999,
              background: isRemote ? C.success : C.textSecondary,
            }}
          />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {isRemote ? syncLabel : tr('footerDisconnected')}
          </span>
        </span>
        <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {isRemote ? (connection?.instanceUrl ?? '') : null}
        </span>
      </footer>

      {/* ── 临时提示（Ember：卡面小 toast，不是跑马灯）────────────────── */}
      {notice !== null ? (
        <div
          key={notice.seq}
          role="status"
          className="fm-fade-in"
          style={{
            position: 'absolute',
            right: 20,
            bottom: 48,
            zIndex: 10,
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
