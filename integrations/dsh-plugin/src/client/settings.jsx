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

/** alias 的合法区间（host 侧同样是 1–40 字符；这里先做本地校验）。 */
const ALIAS_MAX = 40

/** 本地校验 alias：返回错误文案 key，合法时返回 null。 */
function aliasProblem(tr, value, instances, selfId) {
  const alias = typeof value === 'string' ? value.trim() : ''
  if (alias.length < 1 || alias.length > ALIAS_MAX) return tr('aliasInvalid')
  const taken = instances.some(
    (row) => row.id !== selfId && typeof row.alias === 'string' && row.alias.toLowerCase() === alias.toLowerCase(),
  )
  if (taken) return tr('aliasTaken')
  return null
}

/**
 * 「实例」分组：列出全部具名实例，支持切换 / 改名 / 移除。
 *
 * 只做列表与动作，配对流程仍归 ConnectForm / PairingCard；每次动作成功后由容器
 * 重新读 connectionStatus（`flow.refresh`），所以这里的 instances 永远是 host 视图。
 *
 * @param {{ tr: (key: string, vars?: object) => string, instances: object[],
 *   busyId: string | null, onSwitch: (id: string) => void,
 *   onRename: (id: string, alias: string) => Promise<string | null>,
 *   onRemove: (id: string) => void }} props
 * @returns {React.ReactElement} the instance list card.
 */
