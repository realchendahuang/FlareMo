/**
 * 设置页 section：「FlareMo 连接」。
 *
 * 流程（设备授权 RFC 8628）：
 *   1. 填实例地址 → `connectStart` 拿到配对码 user_code + 验证地址；
 *   2. 用户在 FlareMo 网页确认 → 这里按 intervalSeconds 轮询 `connectPoll`；
 *   3. connected 后显示账号 / 最后同步 / 授权范围，可断开。
 *
 * token 全程留在 host 的凭据记录里：这个组件只拿连接视图（没有 token 字段）。
 */

import React from 'react'

import { asApiError } from './api.js'
import { createTranslator, translateError } from './i18n.js'
import { formatDateTime, secondsUntil } from './notes.js'
import { C, S } from './styles.js'

/** 最小可用的配对状态：从 connection view 里抽出来。 */
function pendingOf(connection) {
  const pending = connection?.pending
  if (pending === null || typeof pending !== 'object') return null
  if (typeof pending.userCode !== 'string' || pending.userCode === '') return null
  return pending
}

/** 一行 label / value（只读信息）。 */
function InfoRow({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '5px 0', minWidth: 0 }}>
      <span style={{ flex: '0 0 96px', fontSize: 11.5, color: C.textTertiary }}>{label}</span>
      <span style={{ minWidth: 0, fontSize: 12.5, color: C.text, overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  )
}

