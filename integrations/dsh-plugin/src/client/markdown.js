/**
 * 极简 Markdown → 块数组（不生成 HTML，交给 React 渲染）。
 *
 * FlareMo 的笔记正文是 Markdown；工作台的详情栏需要“像笔记”的排版：
 * 标题、段落、列表、引用、代码块、分隔线。这里只做块级解析，
 * 行内语法（粗体/链接/行内代码）在列表摘要里用 connection.stripMarkdown 处理，
 * 正文里保留原样（原样显示比错误的行内解析更好）。
 *
 * 不做的事：嵌套列表、表格、HTML 透传、脚注 —— 第一版不需要，也避免 XSS 面。
 */

/** 单条笔记最多渲染的块数：再长的正文也不该让面板卡顿。 */
export const MAX_BLOCKS = 400

const FENCE = /^(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)\s*$/
const HEADING = /^(#{1,6})\s+(.+)$/
const DIVIDER = /^(-{3,}|\*{3,}|_{3,})$/
const UL_ITEM = /^[-*+]\s+(.*)$/
const OL_ITEM = /^\d+[.)]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/

/** 这一行会不会打断段落。 */
function startsBlock(line) {
  const trimmed = line.trim()
  if (trimmed === '') return true
  return (
    FENCE.test(trimmed) ||
    HEADING.test(trimmed) ||
    DIVIDER.test(trimmed) ||
    UL_ITEM.test(trimmed) ||
    OL_ITEM.test(trimmed) ||
    QUOTE.test(trimmed)
  )
}

/**
 * 把 Markdown 正文解析成块数组。
 * @param {unknown} markdown - raw memo content.
 * @returns {Array<object>} blocks rendered by the workbench.
 */
export function parseContent(markdown) {
  const lines = String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  /** @type {Array<object>} */
  const blocks = []
  let index = 0

  const push = (block) => {
    if (blocks.length < MAX_BLOCKS) blocks.push(block)
  }

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (trimmed === '') {
      index += 1
      continue
    }

    // 代码块：``` / ~~~，直到同种围栏闭合
    const fence = FENCE.exec(trimmed)
    if (fence !== null) {
      const marker = fence[1]
      const lang = fence[2] ?? ''
      const body = []
      index += 1
      while (index < lines.length && lines[index].trim().startsWith(marker) === false) {
        body.push(lines[index])
        index += 1
      }
      index += 1 // 吃掉闭合围栏（没有闭合就吃到结尾）
      push({ type: 'code', lang, text: body.join('\n') })
      continue
    }

    if (DIVIDER.test(trimmed)) {
      push({ type: 'divider' })
      index += 1
      continue
    }

    const heading = HEADING.exec(trimmed)
    if (heading !== null) {
      push({ type: 'heading', level: heading[1].length, text: heading[2].trim() })
      index += 1
      continue
    }

    // 引用：连续的 > 行合成一段
    if (QUOTE.test(trimmed)) {
      const body = []
      while (index < lines.length && QUOTE.test(lines[index].trim())) {
        body.push(QUOTE.exec(lines[index].trim())[1])
        index += 1
      }
      push({ type: 'quote', text: body.join('\n').trim() })
      continue
    }

    // 列表：连续的同类条目合成一个 list；缩进的续行并进当前条目
    const ul = UL_ITEM.exec(trimmed)
    const ol = OL_ITEM.exec(trimmed)
    if (ul !== null || ol !== null) {
      const ordered = ul === null
      const items = []
      while (index < lines.length) {
        const current = lines[index]
        const currentTrimmed = current.trim()
        const item = ordered ? OL_ITEM.exec(currentTrimmed) : UL_ITEM.exec(currentTrimmed)
        if (item !== null) {
          items.push(item[1].trim())
          index += 1
          continue
        }
        // 缩进续行：接在当前条目后面；空行或新块则结束
        if (currentTrimmed === '' || startsBlock(currentTrimmed) === false && /^\s+/.test(current) === false) break
        if (/^\s+/.test(current) && items.length > 0) {
          items[items.length - 1] = `${items[items.length - 1]} ${currentTrimmed}`.trim()
          index += 1
          continue
        }
        break
      }
      push({ type: 'list', ordered, items })
      continue
    }

    // 段落：吃到空行或下一个块开始
    const paragraph = [trimmed]
    index += 1
    while (index < lines.length && !startsBlock(lines[index])) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    push({ type: 'p', text: paragraph.join('\n') })
  }

  return blocks
}

/** 正文纯文本（复制/计数用）。 */
export function plainText(markdown) {
  return String(markdown ?? '').replace(/\r\n?/g, '\n')
}
