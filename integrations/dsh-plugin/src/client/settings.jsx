/**
 * 设置页 section：「FlareMo 连接」。
 *
 * 连接状态机本身在工作台面板里也能直接用——两边都走 `connect.jsx` 的
 * `useConnectFlow` + `ConnectForm` + `PairingCard`，这里只额外提供已连接后的
 * 账号信息、洞察执行器与断开按钮。
 *
 * token 全程留在 host 的凭据记录里：这个组件只拿连接视图（没有 token 字段）。
 *
 * 造型：Ember 设置页 = 标题 + 分组卡片（fm-card），字段用 12px muted 标签 +
 * 14px 墨色值；唯一的火焰 CTA 是「处理洞察」，「断开连接」是 destructive 变体。
 */

import React from 'react'

import { asApiError } from './api.js'
import { ConnectForm, PairingCard, useConnectFlow } from './connect.jsx'
import { createTranslator, translateError } from './i18n.js'
import { formatDateTime } from './notes.js'
import { C, S, T } from './styles.js'

/** 一行 label / value（只读信息，Ember 12px muted 标签 + 14px 墨色值）。 */
function InfoRow({ label, children }) {
  return (
    <div style={{ ...S.infoRow, marginBottom: 2 }}>
      <span style={{ flex: '0 0 96px', ...T.caption, color: C.textSecondary }}>{label}</span>
      <span style={{ ...T.caption, color: C.text, overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  )
}

/** 已连接状态卡。 */
function ConnectedPanel({ tr, connection, disconnecting, confirming, onDisconnect }) {
  const account = connection.account ?? {}
  const name = account.name ?? account.username ?? '—'
  return (
    <section className="fm-card" data-size="sm">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          style={{
            display: 'inline-flex',
            width: 8,
            height: 8,
            flex: 'none',
            borderRadius: 999,
            background: C.success,
          }}
        />
        <span style={{ ...T.h3, color: C.text }}>{tr('connectedTitle')}</span>
        <span className="fm-badge" data-tone="neutral">
          {connection.instanceUrl ?? ''}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <InfoRow label={tr('connectedTitle')}>{tr('connectedAs', { name })}</InfoRow>
        {account.email ? <InfoRow label="Email">{account.email}</InfoRow> : null}
        <InfoRow label={tr('scopeLabel')}>{connection.scope ?? 'notes'}</InfoRow>
        <InfoRow label={tr('lastSyncLabel')}>
          {connection.lastSyncAt ? formatDateTime(connection.lastSyncAt) : tr('neverSynced')}
        </InfoRow>
        <InfoRow label={tr('connectedAtLabel')}>{formatDateTime(connection.connectedAt)}</InfoRow>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="fm-btn"
          data-variant="destructive"
          data-size="sm"
          onClick={onDisconnect}
          disabled={disconnecting}
        >
          {confirming ? `${tr('disconnect')}？` : tr('disconnect')}
        </button>
        <span style={{ ...T.micro, color: C.textSecondary, lineHeight: '17px' }}>{tr('disconnectHint')}</span>
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
    <section className="fm-card" data-size="sm">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ ...T.h3, color: C.text }}>{tr('executorTitle')}</span>
        {pending === null ? null : (
          <span className="fm-badge" data-tone={count > 0 ? 'brand' : 'neutral'}>
            {count > 0 ? tr('executorPending', { count }) : tr('executorNone')}
          </span>
        )}
      </div>

      <p style={{ margin: 0, ...T.caption, color: C.textSecondary, lineHeight: '19px' }}>{tr('executorIntro')}</p>

      {model !== null && model.available === false ? (
        <div className="fm-alert" data-tone="warning" style={{ padding: '8px 10px', fontSize: 12 }}>
          {tr('executorModelNone', { reason: model.reason ?? '未配置' })}
        </div>
      ) : model !== null && model.provider ? (
        <div style={{ ...T.caption, color: C.textSecondary }}>
          {tr('executorModel')}: {`${model.provider}/${model.model}`}
        </div>
      ) : null}

      {errorText !== null ? (
        <div className="fm-alert" data-tone="danger" style={{ padding: '8px 10px', fontSize: 12 }}>
          {errorText}
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="fm-btn"
          data-variant="brand"
          data-size="sm"
          onClick={run}
          disabled={busy || count === 0 || modelReady === false}
        >
          {busy ? tr('executorRunning') : tr('executorRun')}
        </button>
        <span style={{ ...T.micro, color: C.textSecondary }}>{tr('executorLimitHint')}</span>
      </div>

      {batch !== null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ ...T.caption, fontWeight: 600, color: C.text }}>
            {tr('executorSummary', { done: batch.done ?? 0, failed: batch.failed ?? 0, skipped: batch.skipped ?? 0 })}
          </div>
          {(batch.results ?? []).map((row) => (
            <div key={row.id} style={{ ...T.micro, color: row.status === 'failed' ? C.danger : C.textSecondary }}>
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

export function SettingsSection({ t, call }) {
  const tr = React.useMemo(() => createTranslator(t), [t])
  const flow = useConnectFlow({ call, tr })
  const [disconnecting, setDisconnecting] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)
  const [disconnectError, setDisconnectError] = React.useState(null)

  const disconnect = async () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setDisconnecting(true)
    setDisconnectError(null)
    try {
      await call('disconnect')
      setConfirming(false)
      await flow.refresh()
    } catch (failure) {
      setDisconnectError(asApiError(failure))
    } finally {
      setDisconnecting(false)
    }
  }

  const { connection, connected, pending } = flow
  const statusErrorText = flow.statusError === null ? null : translateError(tr, flow.statusError)
  const errorText = flow.error === null ? null : translateError(tr, flow.error)
  const disconnectErrorText = disconnectError === null ? null : translateError(tr, disconnectError)

  return (
    <div
      className="dsh-flaremo-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        width: '100%',
        maxWidth: 720,
        margin: '0 auto',
        padding: '24px 24px 40px',
        color: C.text,
        fontFamily: C.font,
        fontSize: C.contentSize,
      }}
    >
      <header>
        <h2 style={{ margin: 0, ...T.h2, color: C.text }}>{tr('settingsTitle')}</h2>
        <p style={{ margin: '6px 0 0', ...T.body, color: C.textSecondary }}>{tr('settingsIntro')}</p>
      </header>

      {statusErrorText !== null ? (
        <div className="fm-alert" data-tone="danger">
          <div>
            <div>
              {tr('serviceUnavailable')} — {statusErrorText}
            </div>
            <div style={{ marginTop: 4, ...T.micro, color: C.textSecondary, lineHeight: '17px' }}>
              {tr('serviceUnavailableHint')}
            </div>
          </div>
        </div>
      ) : null}

      {errorText !== null ? (
        <div className="fm-alert" data-tone="danger">
          {errorText}
        </div>
      ) : null}
      {disconnectErrorText !== null ? (
        <div className="fm-alert" data-tone="danger">
          {disconnectErrorText}
        </div>
      ) : null}

      {connection === null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ ...T.caption, color: C.textSecondary }}>{tr('statusLoading')}</div>
          <div className="fm-skeleton" style={{ width: 160, height: 12 }} />
          <div className="fm-skeleton" style={{ width: '72%', height: 12 }} />
        </div>
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
        <PairingCard
          tr={tr}
          pending={pending}
          now={flow.now}
          polling={flow.polling}
          onPoll={flow.pollNow}
          onCancel={flow.cancelPairing}
        />
      ) : null}

      {!connected && pending === null ? (
        <>
          <div>
            <div style={{ ...T.h3, color: C.text }}>{tr('notConnectedTitle')}</div>
            <p style={{ margin: '4px 0 0', ...T.caption, color: C.textSecondary, lineHeight: '19px' }}>
              {tr('notConnectedHint')}
            </p>
          </div>
          <ConnectForm
            tr={tr}
            instanceUrl={flow.instanceUrl}
            onChange={flow.setInstanceUrl}
            busy={flow.busy}
            onStart={flow.startPairing}
          />
        </>
      ) : null}
    </div>
  )
}