function InstanceList({ tr, instances, busyId, onSwitch, onRename, onRemove }) {
  const [renamingId, setRenamingId] = React.useState(null)
  const [renameValue, setRenameValue] = React.useState('')
  const [renameError, setRenameError] = React.useState(null)
  const [confirmingId, setConfirmingId] = React.useState(null)

  const startRename = (row) => {
    setRenamingId(row.id)
    setRenameValue(row.alias ?? '')
    setRenameError(null)
    setConfirmingId(null)
  }

  const cancelRename = () => {
    setRenamingId(null)
    setRenameValue('')
    setRenameError(null)
  }

  const submitRename = async (row) => {
    const problem = aliasProblem(tr, renameValue, instances, row.id)
    if (problem !== null) {
      setRenameError(problem)
      return
    }
    const failure = await onRename(row.id, renameValue.trim())
    if (failure === null) cancelRename()
    else setRenameError(failure)
  }

  return (
    <section className="fm-card" data-size="sm">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ ...T.h3, color: C.text }}>{tr('instances')}</span>
        <span className="fm-badge" data-tone="neutral">
          {instances.length}
        </span>
      </div>
      <p style={{ margin: 0, ...T.caption, color: C.textSecondary, lineHeight: '19px' }}>
        {tr('instanceAliasHint')}
      </p>

      {instances.length === 0 ? (
        <div style={{ ...T.caption, color: C.textSecondary }}>{tr('instancesEmpty')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {instances.map((row, index) => {
            const active = row.active === true
            const busy = busyId === row.id
            return (
              <div
                key={row.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '10px 0',
                  borderTop: index === 0 ? 'none' : `1px solid ${C.border}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: '1 1 200px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
                      <span
                        style={{
                          ...T.h3,
                          color: C.text,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: '100%',
                        }}
                      >
                        {row.alias || row.id}
                      </span>
                      {active ? (
                        <span className="fm-badge" data-tone="neutral">
                          {tr('instanceActive')}
                        </span>
                      ) : null}
                      {row.connected === false ? (
                        <span className="fm-badge" data-tone="warning">
                          {tr('instanceNotConnected')}
                        </span>
                      ) : null}
                    </span>
                    <span style={{ ...T.caption, color: C.textSecondary, overflowWrap: 'anywhere' }}>
                      {row.instanceUrl ?? ''}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
                    {row.connected !== false && !active ? (
                      <button
                        type="button"
                        className="fm-btn"
                        data-variant="outline"
                        data-size="xs"
                        disabled={busy}
                        onClick={() => onSwitch(row.id)}
                      >
                        {tr('switchInstance')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="fm-btn"
                      data-variant="ghost"
                      data-size="xs"
                      disabled={busy}
                      onClick={() => (renamingId === row.id ? cancelRename() : startRename(row))}
                    >
                      {tr('renameInstance')}
                    </button>
                    <button
                      type="button"
                      className="fm-btn"
                      data-variant="destructive"
                      data-size="xs"
                      disabled={busy}
                      onClick={() => {
                        if (confirmingId === row.id) {
                          setConfirmingId(null)
                          onRemove(row.id)
                        } else {
                          setRenamingId(null)
                          setConfirmingId(row.id)
                        }
                      }}
                    >
                      {confirmingId === row.id ? `${tr('removeInstance')}？` : tr('removeInstance')}
                    </button>
                    {confirmingId === row.id ? (
                      <button
                        type="button"
                        className="fm-btn"
                        data-variant="ghost"
                        data-size="xs"
                        onClick={() => setConfirmingId(null)}
                      >
                        {tr('cancel')}
                      </button>
                    ) : null}
                  </div>
                </div>

                {confirmingId === row.id ? (
                  <div className="fm-alert" data-tone="warning" style={{ padding: '6px 8px', fontSize: 12 }}>
                    {tr('removeInstanceConfirm')}
                  </div>
                ) : null}

                {renamingId === row.id ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      void submitRename(row)
                    }}
                    style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <input
                        className="fm-input"
                        type="text"
                        value={renameValue}
                        maxLength={ALIAS_MAX + 8}
                        aria-label={tr('instanceAlias')}
                        placeholder={tr('instanceAlias')}
                        onChange={(event) => {
                          setRenameValue(event.target.value)
                          setRenameError(null)
                        }}
                        style={{ width: 200 }}
                      />
                      <button type="submit" className="fm-btn" data-variant="brand" data-size="xs" disabled={busy}>
                        {tr('save')}
                      </button>
                      <button
                        type="button"
                        className="fm-btn"
                        data-variant="ghost"
                        data-size="xs"
                        onClick={cancelRename}
                      >
                        {tr('cancel')}
                      </button>
                    </div>
                    {renameError !== null ? (
                      <span style={{ ...T.micro, color: C.danger, lineHeight: '17px' }}>{renameError}</span>
                    ) : null}
                  </form>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </section>
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
        {connection.alias ? (
          <span className="fm-badge" data-tone="neutral">
            {connection.alias}
          </span>
        ) : null}
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
  /** 正在切换/改名/移除的实例 id（行内按钮置灰）。 */
  const [busyId, setBusyId] = React.useState(null)
  /** 切换/移除失败的错误（改名错误留在行内显示）。 */
  const [actionError, setActionError] = React.useState(null)

  const { connection, connected, pending } = flow
  const instances = Array.isArray(connection?.instances) ? connection.instances : []

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

  /** 切换 active 实例：host 切完，设置页重新读 connectionStatus（时间线不在这里）。 */
  const switchTo = async (id) => {
    setBusyId(id)
    setActionError(null)
    try {
      await call('switchInstance', { id })
      await flow.refresh()
    } catch (failure) {
      setActionError(asApiError(failure))
    } finally {
      setBusyId(null)
    }
  }

  /** 改名：本地校验 alias 后调 host；成功返回 null，失败返回可显示的文案。 */
  const rename = async (id, alias) => {
    setBusyId(id)
    setActionError(null)
    try {
      await call('renameInstance', { id, alias })
      await flow.refresh()
      return null
    } catch (failure) {
      return translateError(tr, asApiError(failure))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (id) => {
    setBusyId(id)
    setActionError(null)
    try {
      await call('removeInstance', { id })
      setConfirming(false)
      await flow.refresh()
    } catch (failure) {
      setActionError(asApiError(failure))
    } finally {
      setBusyId(null)
    }
  }

  const statusErrorText = flow.statusError === null ? null : translateError(tr, flow.statusError)
  const errorText = flow.error === null ? null : translateError(tr, flow.error)
  const disconnectErrorText = disconnectError === null ? null : translateError(tr, disconnectError)
  const actionErrorText = actionError === null ? null : translateError(tr, actionError)

  const list = (
    <InstanceList
      tr={tr}
      instances={instances}
      busyId={busyId}
      onSwitch={switchTo}
      onRename={rename}
      onRemove={remove}
    />
  )

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
      {actionErrorText !== null ? (
        <div className="fm-alert" data-tone="danger">
          {actionErrorText}
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
      ) : null}

      {connected ? (
        <>
          {list}
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

      {connection === null || !connected ? (
        <>
          {pending !== null ? (
            <PairingCard
              tr={tr}
              pending={pending}
              now={flow.now}
              polling={flow.polling}
              onPoll={flow.pollNow}
              onCancel={flow.cancelPairing}
            />
          ) : (
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
          )}
          {instances.length > 0 ? list : null}
        </>
      ) : null}
    </div>
  )
}
