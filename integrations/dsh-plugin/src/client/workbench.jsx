/**
 * FlareMo 工作台（全局面板的面板组件）。
 *
 * 数据只有一条来源：已连接 FlareMo 实例时用 `call('listNotes')` / `call('searchNotes')`
 * 从 host 的 typert RPC 拿真实笔记（host 持有 token，client 只拿窄视图）。
 * 未连接 / RPC 不可用时**不造假数据**：整块换成连接引导（`ConnectGuide`），
 * 告诉用户去哪配对、怎么配对，并给一个重新检查连接的入口。
 *
 * 版面：顶栏（标题 + 搜索 + 问 AI + 刷新）｜ 三栏（时间线 / 详情 / 洞察）｜ 状态条。
 * 颜色与圆角只走 --dsw-* token；内联表达不了的伪类在 styles.js 里。
 */

import React from 'react'

import { asApiError } from './api.js'
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
import { C, S } from './styles.js'
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

/** 顶栏搜索框。 */
const INPUT_STYLE = {
  width: '100%',
  height: 30,
  padding: '0 10px 0 28px',
  border: `1px solid ${C.border}`,
  borderRadius: C.radiusMd,
  background: C.bgBase,
  color: C.text,
  fontFamily: 'inherit',
  fontSize: 12.5,
  outline: 'none',
}

/** 两行截断（列表卡片摘要）。 */
const CLAMP_2 = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
}

/** 正文块渲染：段落 / 标题 / 引用 / 列表 / 代码 / 分隔线。导出给测试直接渲染。 */
export function BlockView({ block }) {
  switch (block.type) {
    case 'p':
      return (
        <p
          style={{
            margin: '0 0 14px',
            fontSize: 13.5,
            lineHeight: '23px',
            color: C.text,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          {block.text}
        </p>
      )
    case 'heading': {
      const level = Number(block.level) > 0 ? Number(block.level) : 3
      const size = level <= 1 ? 17 : level === 2 ? 15 : 13.5
      return (
        <h3
          style={{
            margin: level <= 2 ? '20px 0 8px' : '14px 0 6px',
            fontSize: size,
            lineHeight: 1.4,
            fontWeight: 600,
            color: C.text,
          }}
        >
          {block.text}
        </h3>
      )
    }
    case 'quote':
      return (
        <blockquote
          style={{
            margin: '0 0 16px',
            padding: '8px 12px',
            borderLeft: `2px solid ${C.accent}`,
            borderRadius: `0 ${C.radiusSm} ${C.radiusSm} 0`,
            background: C.bgLayer1,
            color: C.textSecondary,
            fontSize: 13,
            lineHeight: '21px',
            whiteSpace: 'pre-wrap',
          }}
        >
          {block.text}
        </blockquote>
      )
    case 'list': {
      const List = block.ordered === true ? 'ol' : 'ul'
      return (
        <List
          style={{
            margin: '0 0 16px',
            paddingLeft: block.ordered === true ? 22 : 18,
            color: C.text,
            fontSize: 13.5,
            lineHeight: '23px',
          }}
        >
          {(block.items ?? []).map((item, index) => (
            <li key={index} style={{ marginBottom: 4 }}>
              {item}
            </li>
          ))}
        </List>
      )
    }
    case 'code':
      return (
        <pre
          className="dsh-flaremo-scroll"
          style={{
            margin: '0 0 16px',
            padding: '10px 12px',
            border: `1px solid ${C.borderSoft}`,
            borderRadius: C.radiusMd,
            background: C.bgLayer1,
            color: C.textSecondary,
            fontFamily: C.mono,
            fontSize: 12,
            lineHeight: '19px',
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          <code>{block.text}</code>
        </pre>
      )
    case 'divider':
      return <hr style={{ margin: '18px 0', border: 'none', borderTop: `1px solid ${C.borderSoft}` }} />
    default:
      return null
  }
}

/** 左栏卡片：正文区是 <button>（可键盘打开），右上角复选框单独一个 <button>。 */
export function NoteCard({ note, active, selected, tr, onOpen, onToggle }) {
  return (
    <div
      className="dsh-flaremo-card"
      aria-current={active ? 'true' : undefined}
      style={{
        position: 'relative',
        marginBottom: 2,
        border: `1px solid ${active ? C.border : 'transparent'}`,
        borderRadius: C.radiusMd,
        background: active ? C.bgBase : 'transparent',
        boxShadow: active ? C.shadowSoft : 'none',
      }}
    >
      <button
        type="button"
        onClick={() => onOpen(note.id)}
        style={{
          display: 'block',
          width: '100%',
          padding: '8px 10px 8px 11px',
          border: 'none',
          borderRadius: C.radiusMd,
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            display: 'block',
            fontSize: 13,
            lineHeight: '19px',
            fontWeight: 500,
            color: C.text,
            paddingRight: 18,
            ...CLAMP_2,
          }}
        >
          {note.title}
        </span>
        <span
          style={{
            display: 'block',
            marginTop: 2,
            fontSize: 12,
            lineHeight: '18px',
            color: C.textSecondary,
            ...CLAMP_2,
          }}
        >
          {note.excerpt}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
          {(note.tags ?? []).slice(0, 3).map((tag) => (
            <span key={tag} style={{ ...S.chip, height: 18, lineHeight: '18px', fontSize: 10.5 }}>
              #{tag}
            </span>
          ))}
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              color: C.caption,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatClock(note.updatedAt)}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="dsh-flaremo-check"
        data-selected={selected ? 'true' : 'false'}
        aria-pressed={selected}
        aria-label={selected ? tr('removeSelection') : tr('addSelection')}
        title={selected ? tr('removeSelection') : tr('addSelection')}
        onClick={() => onToggle(note.id)}
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          padding: 0,
          border: `1px solid ${selected ? C.accent : C.border}`,
          borderRadius: 5,
          background: selected ? C.accent : C.bgBase,
          color: selected ? C.onAccent : 'transparent',
          cursor: 'pointer',
        }}
      >
        <IconCheck size={11} />
      </button>
    </div>
  )
}

/** 右栏的一小块：小标题 + 内容。 */
function InsightSection({ title, children }) {
  return (
    <section style={{ marginBottom: 16 }}>
      <h4
        style={{
          margin: '0 0 6px',
          fontSize: 11,
          lineHeight: '16px',
          fontWeight: 600,
          letterSpacing: '0.02em',
          color: C.textTertiary,
        }}
      >
        {title}
      </h4>
      {children}
    </section>
  )
}

/** 右栏的只读信息行。 */
function InfoLine({ label, value }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: '18px', marginBottom: 3 }}>
      <span style={{ flex: '0 0 68px', color: C.textTertiary, fontSize: 11 }}>{label}</span>
      <span style={{ color: C.text, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  )
}