/** 已连接状态卡。 */
function ConnectedPanel({ tr, connection, disconnecting, confirming, onDisconnect }) {
  const account = connection.account ?? {}
  const name = account.name ?? account.username ?? '—'
  return (
    <section style={{ ...S.card, padding: '14px 16px', background: C.bgBase }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 8,
            height: 8,
            borderRadius: 999,
            background: C.success,
            flex: 'none',
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{tr('connectedTitle')}</span>
        <span style={{ ...S.chip, background: C.accentSoft, color: C.accent }}>{connection.instanceUrl ?? ''}</span>
      </div>
      <InfoRow label={tr('connectedTitle')}>{tr('connectedAs', { name })}</InfoRow>
      {account.email ? <InfoRow label="Email">{account.email}</InfoRow> : null}
      <InfoRow label={tr('scopeLabel')}>{connection.scope ?? 'notes'}</InfoRow>
      <InfoRow label={tr('lastSync')}>
        {connection.lastSyncAt ? formatDateTime(connection.lastSyncAt) : tr('neverSynced')}
      </InfoRow>
      <InfoRow label={tr('connectedAt')}>{formatDateTime(connection.connectedAt)}</InfoRow>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="dsh-flaremo-btn"
          onClick={onDisconnect}
          disabled={disconnecting}
          style={{ ...S.button, color: confirming ? C.danger : C.text }}
        >
          {confirming ? `${tr('disconnect')}？` : tr('disconnect')}
        </button>
        <span style={{ fontSize: 11.5, lineHeight: '17px', color: C.caption }}>{tr('disconnectHint')}</span>
      </div>
    </section>
  )
}

/** 洞察执行器卡：显示 pending 数量、模型可用性，手动跑一批任务。 */
function ExecutorPanel({ tr, call }) {
  /** @type {[({ count: number, model: object|null }) | null, Function]} */
  const [pending, setPending] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [batch, setBatch] = React.useState(null)
  const [error, setError] = React.useState(null)

  const load = React.useCallback(async () => {
    try {
      const reply = await call('listPendingInsights', { limit: 50 })
      setPending({
        count: Number(reply?.count) > 0 ? Number(reply.count) : 0,
        model: reply?.model ?? null,
      })
    } catch (failure) {
      setError(asApiError(failure))
    }
  }, [call])

  React.useEffect(() => {
    void load()
  }, [load])

  const run = async () => {
    setBusy(true)
    setError(null)
    setBatch(null)
    try {
      const reply = await call('runPendingInsights', { limit: 3 })
      setBatch(reply)
      await load()
    } catch (failure) {
      setError(asApiError(failure))
    } finally {
      setBusy(false)
    }
  }

  const count = pending?.count ?? 0
  const model = pending?.model ?? null
  const modelReady = model === null || model.available !== false
  const errorText = error === null ? null : translateError(tr, error)

  return (
    <section style={{ ...S.card, padding: '14px 16px', background: C.bgBase }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{tr('executorTitle')}</span>
        {pending === null ? null : (
          <span
            style={{
              ...S.chip,
              background: count > 0 ? C.accentSoft : C.bgLayer2,
              color: count > 0 ? C.accent : C.textSecondary,
            }}
          >
            {count > 0 ? tr('executorPending', { count }) : tr('executorNone')}
          </span>
        )}
      </div>
      <p style={{ margin: '0 0 10px', fontSize: 12, lineHeight: '19px', color: C.textSecondary }}>
        {tr('executorIntro')}
      </p>

      {model !== null && model.available === false ? (
        <div style={{ marginBottom: 10, fontSize: 12, lineHeight: '18px', color: C.warn }}>
          {tr('executorModelNone', { reason: model.reason ?? '未配置' })}
        </div>
      ) : model !== null && model.provider ? (
        <div style={{ marginBottom: 10, fontSize: 12, lineHeight: '18px', color: C.textSecondary }}>
          {tr('executorModel')}: {`${model.provider}/${model.model}`}
        </div>
      ) : null}

      {errorText !== null ? (
        <div style={{ marginBottom: 10, fontSize: 12, lineHeight: '18px', color: C.danger }}>{errorText}</div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="dsh-flaremo-btn dsh-flaremo-primary"
          onClick={run}
          disabled={busy || count === 0 || modelReady === false}
          style={S.primaryButton}
        >
          {busy ? tr('executorRunning') : tr('executorRun')}
        </button>
        <span style={{ fontSize: 11.5, color: C.caption }}>{tr('executorLimitHint')}</span>
      </div>

      {batch !== null ? (
        <div style={{ marginTop: 10, fontSize: 12, lineHeight: '18px', color: C.textSecondary }}>
          <div style={{ fontWeight: 600, color: C.text, marginBottom: 4 }}>
            {tr('executorSummary', { done: batch.done ?? 0, failed: batch.failed ?? 0, skipped: batch.skipped ?? 0 })}
          </div>
          {(batch.results ?? []).map((row) => (
            <div key={row.id} style={{ color: row.status === 'failed' ? C.danger : C.textSecondary }}>
              {row.status === 'failed'
                ? tr('executorTaskFailed', { id: row.id, error: row.error ?? '' })
                : row.status === 'done'
                  ? tr('executorTaskDone', { id: row.id })
                  : `${row.id} · ${row.reason ?? row.status}`}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

/** 配对中的状态卡：配对码 + 倒计时 + 打开配对页 + 手动「我已批准」。 */
function PairingPanel({ tr, connection, pending, now, polling, onPoll, onCancel }) {
  const remaining = secondsUntil(pending.expiresAt, now)
  return (
    <section style={{ ...S.card, padding: '14px 16px', background: C.bgBase }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{tr('pairTitle')}</div>
      <p style={{ margin: '0 0 10px', fontSize: 12.5, lineHeight: '19px', color: C.textSecondary }}>{tr('pairHint')}</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <code
          style={{
            padding: '7px 14px',
            border: `1px solid ${C.border}`,
            borderRadius: C.radiusMd,
            background: C.bgLayer2,
            color: C.text,
            fontFamily: C.mono,
            fontSize: 20,
            letterSpacing: '0.16em',
          }}
        >
          {pending.userCode}
        </code>
        <span style={{ fontSize: 11.5, color: remaining > 0 ? C.textTertiary : C.danger }}>
          {remaining > 0 ? tr('pairExpires', { seconds: remaining }) : tr('pairExpired')}
        </span>
      </div>

      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {pending.verificationUriComplete ? (
          <a
            href={pending.verificationUriComplete}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12.5, color: C.link, overflowWrap: 'anywhere' }}
          >
            {tr('pairOpen')} ↗ {pending.verificationUriComplete}
          </a>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" className="dsh-flaremo-btn dsh-flaremo-primary" onClick={onPoll} disabled={polling} style={S.primaryButton}>
          {polling ? tr('pairWaiting') : tr('pairPoll')}
        </button>
        <button type="button" className="dsh-flaremo-btn" onClick={onCancel} style={S.button}>
          {tr('pairCancel')}
        </button>
        <span style={{ fontSize: 11.5, color: C.caption }}>{connection.instanceUrl ?? ''}</span>
      </div>
    </section>
  )
}

/**
 * 设置页 section 组件。props 由 entry.jsx 注册时注入。
 * @param {{ t?: (key: string) => string, call: (method: string, args?: object) => Promise<object> }} props
 * @returns {React.ReactElement} the settings page.
 */
export function SettingsSection({ t, call }) {
  const tr = React.useMemo(() => createTranslator(t), [t])
  /** @type {[object | null, Function]} loading → null, loaded → connection view */
  const [connection, setConnection] = React.useState(null)
  const [statusError, setStatusError] = React.useState(null)
  const [instanceUrl, setInstanceUrl] = React.useState('')
  const [pending, setPending] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [polling, setPolling] = React.useState(false)
  const [error, setError] = React.useState(null)
  const [now, setNow] = React.useState(() => Date.now())
  const [disconnecting, setDisconnecting] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)

  const intervalRef = React.useRef(5)
  const applyPollRef = React.useRef(() => 'continue')

  // 首次读取连接状态（顺带恢复未完成的配对）
  React.useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const reply = await call('connectionStatus')
        if (!live) return
        const view = reply.connection ?? null
        setConnection(view)
        setInstanceUrl(view?.instanceUrl ?? '')
        const resumed = pendingOf(view)
        if (resumed !== null) {
          intervalRef.current = Number(resumed.intervalSeconds) > 0 ? Number(resumed.intervalSeconds) : 5
          setPending(resumed)
        }
      } catch (failure) {
        if (!live) return
        setStatusError(asApiError(failure))
        setConnection({ connected: false })
      }
    })()
    return () => {
      live = false
    }
  }, [call])

  // 配对码过期倒计时
  React.useEffect(() => {
    if (pending === null) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [pending])

  /** 把一次 poll 结果应用到 UI；返回 'stop' 表示轮询结束。 */
  applyPollRef.current = (reply) => {
    if (reply.status === 'connected') {
      setConnection(reply.connection ?? null)
      setPending(null)
      setError(null)
      return 'stop'
    }
    if (reply.status === 'expired') {
      setPending(null)
      setError(new Error(tr('pairExpired')))
      return 'stop'
    }
    if (reply.status === 'denied') {
      setPending(null)
      setError(new Error(tr('pairDenied')))
      return 'stop'
    }
    const intervalSeconds = Number(reply.intervalSeconds) > 0 ? Number(reply.intervalSeconds) : intervalRef.current
    intervalRef.current = intervalSeconds
    return 'continue'
  }

  // 轮询循环：配对中每隔 intervalSecondsPoll 一次
  React.useEffect(() => {
    if (pending === null) return undefined
    let live = true
    let timer = null
    const schedule = () => {
      timer = setTimeout(run, Math.max(1, intervalRef.current) * 1000)
    }
    async function run() {
      try {
        const reply = await call('connectPoll')
        if (!live) return
        if (applyPollRef.current(reply) === 'stop') return
        schedule()
      } catch (failure) {
        if (!live) return
        setError(asApiError(failure))
        schedule()
      }
    }
    schedule()
    return () => {
      live = false
      if (timer !== null) clearTimeout(timer)
    }
  }, [pending?.userCode, call])

  const startPairing = async () => {
    setBusy(true)
    setError(null)
    setStatusError(null)
    try {
      const reply = await call('connectStart', { instanceUrl })
      const view = reply.connection ?? null
      setConnection(view)
      const next = pendingOf(view)
      if (next !== null) {
        intervalRef.current = Number(next.intervalSeconds) > 0 ? Number(next.intervalSeconds) : 5
        setPending(next)
        setNow(Date.now())
      }
    } catch (failure) {
      setError(asApiError(failure))
    } finally {
      setBusy(false)
    }
  }

  const pollNow = async () => {
    setPolling(true)
    setError(null)
    try {
      const reply = await call('connectPoll')
      applyPollRef.current(reply)
    } catch (failure) {
      setError(asApiError(failure))
    } finally {
      setPolling(false)
    }
  }

  const cancelPairing = async () => {
    setPending(null)
    setError(null)
    try {
      await call('connectCancel')
    } catch {
      /* 取消失败不影响本地收起配对卡；下次读状态会重新出现 */
    }
  }

  const disconnect = async () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setDisconnecting(true)
    setError(null)
    try {
      const reply = await call('disconnect')
      setConnection(reply.connection ?? { connected: false })
      setPending(null)
      setConfirming(false)
    } catch (failure) {
      setError(asApiError(failure))
    } finally {
      setDisconnecting(false)
    }
  }

  const errorText = error === null ? null : error.code ? translateError(tr, error) : error.message
  const statusErrorText = statusError === null ? null : translateError(tr, statusError)
  const connected = connection?.connected === true

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        width: '100%',
        maxWidth: 720,
        margin: '0 auto',
        padding: '20px 24px 40px',
        color: C.text,
        fontFamily: C.font,
        fontSize: C.contentSize,
      }}
    >
      <header>
        <h2 style={{ margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600 }}>{tr('settingsTitle')}</h2>
        <p style={{ margin: '6px 0 0', fontSize: 12.5, lineHeight: '20px', color: C.textSecondary }}>
          {tr('settingsIntro')}
        </p>
      </header>

      {statusErrorText !== null ? (
        <div
          style={{
            padding: '9px 12px',
            border: `1px solid ${C.borderSoft}`,
            borderRadius: C.radiusMd,
            background: C.bgLayer1,
            color: C.danger,
            fontSize: 12.5,
            lineHeight: '19px',
          }}
        >
          {tr('serviceUnavailable')} — {statusErrorText}
          <div style={{ marginTop: 2, color: C.caption, fontSize: 11.5 }}>{tr('serviceUnavailableHint')}</div>
        </div>
      ) : null}

      {errorText !== null ? (
        <div
          style={{
            padding: '9px 12px',
            border: `1px solid ${C.borderSoft}`,
            borderRadius: C.radiusMd,
            background: C.bgLayer1,
            color: C.danger,
            fontSize: 12.5,
            lineHeight: '19px',
          }}
        >
          {errorText}
        </div>
      ) : null}

      {connection === null ? (
        <div style={{ fontSize: 12.5, color: C.textTertiary }}>{tr('statusLoading')}</div>
      ) : connected ? (
        <>
          <ConnectedPanel
            tr={tr}
            connection={connection}
            disconnecting={disconnecting}
            confirming={confirming}
            onDisconnect={disconnect}
          />
          <ExecutorPanel tr={tr} call={call} />
        </>
      ) : null}

      {!connected && pending !== null ? (
        <PairingPanel
          tr={tr}
          connection={connection}
          pending={pending}
          now={now}
          polling={polling}
          onPoll={pollNow}
          onCancel={cancelPairing}
        />
      ) : null}

      {!connected && pending === null ? (
        <section style={{ ...S.card, padding: '14px 16px', background: C.bgBase }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{tr('notConnectedTitle')}</span>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: 12.5, lineHeight: '19px', color: C.textSecondary }}>
            {tr('notConnectedHint')}
          </p>
          <label style={{ display: 'block', fontSize: 11.5, color: C.textTertiary, marginBottom: 4 }}>
            {tr('instanceLabel')}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="dsh-flaremo-input"
              type="url"
              value={instanceUrl}
              placeholder={tr('instancePlaceholder')}
              aria-label={tr('instanceLabel')}
              onChange={(event) => setInstanceUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && busy === false) void startPairing()
              }}
              style={{
                flex: '1 1 260px',
                minWidth: 180,
                height: 30,
                padding: '0 10px',
                border: `1px solid ${C.border}`,
                borderRadius: C.radiusMd,
                background: C.bgBase,
                color: C.text,
                fontFamily: 'inherit',
                fontSize: 12.5,
                outline: 'none',
              }}
            />
            <button
              type="button"
              className="dsh-flaremo-btn dsh-flaremo-primary"
              onClick={startPairing}
              disabled={busy || instanceUrl.trim() === ''}
              style={S.primaryButton}
            >
              {busy ? tr('connectWorking') : tr('connectStart')}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  )
}
