/**
 * 设置页 section：「FlareMo 连接」。
 *
 * 连接状态机本身在工作台面板里也能直接用——两边都走 `connect.jsx` 的
 * `useConnectFlow` + `ConnectForm` + `PairingCard`，这里只额外提供已连接后的
 * 账号信息与断开按钮。
 *
 * token 全程留在 host 的凭据记录里：这个组件只拿连接视图（没有 token 字段）。
 */

import React from 'react'

import { asApiError } from './api.js'
import { ConnectForm, PairingCard, useConnectFlow } from './connect.jsx'
import { createTranslator, translateError } from './i18n.js'
import { formatDateTime } from './notes.js'
import { C, S } from './styles.js'

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

  const banner = {
    padding: '9px 12px',
    border: `1px solid ${C.borderSoft}`,
    borderRadius: C.radiusMd,
    background: C.bgLayer1,
    color: C.danger,
    fontSize: 12.5,
    lineHeight: '19px',
  }

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
        <div style={banner}>
          {tr('serviceUnavailable')} — {statusErrorText}
          <div style={{ marginTop: 2, color: C.caption, fontSize: 11.5 }}>{tr('serviceUnavailableHint')}</div>
        </div>
      ) : null}

      {errorText !== null ? <div style={banner}>{errorText}</div> : null}
      {disconnectErrorText !== null ? <div style={banner}>{disconnectErrorText}</div> : null}

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
        <section style={{ ...S.card, padding: '14px 16px', background: C.bgBase }}>
          <PairingCard
            tr={tr}
            pending={pending}
            now={flow.now}
            polling={flow.polling}
            onPoll={flow.pollNow}
            onCancel={flow.cancelPairing}
          />
        </section>
      ) : null}

      {!connected && pending === null ? (
        <section style={{ ...S.card, padding: '14px 16px', background: C.bgBase }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{tr('notConnectedTitle')}</div>
          <p style={{ margin: '0 0 10px', fontSize: 12.5, lineHeight: '19px', color: C.textSecondary }}>
            {tr('notConnectedHint')}
          </p>
          <ConnectForm
            tr={tr}
            instanceUrl={flow.instanceUrl}
            onChange={flow.setInstanceUrl}
            busy={flow.busy}
            onStart={flow.startPairing}
          />
        </section>
      ) : null}
    </div>
  )
}