/**
 * 未连接时的连接引导。**不渲染任何示例数据**：只告诉用户去哪配对、怎么配对，
 * 以及配对批准后回来点一下「重新检查连接」。
 * @param {{ tr: (key: string, vars?: object) => string, loadError: object | null,
 *   onRetry: () => void }} props
 * @returns {React.ReactElement} the connection guide.
 */
export function ConnectGuide({ tr, loadError, onRetry }) {
  return (
    <div
      className="dsh-flaremo-guide"
      style={{
        flex: '1 1 auto',
        minHeight: 0,
        overflow: 'auto',
        display: 'flex',
        justifyContent: 'center',
        padding: '52px 24px 40px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: C.radiusMd,
              background: C.accentSoft,
              color: C.accent,
              flex: 'none',
            }}
          >
            <IconSparkle size={17} />
          </span>
          <h2 style={{ margin: 0, fontSize: 17, lineHeight: '24px', fontWeight: 600, color: C.text }}>
            {tr('guideTitle')}
          </h2>
        </div>
        <p style={{ margin: '0 0 18px', fontSize: 12.5, lineHeight: '20px', color: C.textSecondary }}>
          {tr('guideBody')}
        </p>
        {loadError !== null && loadError !== undefined ? (
          <div
            style={{
              ...S.card,
              padding: '10px 12px',
              marginBottom: 18,
              fontSize: 12,
              lineHeight: '18px',
              color: C.textSecondary,
            }}
          >
            <span style={{ color: C.danger }}>{tr('loadFailed')}</span>
            {'：'}
            {translateError(tr, loadError)}
          </div>
        ) : null}
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3, 4].map((step) => (
            <li key={step} style={{ display: 'flex', gap: 10 }}>
              <span
                style={{
                  flex: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 20,
                  height: 20,
                  marginTop: 1,
                  borderRadius: 999,
                  background: C.accentSoft,
                  color: C.accent,
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {step}
              </span>
              <span style={{ fontSize: 12.5, lineHeight: '20px', color: C.text }}>{tr(`guideStep${step}`)}</span>
            </li>
          ))}
        </ol>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 24 }}>
          <button
            type="button"
            className="dsh-flaremo-btn dsh-flaremo-primary"
            onClick={onRetry}
            style={S.primaryButton}
          >
            <IconRefresh size={13} />
            {tr('guideRetry')}
          </button>
          <span style={{ fontSize: 11.5, lineHeight: '16px', color: C.caption }}>{tr('guideHint')}</span>
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
    <div
      className="dsh-flaremo-root"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: C.bgBase,
        color: C.text,
        fontFamily: C.font,
        fontSize: C.contentSize,
      }}
    >
      {/* ── 顶栏 ─────────────────────────────────────────────────────── */}
      <header
        className="dsh-flaremo-head"
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingRight: 20,
          paddingBottom: 10,
          paddingLeft: 20,
          borderBottom: `1px solid ${C.borderSoft}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: C.radiusMd,
              background: C.accentSoft,
              color: C.accent,
              flex: 'none',
            }}
          >
            <IconSparkle size={16} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, lineHeight: '18px', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {tr('title')}
            </div>
            <div style={{ fontSize: 11, lineHeight: '14px', color: C.caption, whiteSpace: 'nowrap' }}>
              {connection?.instanceUrl ?? tr('subtitle')}
            </div>
          </div>
          <span
            style={{
              ...S.chip,
              background: isRemote ? C.accentSoft : C.bgLayer2,
              color: isRemote ? C.accent : C.textSecondary,
            }}
          >
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
            flex: '0 1 460px',
            justifyContent: 'flex-end',
          }}
        >
          {isRemote ? (
            <>
              <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 120 }}>
                <span
                  style={{
                    position: 'absolute',
                    left: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    display: 'flex',
                    color: C.caption,
                    pointerEvents: 'none',
                  }}
                >
                  <IconSearch size={13} />
                </span>
                <input
                  className="dsh-flaremo-input"
                  type="text"
                  value={query}
                  placeholder={isRemote ? tr('searchRemoteHint') : tr('searchPlaceholder')}
                  aria-label={tr('searchPlaceholder')}
                  onChange={(event) => setQuery(event.target.value)}
                  style={INPUT_STYLE}
                />
              </div>
              {selected.size > 0 ? (
                <span style={{ ...S.chip, color: C.accent, background: C.accentSoft }}>
                  {tr('selected', { count: selected.size })}
                </span>
              ) : null}
              <button
                type="button"
                className="dsh-flaremo-btn dsh-flaremo-primary"
                disabled={selected.size === 0}
                onClick={askAi}
                style={S.primaryButton}
              >
                <IconSparkle size={13} />
                {selected.size > 0 ? `${tr('askAi')} (${selected.size})` : tr('askAi')}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="dsh-flaremo-btn"
            onClick={refresh}
            title={tr('refresh')}
            aria-label={tr('refresh')}
            style={{ ...S.iconButton, border: `1px solid ${C.border}` }}
          >
            <IconRefresh size={14} />
          </button>
        </div>
      </header>

      {/* ── 主体：已连接（或首帧还在读状态）走三栏；未连接只给连接引导 ──── */}
      {!loading && !isRemote ? (
        <ConnectGuide tr={tr} loadError={loadError} onRetry={refresh} />
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
            borderRight: `1px solid ${C.borderSoft}`,
            background: C.bgLayer1,
          }}
        >
          <div
            style={{
              flex: '0 0 auto',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 14px 6px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.02em',
              color: C.textTertiary,
            }}
          >
            <IconClock size={12} />
            {tr('timeline')}
            <span style={{ marginLeft: 'auto', fontWeight: 400, color: C.caption }}>
              {tr('noteCount', { count: shownNotes.length })}
            </span>
          </div>
          <div
            className="dsh-flaremo-scroll"
            style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '0 8px 12px' }}
          >
            {loading ? (
              <div style={{ padding: '24px 14px', textAlign: 'center', color: C.textTertiary, fontSize: 12 }}>
                {tr('loadingNotes')}
              </div>
            ) : groups.length === 0 ? (
              <div style={{ padding: '24px 14px', textAlign: 'center', color: C.textTertiary }}>
                <div style={{ fontSize: 13, marginBottom: 4 }}>{tr('emptyRemote')}</div>
                <div style={{ fontSize: 11.5, color: C.caption }}>{tr('emptyHint')}</div>
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
                      padding: '8px 6px 4px',
                      background: C.bgLayer1,
                      fontSize: 11,
                      fontWeight: 600,
                      color: C.textTertiary,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {group.day}
                    <span style={{ fontWeight: 400, color: C.caption }}>{group.rows.length}</span>
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
              <div style={{ padding: '8px 8px 2px', textAlign: 'center', fontSize: 11, color: C.caption }}>
                {tr('loadingNotes')}
              </div>
            ) : null}
            {searchError !== null ? (
              <div style={{ padding: '8px 8px 2px', textAlign: 'center', fontSize: 11, color: C.danger }}>
                {translateError(tr, searchError)}
              </div>
            ) : null}
          </div>
        </aside>

        {/* 中：详情 */}
        <main style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {active === null ? (
            <div
              style={{
                flex: '1 1 auto',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                color: C.textTertiary,
              }}
            >
              <IconSearch size={22} />
              <div style={{ fontSize: 13 }}>{loading ? tr('loadingNotes') : isRemote ? tr('emptyRemote') : tr('empty')}</div>
              {loading ? null : <div style={{ fontSize: 11.5, color: C.caption }}>{tr('emptyHint')}</div>}
            </div>
          ) : (
            <>
              <div style={{ flex: '0 0 auto', padding: '16px 24px 10px', borderBottom: `1px solid ${C.borderSoft}` }}>
                <h1 style={{ margin: 0, fontSize: 18, lineHeight: '25px', fontWeight: 600, color: C.text }}>
                  {active.title}
                </h1>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                    marginTop: 8,
                    fontSize: 11.5,
                    color: C.caption,
                  }}
                >
                  <span>
                    {tr('noteUpdated', { time: formatDateTime(active.updatedAt) })}
                  </span>
                  {active.source ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        {tr('noteSource')} {active.source}
                      </span>
                    </>
                  ) : null}
                  {(active.tags ?? []).map((tag) => (
                    <span key={tag} style={{ ...S.chip }}>
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
              <div
                className="dsh-flaremo-scroll"
                style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '16px 24px 24px' }}
              >
                {activeBlocks.length === 0 ? (
                  <p style={{ color: C.textTertiary, fontSize: 12.5 }}>{tr('empty')}</p>
                ) : (
                  activeBlocks.map((block, index) => <BlockView key={index} block={block} />)
                )}
              </div>
              <div
                style={{
                  flex: '0 0 auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 24px',
                  borderTop: `1px solid ${C.borderSoft}`,
                  background: C.bgBase,
                }}
              >
                <button type="button" className="dsh-flaremo-btn" onClick={copyActive} style={S.button}>
                  <IconCopy size={13} />
                  {tr('copyContent')}
                </button>
                <button
                  type="button"
                  className="dsh-flaremo-btn"
                  aria-pressed={selected.has(active.id)}
                  onClick={() => toggleSelected(active.id)}
                  style={S.button}
                >
                  <IconCheck size={13} />
                  {selected.has(active.id) ? tr('removeSelection') : tr('addSelection')}
                </button>
                {typeof openConversation === 'function' ? (
                  <button
                    type="button"
                    className="dsh-flaremo-btn"
                    onClick={openConversation}
                    style={{ ...S.button, marginLeft: 'auto' }}
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
              borderLeft: `1px solid ${C.borderSoft}`,
              background: C.bgLayer1,
            }}
          >
            <div
              style={{
                flex: '0 0 auto',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 10px 6px 14px',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.02em',
                color: C.textTertiary,
              }}
            >
              <IconSparkle size={12} />
              {tr('noteInfo')}
              <button
                type="button"
                className="dsh-flaremo-icon-btn"
                onClick={() => setInsightOpen(false)}
                title={tr('collapse')}
                aria-label={tr('collapse')}
                style={{ ...S.iconButton, width: 22, height: 22, marginLeft: 'auto' }}
              >
                <IconChevronRight size={13} />
              </button>
            </div>

            {active === null ? (
              <div style={{ padding: '24px 14px', fontSize: 12, color: C.textTertiary }}>{tr('emptyInsight')}</div>
            ) : (
              <>
                <div
                  className="dsh-flaremo-scroll"
                  style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '4px 14px 12px' }}
                >
                    <>
                      <div style={{ ...S.card, padding: '10px 12px', marginBottom: 16, background: C.bgBase }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: C.textTertiary }}>{tr('executorQueue')}</span>
                          <span
                            style={{
                              ...S.chip,
                              height: 17,
                              lineHeight: '17px',
                              fontSize: 10,
                              background: (pendingInsights?.count ?? 0) > 0 ? C.accentSoft : C.bgLayer2,
                              color: (pendingInsights?.count ?? 0) > 0 ? C.accent : C.textSecondary,
                            }}
                          >
                            {pendingInsights === null
                              ? '—'
                              : (pendingInsights.count ?? 0) > 0
                                ? tr('executorPending', { count: pendingInsights.count })
                                : tr('executorNone')}
                          </span>
                          <button
                            type="button"
                            className="dsh-flaremo-btn"
                            onClick={runInsights}
                            disabled={runningInsights || (pendingInsights?.count ?? 0) === 0}
                            style={{ ...S.button, marginLeft: 'auto', height: 24, padding: '0 8px', fontSize: 11.5 }}
                          >
                            {runningInsights ? tr('executorRunning') : tr('executorRunShort')}
                          </button>
                        </div>
                        {pendingInsights?.model?.available === false ? (
                          <div style={{ fontSize: 11, lineHeight: '16px', color: C.warn }}>
                            {tr('executorModelNone', { reason: pendingInsights.model.reason ?? '未配置' })}
                          </div>
                        ) : null}
                      </div>
                      <div style={{ ...S.card, padding: '10px 12px', marginBottom: 16, background: C.bgBase }}>
                        <InfoLine label={tr('noteWords')} value={`${noteCharCount(active)} 字`} />
                        <InfoLine label={tr('noteVisibility')} value={active.visibility} />
                        <InfoLine label={tr('noteSource')} value={active.source} />
                        <InfoLine label={tr('noteCreator')} value={active.creatorName} />
                        <InfoLine
                          label={tr('noteComments')}
                          value={active.commentCount > 0 ? String(active.commentCount) : null}
                        />
                      </div>
                      <InsightSection title={tr('noteTags')}>
                        {(active.tags ?? []).length === 0 ? (
                          <div style={{ fontSize: 12, color: C.caption }}>—</div>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {(active.tags ?? []).map((tag) => (
                              <span key={tag} style={S.chip}>
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </InsightSection>
                      <InsightSection title={tr('relatedByTag')}>
                        {remoteRelated.length === 0 ? (
                          <div style={{ fontSize: 12, color: C.caption }}>—</div>
                        ) : (
                          remoteRelated.map((row) => (
                            <button
                              key={row.id}
                              type="button"
                              className="dsh-flaremo-row"
                              onClick={() => openNote(row.id)}
                              style={{
                                display: 'block',
                                width: '100%',
                                padding: '6px 8px',
                                marginBottom: 2,
                                border: 'none',
                                borderRadius: C.radiusSm,
                                background: 'transparent',
                                color: C.textSecondary,
                                fontFamily: 'inherit',
                                fontSize: 12,
                                lineHeight: '18px',
                                textAlign: 'left',
                                cursor: 'pointer',
                              }}
                            >
                              {row.title}
                              <span style={{ display: 'block', fontSize: 10.5, color: C.caption }}>{row.day}</span>
                            </button>
                          ))
                        )}
                      </InsightSection>
                      <p style={{ margin: 0, fontSize: 11.5, lineHeight: '18px', color: C.caption }}>
                        {tr('insightComingSoon')}
                      </p>
                    </>
                </div>

                <div
                  style={{
                    flex: '0 0 auto',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 14px',
                    borderTop: `1px solid ${C.borderSoft}`,
                  }}
                >
                  <button type="button" className="dsh-flaremo-btn" onClick={askThisNote} style={S.button}>
                    <IconSparkle size={13} />
                    {tr('askThis')}
                  </button>
                  <button
                    type="button"
                    className="dsh-flaremo-btn"
                    onClick={() => showNotice(tr('noticeQuote'))}
                    style={{ ...S.button, marginLeft: 'auto' }}
                  >
                    <IconQuote size={13} />
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
              width: 34,
              borderLeft: `1px solid ${C.borderSoft}`,
              background: C.bgLayer1,
            }}
          >
            <button
              type="button"
              className="dsh-flaremo-icon-btn"
              onClick={() => setInsightOpen(true)}
              title={tr('expand')}
              aria-label={tr('expand')}
              style={{ ...S.iconButton, width: 24, height: 24, color: C.accent }}
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
          padding: '5px 20px',
          borderTop: `1px solid ${C.borderSoft}`,
          background: C.bgLayer1,
          color: C.caption,
          fontSize: 11,
          lineHeight: '16px',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isRemote ? syncLabel : tr('footerDisconnected')}
        </span>
        <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
          {isRemote ? (connection?.instanceUrl ?? '') : null}
        </span>
      </footer>

      {/* ── 临时提示（骨架版没有真实动作时给反馈）────────────────────── */}
      {notice !== null ? (
        <div
          key={notice.seq}
          role="status"
          style={{
            position: 'absolute',
            right: 16,
            bottom: 40,
            zIndex: 10,
            maxWidth: 380,
            padding: '9px 12px',
            border: `1px solid ${C.borderSoft}`,
            borderRadius: C.radiusMd,
            background: C.bgBase,
            color: C.textSecondary,
            boxShadow: C.shadowProminent,
            fontSize: 12,
            lineHeight: '18px',
          }}
        >
          {notice.text}
        </div>
      ) : null}
    </div>
  )
}
