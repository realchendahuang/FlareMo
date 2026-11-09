/**
 * 时间线页的侧栏（与网页版同构）：品牌行 + 实例切换 + 统计卡 + 迷你月历 +
 * 导航（记录/归档/回收站）+ 标签 + 洞察队列 + 同步状态。
 *
 * 造型全部走 theme.js 的 class（fm-stat-card / fm-cal-* / fm-nav-item /
 * fm-tag-item / fm-badge / fm-btn），版面用内联 style；颜色只取 C.*，字号只取 T.*。
 */

import React from 'react'

import { C, S, T } from './styles.js'
import {
  IconArchive,
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconGrid,
  IconPanelLeft,
  IconSparkle,
  IconTag,
  IconTrash,
} from './icons.jsx'

/** 从实例地址里取 host（alias 缺失时兜底显示）。 */
export function hostOf(instanceUrl) {
  if (typeof instanceUrl !== 'string' || instanceUrl === '') return ''
  try {
    return new URL(instanceUrl).host
  } catch {
    return instanceUrl
  }
}

/** 当前 active 实例（`connection.instances` 里 active=true 的那条）。 */
export function activeInstanceOf(connection) {
  const instances = Array.isArray(connection?.instances) ? connection.instances : []
  return instances.find((row) => row.active === true) ?? instances[0]
}

// ── 日期小工具（侧栏月历用，不引日期库）────────────────────────────

/** 本地时区的 YYYY-MM-DD。 */
export function todayKey(now = new Date()) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** YYYY-MM；month 从 1 开始。 */
export function monthKeyOf(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** 平移月份（delta 可负）。 */
export function shiftMonthKey(monthKey, delta) {
  const [year, month] = monthKey.split('-').map(Number)
  const base = new Date(year, month - 1 + delta, 1)
  return monthKeyOf(base)
}

/** 月份标题（跟随浏览器语言）。 */
export function formatMonthKey(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  try {
    return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
    })
  } catch {
    return monthKey
  }
}

/**
 * 月历网格（周一开头，6 行 × 7 列，含上下月补格）。
 * @param {string} monthKey - YYYY-MM.
 * @returns {Array<{ key: string, day: number, date: string, outside: boolean }>}
 */
export function buildMonthGrid(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  const first = new Date(year, month - 1, 1)
  const offset = (first.getDay() + 6) % 7 // 周一 = 0
  const start = new Date(year, month - 1, 1 - offset)
  const cells = []
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    cells.push({
      key,
      day: date.getDate(),
      date: key,
      outside: date.getMonth() !== month - 1,
    })
  }
  return cells
}

