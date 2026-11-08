/**
 * 设备授权（RFC 8628）的共享连接流程：设置页与工作台面板共用同一套状态机。
 *
 *  1. 读 `connectionStatus`（顺带恢复未完成的配对；容器已给视图时不重复读）；
 *  2. `connectStart` → 配对码 userCode + 验证地址；
 *  3. 按 intervalSeconds 轮询 `connectPoll`，直到 connected / expired / denied；
 *  4. connected 时回调 `onConnected(connection)`，容器各自刷新自己的数据。
 *
 * token 全程留在 host 的凭据记录里：这里只拿连接视图（没有 token 字段）。
 * 工作台面板直接用 `ConnectForm` + `PairingCard`，不需要弹窗、也不用先去设置页。
 */

import React from 'react'

import { asApiError } from './api.js'
import { secondsUntil } from './notes.js'
import { C, S } from './styles.js'

/** 最小可用的配对状态：从 connection view 里抽出来。 */
function pendingOf(connection) {
  const pending = connection?.pending
  if (pending === null || typeof pending !== 'object') return null
  if (typeof pending.userCode !== 'string' || pending.userCode === '') return null
  return pending
}

/** 轮询间隔（秒）：host 没给就按 5s。 */
function intervalOf(view) {
  const seconds = Number(pendingOf(view)?.intervalSeconds)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 5
}

/**
 * 连接状态机。
 * @param {{ call: (method: string, args?: object) => Promise<object>,
 *   tr: (key: string, vars?: object) => string,
 *   initialConnection?: object | null,
 *   onConnected?: (connection: object) => void }} options
 */
