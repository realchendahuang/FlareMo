/**
 * 时间线顶部的编写框（网页版 WorkspaceComposer 的只读简化版）：
 * 纸卡 + 自动长高的 textarea + 右下角渐变发送按钮（Ember 唯一允许品牌渐变的地方）。
 *
 * 提交走 host 的 `createNote`；成功后清空、失败保留草稿。
 */

import React from 'react'

import { C, T } from './styles.js'
import { IconSend } from './icons.jsx'

/**
 * @param {{ tr: (key: string, vars?: object) => string,
 *   disabled?: boolean, pending?: boolean,
 *   onSubmit: (text: string) => Promise<void> }} props
 * @returns {React.ReactElement} the composer card.
 */
export function Composer({ tr, disabled = false, pending = false, onSubmit }) {
  const [value, setValue] = React.useState('')
  const ref = React.useRef(null)
  const canSubmit = disabled === false && pending === false && value.trim() !== ''

  React.useEffect(() => {
    const node = ref.current
    if (node === null) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 240)}px`
  }, [value])

  const submit = async () => {
    if (!canSubmit) return
    try {
      await onSubmit(value.trim())
      setValue('')
    } catch {
      /* 失败的提示由父组件负责；这里保留草稿 */
    }
  }

  return (
    <form
      className="fm-composer"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        value={value}
        disabled={disabled || pending}
        aria-label={tr('composePlaceholder')}
        placeholder={disabled ? tr('footerDisconnected') : tr('composePlaceholder')}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void submit()
          }
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...T.micro, color: C.textSecondary }}>
          {disabled ? tr('footerDisconnected') : pending ? tr('executorRunning') : tr('composeHint')}
        </span>
        <button
          type="submit"
          className="fm-send"
          disabled={!canSubmit}
          aria-label={tr('composeSend')}
          title={tr('composeSend')}
          style={{ marginLeft: 'auto' }}
        >
          <IconSend size={14} />
        </button>
      </div>
    </form>
  )
}