/** 从活动天数里算连续天数（从今天或昨天往前数）。 */
export function streakOf(activity, today = todayKey()) {
  const active = new Set(
    (Array.isArray(activity) ? activity : [])
      .filter((row) => Number(row?.count) > 0)
      .map((row) => String(row.date)),
  )
  const cursor = new Date(`${today}T00:00:00`)
  if (!active.has(today)) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  for (let index = 0; index < 400; index += 1) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    if (!active.has(key)) break
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/** 侧栏导航项。 */
function NavItem({ icon, label, active, disabled, onClick }) {
  return (
    <button
      type="button"
      className="fm-nav-item"
      data-active={active ? 'true' : 'false'}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span style={{ minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </button>
  )
}

/** 统计卡：记录 / 标签 / 连续。 */
function StatsCard({ tr, stats }) {
  const total = stats?.counts?.total ?? 0
  const tagCount = Array.isArray(stats?.tags) ? stats.tags.length : 0
  const streak = streakOf(stats?.activity)
  return (
    <div className="fm-stat-card" aria-label={tr('statsRecords')}>
      <div className="fm-stat">
        <span className="fm-stat-value">{total}</span>
        <span className="fm-stat-label">{tr('statsRecords')}</span>
      </div>
      <div className="fm-stat">
        <span className="fm-stat-value">{tagCount}</span>
        <span className="fm-stat-label">{tr('statsTags')}</span>
      </div>
      <div className="fm-stat">
        <span className="fm-stat-value">{streak}</span>
        <span className="fm-stat-label">{tr('statsStreak')}</span>
      </div>
    </div>
  )
}

/** 迷你月历：月份翻页 + 活动点 + 选日筛选。 */
function MiniCalendar({ tr, activity, selectedDay, onDay }) {
  const today = React.useMemo(() => todayKey(), [])
  const [monthKey, setMonthKey] = React.useState(() => monthKeyOf())
  const counts = React.useMemo(() => {
    const map = new Map()
    for (const row of Array.isArray(activity) ? activity : []) {
      map.set(String(row.date), Number(row.count) || 0)
    }
    return map
  }, [activity])
  const cells = React.useMemo(() => buildMonthGrid(monthKey), [monthKey])
  const weekdays = ['一', '二', '三', '四', '五', '六', '日']

  return (
    <section aria-label={tr('calendarToday')} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ ...T.micro, fontWeight: 600, color: C.textSecondary, letterSpacing: '0.02em' }}>
          {formatMonthKey(monthKey)}
        </span>
        <button
          type="button"
          className="fm-btn"
          data-variant="ghost"
          data-size="icon-sm"
          onClick={() => setMonthKey(shiftMonthKey(monthKey, 1))}
          aria-label={tr('calendarNext')}
          title={tr('calendarNext')}
          style={{ marginLeft: 'auto' }}
        >
          <IconChevronRight size={13} />
        </button>
        <button
          type="button"
          className="fm-btn"
          data-variant="ghost"
          data-size="icon-sm"
          onClick={() => setMonthKey(shiftMonthKey(monthKey, -1))}
          aria-label={tr('calendarPrev')}
          title={tr('calendarPrev')}
        >
          <IconChevronLeft size={13} />
        </button>
        <button
          type="button"
          className="fm-btn"
          data-variant="ghost"
          data-size="xs"
          onClick={() => {
            setMonthKey(monthKeyOf())
            onDay(selectedDay === today ? null : today)
          }}
        >
          {tr('calendarToday')}
        </button>
      </div>
      <div className="fm-cal" role="grid">
        {weekdays.map((label) => (
          <span key={label} className="fm-cal-weekday" aria-hidden="true">
            {label}
          </span>
        ))}
        {cells.map((cell) => {
          const count = counts.get(cell.date) ?? 0
          const isToday = cell.date === today
          const isSelected = selectedDay === cell.date
          return (
            <button
              key={cell.key}
              type="button"
              className="fm-cal-cell"
              role="gridcell"
              data-outside={cell.outside ? 'true' : 'false'}
              data-today={isToday ? 'true' : 'false'}
              data-selected={isSelected ? 'true' : 'false'}
              aria-pressed={isSelected}
              aria-label={`${cell.date} · ${count}`}
              title={`${cell.date}${count > 0 ? ` · ${count}` : ''}`}
              onClick={() => onDay(isSelected ? null : cell.date)}
            >
              {cell.day}
              {count > 0 ? <span className="fm-cal-dot" aria-hidden="true" /> : null}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** 实例切换器：菜单用 `position: fixed`，避免被侧栏滚动容器裁掉。 */
export function InstanceSwitcher({ tr, connection, busy, onSwitch, onAdd }) {
  const [open, setOpen] = React.useState(false)
  const [anchor, setAnchor] = React.useState({ top: 0, left: 0 })
  const buttonRef = React.useRef(null)
  const menuRef = React.useRef(null)
  const instances = Array.isArray(connection?.instances) ? connection.instances : []
  const active = activeInstanceOf(connection)
  const label = active?.alias || connection?.alias || hostOf(connection?.instanceUrl) || tr('instanceLabel')

  const place = React.useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    setAnchor({ top: rect.bottom + 6, left: rect.left })
  }, [])

  React.useEffect(() => {
    if (!open) return undefined
    place()
    const closeOnOutside = (event) => {
      const target = event.target
      if (menuRef.current?.contains(target) === true) return
      if (buttonRef.current?.contains(target) === true) return
      setOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    const win = typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : null
    win?.addEventListener('resize', place)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
      win?.removeEventListener('resize', place)
    }
  }, [open, place])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="fm-btn"
        data-variant="outline"
        data-size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        title={tr('switchInstance')}
        onClick={() => setOpen((value) => !value)}
        style={{ width: '100%', justifyContent: 'flex-start', gap: 6 }}
      >
        <IconSparkle size={13} />
        <span style={{ minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
          {label}
        </span>
        <span
          aria-hidden="true"
          style={{
            display: 'flex',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: `transform ${C.durationFast} ${C.easeSignal}`,
          }}
        >
          <IconChevronRight size={12} />
        </span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          className="fm-card"
          data-size="sm"
          style={{
            position: 'fixed',
            top: anchor.top,
            left: anchor.left,
            zIndex: 60,
            width: 280,
            padding: 6,
            gap: 2,
            boxShadow: C.shadowProminent,
          }}
        >
          {instances.length === 0 ? (
            <div style={{ padding: '6px 8px', ...T.caption, color: C.textSecondary }}>{tr('instancesEmpty')}</div>
          ) : (
            instances.map((row) => (
              <button
                key={row.id}
                type="button"
                role="menuitem"
                className="fm-btn"
                data-variant="ghost"
                disabled={busy}
                onClick={() => {
                  setOpen(false)
                  void onSwitch(row.id)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  height: 'auto',
                  width: '100%',
                  padding: '7px 8px',
                  textAlign: 'left',
                  justifyContent: 'flex-start',
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: '1 1 auto' }}>
                  <span style={{ ...T.caption, fontWeight: 500, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.alias || hostOf(row.instanceUrl) || row.id}
                  </span>
                  <span style={{ ...T.micro, color: C.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {hostOf(row.instanceUrl)}
                  </span>
                </span>
                {row.connected === false ? (
                  <span className="fm-badge" data-tone="neutral">{tr('instanceNotConnected')}</span>
                ) : row.active === true ? (
                  <span className="fm-badge" data-tone="neutral">{tr('instanceActive')}</span>
                ) : null}
              </button>
            ))
          )}
          <div style={{ height: 1, background: C.border, margin: '4px 6px' }} />
          <button
            type="button"
            role="menuitem"
            className="fm-btn"
            data-variant="ghost"
            onClick={() => {
              setOpen(false)
              onAdd()
            }}
            style={{ width: '100%', justifyContent: 'flex-start', gap: 8, height: 30 }}
          >
            <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>＋</span>
            {tr('addInstance')}
          </button>
        </div>
      ) : null}
    </>
  )
}

/** 标签列表（多者截断，可清空）。 */
function TagList({ tr, tags, activeTag, onTag }) {
  const rows = (Array.isArray(tags) ? tags : []).slice(0, 12)
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px 4px', ...T.micro, fontWeight: 600, color: C.textSecondary }}>
        <IconTag size={12} />
        {tr('tagsTitle')}
        {activeTag === null ? null : (
          <button
            type="button"
            className="fm-btn"
            data-variant="ghost"
            data-size="xs"
            onClick={() => onTag(null)}
            style={{ marginLeft: 'auto' }}
          >
            {tr('tagsAll')}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: '2px 10px', ...T.micro, color: C.textSecondary }}>{tr('tagsEmpty')}</div>
      ) : (
        rows.map((tag) => (
          <button
            key={tag.name}
            type="button"
            className="fm-tag-item"
            data-active={activeTag === tag.name ? 'true' : 'false'}
            onClick={() => onTag(activeTag === tag.name ? null : tag.name)}
            title={`#${tag.name}`}
          >
            <span style={{ minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              #{tag.name}
            </span>
            <span style={{ ...T.micro, color: C.textSecondary, fontVariantNumeric: 'tabular-nums' }}>{tag.count}</span>
          </button>
        ))
      )}
    </section>
  )
}

/**
 * 时间线侧栏。
 * @param {object} props - see {@link Sidebar}.
 * @returns {React.ReactElement} the sidebar.
 */
export function Sidebar({
  tr,
  connection,
  stats,
  tags,
  view,
  activeTag,
  selectedDay,
  onToggleCollapse,
  onView,
  onTag,
  onDay,
  insights,
  runningInsights,
  onRunInsights,
  onSwitchInstance,
  onAddInstance,
  busy,
  syncLabel,
}) {
  const connected = connection?.connected === true
  return (
    <aside
      style={{
        flex: '0 0 260px',
        width: 260,
        minWidth: 0,
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
          gap: 8,
          height: 56,
          padding: '0 10px 0 14px',
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            flex: 'none',
            borderRadius: 7,
            background: C.brandGradient,
            color: '#fff',
            boxShadow: C.shadowSoft,
          }}
        >
          <IconSparkle size={14} />
        </span>
        <span style={{ fontFamily: C.fontHeading, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', color: C.text }}>
          FlareMo
        </span>
        <button
          type="button"
          className="fm-btn"
          data-variant="ghost"
          data-size="icon-sm"
          onClick={onToggleCollapse}
          aria-label={tr('sidebarCollapse')}
          title={tr('sidebarCollapse')}
          style={{ marginLeft: 'auto' }}
        >
          <IconPanelLeft size={14} />
        </button>
      </div>

      <div
        className="fm-scroll"
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: '12px 10px 16px',
        }}
      >
        {connected ? (
          <InstanceSwitcher
            tr={tr}
            connection={connection}
            busy={busy}
            onSwitch={onSwitchInstance}
            onAdd={onAddInstance}
          />
        ) : null}

        <StatsCard tr={tr} stats={stats} />
        <MiniCalendar tr={tr} activity={stats?.activity} selectedDay={selectedDay} onDay={onDay} />

        <nav aria-label={tr('navAll')} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <NavItem icon={<IconGrid size={14} />} label={tr('navAll')} active={view === 'all'} onClick={() => onView('all')} />
          <NavItem icon={<IconArchive size={14} />} label={tr('navArchived')} active={view === 'archived'} onClick={() => onView('archived')} />
          <NavItem icon={<IconTrash size={14} />} label={tr('navTrashed')} active={view === 'trashed'} onClick={() => onView('trashed')} />
        </nav>

        <TagList tr={tr} tags={tags} activeTag={activeTag} onTag={onTag} />

        {insights === null || insights === undefined ? null : (
          <section className="fm-card" data-size="sm" style={{ gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconCalendar size={12} style={{ color: C.textSecondary }} />
              <span style={{ ...T.micro, fontWeight: 600, color: C.textSecondary }}>{tr('executorQueue')}</span>
              <span className="fm-badge" data-tone={(insights.count ?? 0) > 0 ? 'brand' : 'neutral'} style={{ marginLeft: 'auto' }}>
                {(insights.count ?? 0) > 0 ? tr('executorPending', { count: insights.count }) : tr('executorNone')}
              </span>
            </div>
            {insights.model?.available === false ? (
              <div className="fm-alert" data-tone="warning" style={{ padding: '6px 8px', fontSize: 11 }}>
                {tr('executorModelNone', { reason: insights.model.reason ?? '未配置' })}
              </div>
            ) : null}
            <button
              type="button"
              className="fm-btn"
              data-variant="outline"
              data-size="xs"
              onClick={onRunInsights}
              disabled={runningInsights || (insights.count ?? 0) === 0}
            >
              {runningInsights ? tr('executorRunning') : tr('executorRunShort')}
            </button>
          </section>
        )}
      </div>

      <div
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 14px',
          borderTop: `1px solid ${C.border}`,
          ...T.micro,
          color: C.textSecondary,
          lineHeight: '16px',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            flex: 'none',
            borderRadius: 999,
            background: connected ? C.success : C.textSecondary,
          }}
        />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {connected ? syncLabel : tr('footerDisconnected')}
        </span>
      </div>
    </aside>
  )
}