export function useConnectFlow({ call, tr, initialConnection, onConnected }) {
  const hasInitial = initialConnection !== null && initialConnection !== undefined
  const [connection, setConnection] = React.useState(hasInitial ? initialConnection : null)
  const [statusError, setStatusError] = React.useState(null)
  const [instanceUrl, setInstanceUrl] = React.useState(hasInitial ? (initialConnection.instanceUrl ?? '') : '')
  const [pending, setPending] = React.useState(() => (hasInitial ? pendingOf(initialConnection) : null))
  const [busy, setBusy] = React.useState(false)
  const [polling, setPolling] = React.useState(false)
  const [error, setError] = React.useState(null)
  const [now, setNow] = React.useState(() => Date.now())

  const intervalRef = React.useRef(hasInitial ? intervalOf(initialConnection) : 5)
  const trRef = React.useRef(tr)
  const onConnectedRef = React.useRef(onConnected)
  trRef.current = tr
  onConnectedRef.current = onConnected

  // 容器没有给初始视图时，自己读一次连接状态（顺带恢复未完成的配对）
  React.useEffect(() => {
    if (hasInitial || typeof call !== 'function') return undefined
    let live = true
    ;(async () => {
      try {
        const reply = await call('connectionStatus')
        if (!live) return
        const view = reply?.connection ?? { connected: false }
        setConnection(view)
        setInstanceUrl(view?.instanceUrl ?? '')
        const resumed = pendingOf(view)
        if (resumed !== null) {
          intervalRef.current = intervalOf(view)
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
  }, [call, hasInitial])

  // 配对码过期倒计时
  React.useEffect(() => {
    if (pending === null) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [pending])

  /** 把一次 poll 结果应用到 UI；返回 'stop' 表示轮询结束。 */
  const applyPoll = React.useCallback((reply) => {
    if (reply?.status === 'connected') {
      const view = reply.connection ?? { connected: true }
      setConnection(view)
      setPending(null)
      setError(null)
      if (view.connected === true) onConnectedRef.current?.(view)
      return 'stop'
    }
    if (reply?.status === 'expired') {
      setPending(null)
      setError(new Error(trRef.current('pairExpired')))
      return 'stop'
    }
    if (reply?.status === 'denied') {
      setPending(null)
      setError(new Error(trRef.current('pairDenied')))
      return 'stop'
    }
    const seconds = Number(reply?.intervalSeconds)
    if (Number.isFinite(seconds) && seconds > 0) intervalRef.current = seconds
    return 'continue'
  }, [])

  // 轮询循环：配对中每隔 intervalSeconds 一次
  React.useEffect(() => {
    if (pending === null || typeof call !== 'function') return undefined
    let live = true
    let timer = null
    const schedule = () => {
      timer = setTimeout(run, Math.max(1, intervalRef.current) * 1000)
    }
    async function run() {
      try {
        const reply = await call('connectPoll')
        if (!live) return
        if (applyPoll(reply) === 'stop') return
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
  }, [pending?.userCode, call, applyPoll])

  const startPairing = React.useCallback(async () => {
    if (typeof call !== 'function') return
    setBusy(true)
    setError(null)
    setStatusError(null)
    try {
      const reply = await call('connectStart', { instanceUrl })
      const view = reply?.connection ?? null
      setConnection(view)
      const next = pendingOf(view)
      if (next !== null) {
        intervalRef.current = intervalOf(view)
        setPending(next)
        setNow(Date.now())
      }
    } catch (failure) {
      setError(asApiError(failure))
    } finally {
      setBusy(false)
    }
  }, [call, instanceUrl])

  const pollNow = React.useCallback(async () => {
    if (typeof call !== 'function') return
    setPolling(true)
    setError(null)
    try {
      const reply = await call('connectPoll')
      applyPoll(reply)
    } catch (failure) {
      setError(asApiError(failure))
    } finally {
      setPolling(false)
    }
  }, [call, applyPoll])

  const cancelPairing = React.useCallback(async () => {
    setPending(null)
    setError(null)
    try {
      await call('connectCancel')
    } catch {
      /* 取消失败不影响本地收起配对卡；下次读状态会重新出现 */
    }
  }, [call])

  /** 重新读一次连接状态（例如在别处刚批准完）。 */
  const refresh = React.useCallback(async () => {
    if (typeof call !== 'function') return
    setError(null)
    try {
      const reply = await call('connectionStatus')
      const view = reply?.connection ?? { connected: false }
      setConnection(view)
      setInstanceUrl(view?.instanceUrl ?? instanceUrl)
      const resumed = pendingOf(view)
      setPending(resumed)
      if (resumed !== null) intervalRef.current = intervalOf(view)
      if (view.connected === true) onConnectedRef.current?.(view)
    } catch (failure) {
      setError(asApiError(failure))
    }
  }, [call, instanceUrl])

  return {
    connection,
    connected: connection?.connected === true,
    statusError,
    instanceUrl,
    setInstanceUrl,
    pending,
    busy,
    polling,
    error,
    now,
    startPairing,
    pollNow,
    cancelPairing,
    refresh,
  }
}

/**
 * 配对表单：实例地址 + 「生成配对码」。设置页和工作台面板共用。
 * @param {{ tr: (key: string, vars?: object) => string, instanceUrl: string,
 *   onChange: (value: string) => void, busy: boolean, onStart: () => void,
 *   disabled?: boolean }} props
 */
export function ConnectForm({ tr, instanceUrl, onChange, busy, onStart, disabled = false }) {
  return (
    <>
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
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && busy === false && instanceUrl.trim() !== '') void onStart()
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
          onClick={onStart}
          disabled={disabled || busy || instanceUrl.trim() === ''}
          style={S.primaryButton}
        >
          {busy ? tr('connectWorking') : tr('connectStart')}
        </button>
      </div>
    </>
  )
}

/**
 * 配对码卡：8 位码 + 倒计时 + 打开配对页 + 手动「我已批准」+ 取消。
 * @param {{ tr: (key: string, vars?: object) => string, pending: object, now: number,
 *   polling: boolean, onPoll: () => void, onCancel: () => void }} props
 */
export function PairingCard({ tr, pending, now, polling, onPoll, onCancel }) {
  const remaining = secondsUntil(pending.expiresAt, now)
  return (
    <>
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
        <button
          type="button"
          className="dsh-flaremo-btn dsh-flaremo-primary"
          onClick={onPoll}
          disabled={polling}
          style={S.primaryButton}
        >
          {polling ? tr('pairWaiting') : tr('pairPoll')}
        </button>
        <button type="button" className="dsh-flaremo-btn" onClick={onCancel} style={S.button}>
          {tr('pairCancel')}
        </button>
      </div>
    </>
  )
}
