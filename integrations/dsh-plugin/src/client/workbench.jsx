/**
 * FlareMo 面板：内嵌真实网页版。
 *
 * 面板里跑的是 host 反代出来的**同一个 FlareMo SPA 构建产物**，不是复刻的界面。
 * 因此网页版有的东西这里全有——时间线、富文本编辑器、评论、可见性、Spotlight
 * 搜索、时间视野、回顾、待办、文章、附件、语音、设置页——而且网页版改版后这里
 * 自动跟着变，不存在漂移。
 *
 * 数据怎么走：iframe 指向 `http://127.0.0.1:<port>`（{@link EmbedProxy}），
 * host 把每个请求转发到当前 active 实例并注入 device token。token 不出 host，
 * 浏览器侧只看到一个同源的本地页面。
 *
 * 这个组件只负责三件事：拿地址、处理未连接/不可用的降级、把 DSH 的深色标记
 * 传给 iframe（网页版自己按 `localStorage.theme` 或系统偏好决定主题，所以这里
 * 只在首次加载前把偏好写进去）。
 */

import React from 'react'

import { asApiError } from './api.js'
import { ConnectForm, PairingCard, useConnectFlow } from './connect.jsx'
import { createTranslator, translateError } from './i18n.js'
import { C, T } from './styles.js'
import { IconChevronLeft, IconRefresh, IconSparkle } from './icons.jsx'

/** 网页版读的主题键（apps/web/src/components/theme-provider.tsx）。 */
const THEME_STORAGE_KEY = 'theme'

/**
 * DSH 当前是不是深色。网页版支持 light/dark/system，这里把 DSH 的显式标记
 * 翻成其中一个值；没有标记时返回 null（交给网页版按系统偏好决定）。
 * @returns {'dark' | 'light' | null} explicit theme, or null.
 */
export function hostTheme() {
  if (typeof document === 'undefined') return null
  const attribute = document.body?.getAttribute('data-ds-dark-theme')
  if (attribute === 'true') return 'dark'
  if (attribute === 'false') return 'light'
  return null
}

/**
 * 连接引导（未连接 / 添加实例）。与设置页共用 connect.jsx 的状态机。
 * @param {object} props - see {@link ConnectGuide}.
 * @returns {React.ReactElement} the connect guide.
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
 * iframe 里的一次性主题提示：在网页版的文档脚本运行前把偏好写进它的
 * localStorage，避免先闪一下浅色。同源（都在 127.0.0.1）所以可以直接写。
 * @param {HTMLIFrameElement} frame - the embed frame.
 * @returns {void}
 */
function primeTheme(frame) {
  const theme = hostTheme()
  if (theme === null) return
  try {
    const storage = frame.contentWindow?.localStorage
    if (storage !== null && storage !== undefined) storage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* 跨源或还没导航完：网页版会退回系统偏好，不致命 */
  }
}

/**
 * 主面板。
 * @param {{ t?: (key: string) => string, call?: (method: string, args?: object) => Promise<object> }} props
 * @returns {React.ReactElement} the panel.
 */
export function Workbench({ t, call }) {
  const tr = React.useMemo(() => createTranslator(t), [t])
  const hasCall = typeof call === 'function'

  const [connection, setConnection] = React.useState(null)
  const [embedUrl, setEmbedUrl] = React.useState(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState(null)
  const [reloadKey, setReloadKey] = React.useState(0)
  /** iframe 自己的 key：切实例或刷新时换一个，强制重新加载文档。 */
  const [frameKey, setFrameKey] = React.useState(0)
  const [addingInstance, setAddingInstance] = React.useState(false)
  const frameRef = React.useRef(null)

  /** 上一次拿到的 active 实例 id；只用来判断「切实例了要重挂 iframe」。 */
  const lastActiveId = React.useRef(null)

  // 连接状态 + 嵌入地址。
  React.useEffect(() => {
    let live = true
    setLoading(true)
    setLoadError(null)
    ;(async () => {
      try {
        if (!hasCall) throw new Error('FlareMo 服务还没挂载')
        const status = await call('connectionStatus')
        if (!live) return
        const nextConnection = status?.connection ?? null
        setConnection(nextConnection)
        if (nextConnection?.connected !== true) {
          setEmbedUrl(null)
          lastActiveId.current = null
          return
        }
        const target = await call('embedTarget')
        if (!live) return
        const nextUrl = typeof target?.url === 'string' ? target.url : null
        // 只在实例真的换了（或第一次挂）时才换 key，避免每次刷状态都重载 iframe
        // ——那会把用户正在编辑的草稿一起冲掉。
        if (nextUrl !== null && (nextUrl !== embedUrl || nextConnection.activeId !== lastActiveId.current)) {
          setFrameKey((value) => value + 1)
        }
        lastActiveId.current = nextConnection.activeId ?? null
        setEmbedUrl(nextUrl)
      } catch (failure) {
        if (!live) return
        setLoadError(asApiError(failure))
        setConnection(null)
        setEmbedUrl(null)
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [call, hasCall, reloadKey, embedUrl])

  const refresh = React.useCallback(() => {
    setReloadKey((value) => value + 1)
  }, [])

  const connected = connection?.connected === true

  /** iframe 加载完成后补一次主题，覆盖「网页版已决定浅色」的时序。 */
  const onFrameLoad = React.useCallback(() => {
    if (frameRef.current !== null) primeTheme(frameRef.current)
  }, [])

  // 未连接：连接引导（含添加实例）。
  if (!loading && !connected) {
    return (
      <div className="dsh-flaremo-root" style={{ height: '100%', minHeight: 0 }}>
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
          <ConnectGuide
            tr={tr}
            loadError={loadError}
            onRetry={refresh}
            call={call}
            connection={connection}
            onConnected={() => setReloadKey((value) => value + 1)}
          />
        )}
      </div>
    )
  }

  return (
    <div
      className="dsh-flaremo-root"
      style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      {embedUrl === null ? (
        <div
          className="fm-scroll"
          style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: '56px 24px' }}
        >
          <div style={{ width: '100%', maxWidth: 520 }}>
            {loadError !== null ? (
              <div className="fm-alert" data-tone="danger" style={{ marginBottom: 12 }}>
                {`${tr('loadFailed')}：${translateError(tr, loadError)}`}
              </div>
            ) : null}
            <div className="fm-empty" style={{ padding: '0 0 20px' }}>
              <div className="fm-empty-icon">
                <IconSparkle size={18} />
              </div>
              <div className="fm-empty-title">{loading ? tr('loadingNotes') : tr('embedUnavailable')}</div>
              {loading ? null : (
                <p className="fm-empty-desc" style={{ margin: 0 }}>
                  {tr('embedUnavailableHint')}
                </p>
              )}
            </div>
            {loading ? null : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="fm-btn" data-variant="outline" data-size="sm" onClick={refresh}>
                  <IconRefresh size={14} />
                  {tr('guideRetry')}
                </button>
                <button
                  type="button"
                  className="fm-btn"
                  data-variant="ghost"
                  data-size="sm"
                  onClick={() => setAddingInstance(true)}
                >
                  {tr('addInstance')}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <iframe
          key={frameKey}
          ref={frameRef}
          src={embedUrl}
          title={tr('panel')}
          onLoad={onFrameLoad}
          // 网页版与面板同属一个本地源；不需要额外权限。
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
          style={{ flex: '1 1 auto', width: '100%', minHeight: 0, border: 0, display: 'block', background: C.bgBase }}
        />
      )}
    </div>
  )
}
