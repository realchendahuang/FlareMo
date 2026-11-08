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
import { C, T } from './styles.js'

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
 *
 * 造型照网页端：一张 fm-card 里的表单项（12px 标签 + h-8 输入框 + 唯一火焰 CTA）。
 * @param {{ tr: (key: string, vars?: object) => string, instanceUrl: string,
 *   onChange: (value: string) => void, busy: boolean, onStart: () => void,
 *   disabled?: boolean }} props
 */
export function ConnectForm({ tr, instanceUrl, onChange, busy, onStart, disabled = false }) {
  const canSubmit = disabled === false && busy === false && instanceUrl.trim() !== ''
  const submit = () => {
    if (canSubmit) void onStart()
  }
  return (
    <form
      className="fm-card"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      style={{ gap: 12 }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ ...T.caption, fontWeight: 500, color: C.text }}>{tr('instanceLabel')}</span>
        <input
          className="fm-input"
          type="url"
          value={instanceUrl}
          placeholder={tr('instancePlaceholder')}
          aria-label={tr('instanceLabel')}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="submit"
          className="fm-btn"
          data-variant={canSubmit ? 'brand' : 'outline'}
          data-size="sm"
          disabled={!canSubmit}
        >
          {busy ? tr('connectWorking') : tr('connectStart')}
        </button>
      </div>
    </form>
  )
}

/**
 * 配对卡：8 位配对码 + 倒计时 + 「打开配对页」/「我已批准」/「取消配对」。
 *
 * 配对码的造型抄网页端 connect-page.tsx 的 code 输入框：等宽、居中、字距拉开。
 * @param {{ tr: (key: string, vars?: object) => string,
 *   pending: { userCode: string, verificationUri?: string, verificationUriComplete?: string, expiresAt?: string },
 *   now: number, polling: boolean, onPoll: () => void, onCancel: () => void }} props
 */
export function PairingCard({ tr, pending, now, polling, onPoll, onCancel }) {
  const remaining = secondsUntil(pending.expiresAt, now)
  const expired = remaining <= 0
  const countdown = expired ? tr('pairExpired') : tr('pairExpires', { seconds: remaining })
  return (
    <div className="fm-card" style={{ gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ ...T.h3, color: C.text }}>{tr('pairTitle')}</div>
        <p style={{ margin: 0, ...T.caption, color: C.textSecondary, lineHeight: '19px' }}>{tr('pairHint')}</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <code
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 220,
            padding: '10px 18px',
            border: `1px solid ${C.border}`,
            borderRadius: C.radiusLg,
            background: C.bgBase,
            color: C.text,
            fontFamily: C.mono,
            fontSize: 22,
            lineHeight: '26px',
            letterSpacing: '0.3em',
            textTransform: 'uppercase',
            textIndent: '0.3em',
          }}
        >
          {pending.userCode}
        </code>
        <span style={{ ...T.caption, color: expired ? C.danger : C.textSecondary }}>{countdown}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="fm-btn"
          data-variant="brand"
          data-size="sm"
          onClick={onPoll}
          disabled={polling}
        >
          {polling ? tr('pairWaiting') : tr('pairPoll')}
        </button>
        {pending.verificationUriComplete ? (
          <a
            className="fm-btn"
            data-variant="outline"
            data-size="sm"
            href={pending.verificationUriComplete}
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: 'none' }}
          >
            {tr('pairOpen')}
          </a>
        ) : null}
        <button
          type="button"
          className="fm-btn"
          data-variant="ghost"
          data-size="sm"
          onClick={onCancel}
          style={{ marginLeft: 'auto' }}
        >
          {tr('pairCancel')}
        </button>
      </div>

      {polling ? (
        <span style={{ ...T.micro, color: C.textSecondary, lineHeight: '17px' }}>{tr('pairWaiting')}</span>
      ) : expired ? (
        <span style={{ ...T.micro, color: C.danger, lineHeight: '17px' }}>{tr('pairExpired')}</span>
      ) : null}
    </div>
  )
}
