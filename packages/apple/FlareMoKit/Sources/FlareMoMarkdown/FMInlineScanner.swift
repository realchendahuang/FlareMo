//
//  FMInlineScanner.swift
//  FlareMoMarkdown
//
//  职责：把一段 Markdown 源码扫成 `FMSourceSpan` 列表，供编辑器（NSTextView / UITextView）
//  在每次按键后重算行内属性与行首标记的样式。纯函数、无 UI 依赖、无状态。
//
//  为什么手写扫描器，而不是复用 swift-markdown 的 AST：
//  1. **每次按键都要跑**。10KB 的备忘录走一遍 swift-markdown（Node 树 + cmark 回调 + 一堆
//     堆分配）在真机上要几十毫秒，打字会卡；手写单遍扫描是 O(n)、零 AST、零正则。
//  2. **AST 会丢掉标记符号本身的位置**。编辑器是「Markdown 源码 + 实时样式」：星号、反引号、
//     行首的 `## ` 都还留在文本里，需要给它们单独上色（或压暗），而 AST 只有「一段文字是加粗的」，
//     没有「`**` 这两个字符在源码的哪里」。块模型（`FMBlockParser`）才用 AST，那是阅读态。
//  3. **性能与容错都要可预期**。未闭合的 `**`、落单的反引号、跨行的行内标记一律不产生 span：
//     宁可这一行不上色，也不能错误地把后面全文吞进样式里。
//
//  扫描口径（与 Web 端 `react-markdown + remark-gfm + remark-breaks` 的渲染结果对齐）：
//  - 行内：`**粗**`、`*斜*`、`_斜_`、`***粗斜***`、`` `行内码` ``、`~~删除~~`、`[文字](url)`、`#标签`、
//    `==高亮==`（Apple 端扩展，Web 端没有此语法，只有编辑器会用到）。
//  - 块级：行首 `# ` 到 `###### `、`- ` / `* ` / `+ ` / `1. `、`> `、` ``` ` 围栏、`- [ ]` / `- [x]`。
//  - 行内标记不跨行（Web 端 CommonMark 的 emphasis 可以跨行，但备忘录里跨行的星号几乎都是
//    用户手滑，跨行上色比不上色更让人困惑；这一条是有意的取舍）。
//  - 转义：`\*` 里的星号不是标记；反斜杠只对 ASCII 标点生效（CommonMark 口径）。
//  - 围栏代码块内部：整段不上任何 span，只有围栏行本身产出 `codeFence`。
//
//  复杂度：一次 `Array(unicodeScalars)` 转换 + 一次宽字符下标表 + 一次顺序扫描，全部 O(n)。
//  同一行内「往后没有收尾标记」的失败结果会被记住（`failedClosers`），否则一串落单的开标记
//  会让每个标记都扫到行尾，退化成 O(n²)。
//

import Foundation

/// 行内 / 块级标记扫描器。
///
/// 用法：`FMInlineScanner.spans(in: memo.content)`，结果按源码位置递增排列；
/// 嵌套标记（`**粗 *斜* 体**`）先给外层、再给内层，编辑器按顺序叠加属性即可。
public enum FMInlineScanner {
    /// 扫描整段源码。空串返回空数组。
    public static func spans(in source: String) -> [FMSourceSpan] {
        guard !source.isEmpty else { return [] }
        var scanner = Scanner(source)
        return scanner.run()
    }
}

// MARK: - 实现

extension FMInlineScanner {
    /// 扫描器本体。`scalars` 一次转成数组：之后所有查找、回退都在连续内存上做，
    /// 不需要按 `String.Index` 逐字前进（那在大文本上会被 String 的编码处理拖慢）。
    struct Scanner {
        /// 行内标记最多向下钻几层（`**粗 *斜* 体**` 这种嵌套）。再深的当纯文本，
        /// 避免恶意输入把递归变成性能武器。
        static let maxNestingDepth = 4

        private let scalars: [Unicode.Scalar]
        private let scalarCount: Int
        /// 「需要 2 个 UTF-16 单元」的 scalar（emoji 等补充平面字符）下标，升序。
        /// UTF-16 偏移 = scalar 下标 + 它前面这类字符的个数，所以只存稀有字符即可，
        /// 不必为每个位置维护一张前缀表（纯中文/英文文本时这个数组是空的，换算零成本）。
        private let wideScalarIndices: [Int]
        private var spans: [FMSourceSpan] = []

        /// 本行已经确认「往后找不到收尾标记」的类别。换行时清零。
        /// 这是把「一串落单开标记」从 O(n²) 拉回 O(n) 的关键：一次失败的搜索对
        /// 更靠后的同种搜索必然也失败（收尾标记只会更少）。
        private var failedClosers: UInt32 = 0

        /// 记录一个「后面没有 `(`」的 `]` 位置，避免 `[[[[...]]]]` 这类输入反复搜同一个括号。
        private var bracketWithoutParen: Int = -1

        init(_ source: String) {
            let scalars = Array(source.unicodeScalars)
            self.scalars = scalars
            self.scalarCount = scalars.count
            var wide: [Int] = []
            for (index, scalar) in scalars.enumerated() where scalar.value > 0xFFFF {
                wide.append(index)
            }
            self.wideScalarIndices = wide
        }

        // MARK: 主循环

        mutating func run() -> [FMSourceSpan] {
            var lineStart = 0
            var fence: Fence?
            while lineStart < scalarCount {
                // 行内容区间 [lineStart, lineEnd)；CRLF 文件里的 `\r` 不算内容，
                // 否则围栏行的 span 会多出一个字符，闭围栏也永远匹配不上。
                let newline = newlineIndex(from: lineStart)
                var lineEnd = newline
                if lineEnd > lineStart, scalars[lineEnd - 1].value == 13 { lineEnd -= 1 }
                failedClosers = 0
                bracketWithoutParen = -1
                if let activeFence = fence {
                    // 围栏内部：只认闭围栏，正文整段跳过。
                    if let closing = closingFenceSpan(lineStart: lineStart, lineEnd: lineEnd, fence: activeFence) {
                        spans.append(closing)
                        fence = nil
                    }
                } else if let opening = openingFence(lineStart: lineStart, lineEnd: lineEnd) {
                    spans.append(opening.span)
                    fence = opening.fence
                } else {
                    let contentStart = blockPrefix(lineStart: lineStart, lineEnd: lineEnd)
                    if contentStart < lineEnd {
                        scanInline(from: contentStart, to: lineEnd, depth: 0)
                    }
                }
                lineStart = newline + 1
            }
            return spans
        }

        // MARK: 基础工具

        private func newlineIndex(from start: Int) -> Int {
            var index = start
            while index < scalarCount, scalars[index].value != 10 /* \n */ {
                index += 1
            }
            return index
        }

        /// scalar 下标 → UTF-16 偏移。
        private func utf16Offset(of scalarIndex: Int) -> Int {
            guard !wideScalarIndices.isEmpty else { return scalarIndex }
            var low = 0
            var high = wideScalarIndices.count
            while low < high {
                let middle = (low + high) / 2
                if wideScalarIndices[middle] < scalarIndex {
                    low = middle + 1
                } else {
                    high = middle
                }
            }
            return scalarIndex + low
        }

        private func makeSpan(from start: Int, to end: Int, kind: FMSpanKind) -> FMSourceSpan {
            let location = utf16Offset(of: start)
            return FMSourceSpan(
                location: location,
                length: utf16Offset(of: end) - location,
                kind: kind
            )
        }

        private mutating func appendSpan(from start: Int, to end: Int, _ kind: FMSpanKind) {
            guard end > start else { return }
            spans.append(makeSpan(from: start, to: end, kind: kind))
        }

        private func runLength(at position: Int, limit: Int, value: UInt32) -> Int {
            var length = 0
            while position + length < limit, scalars[position + length].value == value {
                length += 1
            }
            return length
        }

        private func firstIndex(of value: UInt32, from start: Int, limit: Int) -> Int? {
            var index = start
            while index < limit {
                if scalars[index].value == value { return index }
                index += 1
            }
            return nil
        }

        @inline(__always)
        private func isWhitespace(_ scalar: Unicode.Scalar) -> Bool {
            let value = scalar.value
            if value < 128 {
                return value == 32 || value == 9 || value == 10 || value == 13 || value == 11 || value == 12
            }
            return scalar.properties.isWhitespace
        }

        /// 字母 / 数字（不含 `_ - /`）。用于 `_` 的词内判定与标签边界。
        @inline(__always)
        private func isAlphanumeric(_ scalar: Unicode.Scalar) -> Bool {
            let value = scalar.value
            if value < 128 {
                return (value >= 97 && value <= 122)
                    || (value >= 65 && value <= 90)
                    || (value >= 48 && value <= 57)
            }
            return scalar.properties.isAlphabetic || scalar.properties.numericType != nil
        }

        /// 与 Web 端 `TAG_PATTERN` 的字符集一致：`[\p{L}\p{N}_\-/]`。
        @inline(__always)
        private func isTagScalar(_ scalar: Unicode.Scalar) -> Bool {
            let value = scalar.value
            if value < 128 {
                return (value >= 97 && value <= 122)
                    || (value >= 65 && value <= 90)
                    || (value >= 48 && value <= 57)
                    || value == 95 /* _ */
                    || value == 45 /* - */
                    || value == 47 /* / */
            }
            return scalar.properties.isAlphabetic || scalar.properties.numericType != nil
        }

        // MARK: 块级前缀

        /// 处理行首块级标记，返回行内扫描的起点。没有块级标记时返回第一个非缩进字符。
        ///
        /// 引用可以叠（`> > `），引用里的第一个内容标记（标题 / 列表 / 待办）也照常认，
        /// 所以 `> - [ ] 待办` 会得到引用 + 待办两个块级 span，和 Web 端的嵌套渲染一致。
        private mutating func blockPrefix(lineStart: Int, lineEnd: Int) -> Int {
            var position = lineStart
            var depth = 0
            while depth < 4 {
                var indent = 0
                // CommonMark 允许块级标记前最多 3 个空格；4 个空格是缩进代码，不当作标记。
                while position < lineEnd, indent < 3, scalars[position].value == 32 {
                    position += 1
                    indent += 1
                }
                guard position < lineEnd else { return position }
                let value = scalars[position].value
                if value == 62 /* > */, let contentStart = quotePrefix(at: position, lineEnd: lineEnd) {
                    position = contentStart
                    depth += 1
                    continue
                }
                switch value {
                case 35 /* # */:
                    if let contentStart = headingPrefix(at: position, lineEnd: lineEnd) { return contentStart }
                case 45 /* - */, 42 /* * */, 43 /* + */, 48...57 /* 0-9 */:
                    if let contentStart = listPrefix(at: position, lineEnd: lineEnd) { return contentStart }
                default:
                    break
                }
                return position
            }
            return position
        }

        private mutating func headingPrefix(at position: Int, lineEnd: Int) -> Int? {
            var run = 0
            while position + run < lineEnd, scalars[position + run].value == 35 { run += 1 }
            guard run >= 1, run <= 6 else { return nil }
            let afterHashes = position + run
            // `# ` 才是标题；`#标签`（中间没有空格）交给行内的标签扫描。
            if afterHashes < lineEnd {
                let separator = scalars[afterHashes].value
                guard separator == 32 || separator == 9 else { return nil }
            }
            // 对齐 Web 端 `remarkLiteralHashes`：只有 `#` 的空标题保留成字面量，不上色。
            var content = afterHashes
            while content < lineEnd, scalars[content].value == 32 || scalars[content].value == 9 { content += 1 }
            guard content < lineEnd else { return nil }
            let spanEnd = min(afterHashes + 1, lineEnd)
            appendSpan(from: position, to: spanEnd, .heading(level: run))
            return spanEnd
        }

        private mutating func quotePrefix(at position: Int, lineEnd: Int) -> Int? {
            var index = position
            while index < lineEnd, scalars[index].value == 62 /* > */ {
                index += 1
                if index < lineEnd, scalars[index].value == 32 { index += 1 }
            }
            guard index > position else { return nil }
            // 嵌套引用（`> > x`）合成一个 span：编辑器只管整段前缀的样式与缩进。
            appendSpan(from: position, to: index, .quoteMarker)
            return index
        }

        private func listMarkerEnd(at position: Int, lineEnd: Int) -> Int? {
            let value = scalars[position].value
            if value == 45 || value == 42 || value == 43 {
                guard position + 1 < lineEnd, scalars[position + 1].value == 32 else { return nil }
                return position + 2
            }
            if value >= 48, value <= 57 {
                var index = position
                while index < lineEnd, scalars[index].value >= 48, scalars[index].value <= 57, index - position < 9 {
                    index += 1
                }
                guard index < lineEnd else { return nil }
                let separator = scalars[index].value
                guard separator == 46 /* . */ || separator == 41 /* ) */ else { return nil }
                guard index + 1 < lineEnd, scalars[index + 1].value == 32 else { return nil }
                return index + 2
            }
            return nil
        }

        private mutating func listPrefix(at position: Int, lineEnd: Int) -> Int? {
            guard let markerEnd = listMarkerEnd(at: position, lineEnd: lineEnd) else { return nil }
            // 待办：`- [ ]` / `- [x]`。列表标记与复选框合成一个 span，避免同一段源码被两个
            // 块级 span 覆盖（编辑器叠加两次缩进会错位）。
            if markerEnd + 2 < lineEnd,
               scalars[markerEnd].value == 91 /* [ */,
               scalars[markerEnd + 2].value == 93 /* ] */
            {
                let state = scalars[markerEnd + 1].value
                if state == 32 || state == 120 /* x */ || state == 88 /* X */ {
                    let spanEnd = markerEnd + 3
                    appendSpan(from: position, to: spanEnd, .todoCheckbox(checked: state != 32))
                    return spanEnd
                }
            }
            appendSpan(from: position, to: markerEnd, .listMarker)
            return markerEnd
        }

        // MARK: 围栏

        struct Fence {
            let char: UInt32
            let length: Int
        }

        private func openingFence(lineStart: Int, lineEnd: Int) -> (span: FMSourceSpan, fence: Fence)? {
            var position = lineStart
            var indent = 0
            while position < lineEnd, indent < 3, scalars[position].value == 32 {
                position += 1
                indent += 1
            }
            guard position < lineEnd else { return nil }
            let value = scalars[position].value
            guard value == 96 /* ` */ || value == 126 /* ~ */ else { return nil }
            let run = runLength(at: position, limit: lineEnd, value: value)
            guard run >= 3 else { return nil }
            if value == 96 {
                // CommonMark：反引号围栏的 info string 里不能再有反引号，否则这行不是围栏。
                var index = position + run
                while index < lineEnd {
                    if scalars[index].value == 96 { return nil }
                    index += 1
                }
            }
            // 开围栏整行（含语言标记）都算 `codeFence`，编辑器把整行压暗即可。
            let span = makeSpan(from: position, to: lineEnd, kind: .codeFence)
            return (span, Fence(char: value, length: run))
        }

        private func closingFenceSpan(lineStart: Int, lineEnd: Int, fence: Fence) -> FMSourceSpan? {
            var position = lineStart
            var indent = 0
            while position < lineEnd, indent < 3, scalars[position].value == 32 {
                position += 1
                indent += 1
            }
            guard position < lineEnd, scalars[position].value == fence.char else { return nil }
            let run = runLength(at: position, limit: lineEnd, value: fence.char)
            guard run >= fence.length else { return nil }
            var index = position + run
            while index < lineEnd {
                let value = scalars[index].value
                // 空白（含 CRLF 文件里残留的 `\r`）之后不允许再有内容。
                if value != 32, value != 9, value != 13 { return nil }
                index += 1
            }
            return makeSpan(from: position, to: lineEnd, kind: .codeFence)
        }

        // MARK: 行内扫描

        /// 扫描 [start, end) 里的行内标记。递归范围永远在同一行内。
        private mutating func scanInline(from start: Int, to end: Int, depth: Int) {
            var index = start
            while index < end {
                let value = scalars[index].value
                if value < 128 {
                    switch value {
                    case 92:  // \
                        index += escapeLength(at: index, limit: end)
                    case 42, 95:  // * _
                        index = emphasis(at: index, limit: end, depth: depth)
                    case 96:  // `
                        index = codeSpan(at: index, limit: end)
                    case 126:  // ~
                        index = pairedMarker(
                            at: index, limit: end, depth: depth,
                            marker: 126, kind: .strikethrough, failBit: CloserBit.strikethrough
                        )
                    case 61:  // =
                        index = pairedMarker(
                            at: index, limit: end, depth: depth,
                            marker: 61, kind: .highlight, failBit: CloserBit.highlight
                        )
                    case 91:  // [
                        index = link(at: index, limit: end, depth: depth)
                    case 35:  // #
                        index = tag(at: index, limit: end)
                    default:
                        index += 1
                    }
                } else {
                    index += 1
                }
            }
        }

        /// 反斜杠转义：`\*` 不当作标记。只对 ASCII 标点生效（CommonMark 口径）。
        private func escapeLength(at position: Int, limit: Int) -> Int {
            guard position + 1 < limit else { return position + 1 }
            let value = scalars[position + 1].value
            guard value < 128, Self.escapableASCII.contains(value) else { return position + 1 }
            return position + 2
        }

        // MARK: 强调

        private mutating func emphasis(at position: Int, limit: Int, depth: Int) -> Int {
            let marker = scalars[position].value
            let isUnderscore = marker == 95
            let run = runLength(at: position, limit: limit, value: marker)
            // 词内 `_`（snake_case、1_000）不算强调，和 CommonMark 一致：
            // 用户写变量名时不该突然变斜体。
            if isUnderscore, position > 0, isAlphanumeric(scalars[position - 1]) {
                return position + run
            }
            let contentOpen = position + run
            guard contentOpen < limit, !isWhitespace(scalars[contentOpen]) else { return contentOpen }

            if run >= 3 {
                let bit = isUnderscore ? CloserBit.underscoreBoldItalic : CloserBit.starBoldItalic
                if failedClosers & bit == 0 {
                    if let closeStart = findCloser(
                        marker: marker, need: 3, from: position + 3, limit: limit, underscore: isUnderscore
                    ) {
                        return finishEmphasis(
                            spanStart: position + 3, closeStart: closeStart, marker: marker,
                            kind: .boldItalic, limit: limit, depth: depth
                        )
                    }
                    failedClosers |= bit
                }
            }
            if run >= 2 {
                let bit = isUnderscore ? CloserBit.underscoreBold : CloserBit.starBold
                if failedClosers & bit == 0 {
                    if let closeStart = findCloser(
                        marker: marker, need: 2, from: position + 2, limit: limit, underscore: isUnderscore
                    ) {
                        return finishEmphasis(
                            spanStart: position + 2, closeStart: closeStart, marker: marker,
                            kind: .bold, limit: limit, depth: depth
                        )
                    }
                    failedClosers |= bit
                }
            }
            let bit = isUnderscore ? CloserBit.underscoreItalic : CloserBit.starItalic
            if failedClosers & bit == 0 {
                if let closeStart = findCloser(
                    marker: marker, need: 1, from: position + 1, limit: limit, underscore: isUnderscore
                ) {
                    return finishEmphasis(
                        spanStart: position + 1, closeStart: closeStart, marker: marker,
                        kind: .italic, limit: limit, depth: depth
                    )
                }
                failedClosers |= bit
            }
            return contentOpen
        }

        private mutating func finishEmphasis(
            spanStart: Int, closeStart: Int, marker: UInt32, kind: FMSpanKind, limit: Int, depth: Int
        ) -> Int {
            let closeEnd = closeStart + runLength(at: closeStart, limit: limit, value: marker)
            if closeStart > spanStart {
                appendSpan(from: spanStart, to: closeStart, kind)
                if depth < Self.maxNestingDepth {
                    scanInline(from: spanStart, to: closeStart, depth: depth + 1)
                }
            }
            return closeEnd
        }

        /// 在一行里找可用的收尾标记，返回收尾标记的起点。
        /// 收尾标记前面不能是空白（`* 斜 *` 不是斜体），`_` 还要求后面不是字母数字。
        private func findCloser(marker: UInt32, need: Int, from start: Int, limit: Int, underscore: Bool) -> Int? {
            var index = start
            while index < limit {
                if scalars[index].value != marker {
                    index += 1
                    continue
                }
                let run = runLength(at: index, limit: limit, value: marker)
                if run >= need, index > 0, !isWhitespace(scalars[index - 1]) {
                    if !underscore || index + run >= limit || !isAlphanumeric(scalars[index + run]) {
                        return index
                    }
                }
                index += run
            }
            return nil
        }

        // MARK: 行内代码

        private mutating func codeSpan(at position: Int, limit: Int) -> Int {
            let run = runLength(at: position, limit: limit, value: 96)
            let bit = CloserBit.backtick(for: run)
            if failedClosers & bit != 0 { return position + run }
            var index = position + run
            while index < limit {
                if scalars[index].value != 96 {
                    index += 1
                    continue
                }
                let closeRun = runLength(at: index, limit: limit, value: 96)
                // CommonMark：反引号数量必须完全相等才算收尾。
                if closeRun == run {
                    appendSpan(from: position + run, to: index, .code)
                    return index + closeRun
                }
                index += closeRun
            }
            failedClosers |= bit
            return position + run
        }

        // MARK: 删除线 / 高亮

        private mutating func pairedMarker(
            at position: Int, limit: Int, depth: Int, marker: UInt32, kind: FMSpanKind, failBit: UInt32
        ) -> Int {
            let run = runLength(at: position, limit: limit, value: marker)
            // 只认「恰好两个」：GFM 的删除线不接受三个波浪线（`~~~x~~~` 在 Web 端是普通文字，
            // 行首的 `~~~` 更是围栏），`====` 也不该被当成高亮。
            guard run == 2 else { return position + run }
            let contentOpen = position + 2
            guard contentOpen < limit, !isWhitespace(scalars[contentOpen]) else { return contentOpen }
            if failedClosers & failBit != 0 { return contentOpen }
            guard let closeStart = findCloser(marker: marker, need: 2, from: contentOpen, limit: limit, underscore: false)
            else {
                failedClosers |= failBit
                return contentOpen
            }
            let closeEnd = closeStart + runLength(at: closeStart, limit: limit, value: marker)
            if closeStart > contentOpen {
                appendSpan(from: contentOpen, to: closeStart, kind)
                if depth < Self.maxNestingDepth {
                    scanInline(from: contentOpen, to: closeStart, depth: depth + 1)
                }
            }
            return closeEnd
        }

        // MARK: 链接

        private mutating func link(at position: Int, limit: Int, depth: Int) -> Int {
            if failedClosers & (CloserBit.link | CloserBit.linkParen) != 0 { return position + 1 }
            guard let bracket = firstIndex(of: 93 /* ] */, from: position + 1, limit: limit) else {
                failedClosers |= CloserBit.link
                return position + 1
            }
            if bracket == bracketWithoutParen { return position + 1 }
            guard bracket + 1 < limit, scalars[bracket + 1].value == 40 /* ( */ else {
                bracketWithoutParen = bracket
                return position + 1
            }
            guard let paren = firstIndex(of: 41 /* ) */, from: bracket + 2, limit: limit) else {
                // 这一行后面已经没有 `)`，更靠后的 `[` 也不可能配出链接。
                failedClosers |= CloserBit.linkParen
                return position + 1
            }
            let url = destination(from: bracket + 2, to: paren)
            if bracket > position + 1 {
                // 只给方括号里的文字上色；`[`、`](`、`)` 与 URL 是标记符号。
                appendSpan(from: position + 1, to: bracket, .link(url: url))
                if depth < Self.maxNestingDepth {
                    scanInline(from: position + 1, to: bracket, depth: depth + 1)
                }
            }
            return paren + 1
        }

        /// 解析 `[文字](这里)`。支持 `<url>` 与 `url "标题"` 两种 CommonMark 写法。
        private func destination(from start: Int, to end: Int) -> String? {
            var begin = start
            var finish = end
            while begin < finish, isWhitespace(scalars[begin]) { begin += 1 }
            while finish > begin, isWhitespace(scalars[finish - 1]) { finish -= 1 }
            guard begin < finish else { return nil }
            if scalars[begin].value == 60 /* < */ {
                begin += 1
                if finish > begin, scalars[finish - 1].value == 62 /* > */ { finish -= 1 }
            }
            // 标题（`"..."`）从第一个空白之后开始，URL 到第一个空白为止。
            var firstSpace = begin
            while firstSpace < finish, !isWhitespace(scalars[firstSpace]) { firstSpace += 1 }
            finish = firstSpace
            guard begin < finish else { return nil }
            let text = String(String.UnicodeScalarView(scalars[begin..<finish]))
            return text.isEmpty ? nil : text
        }

        // MARK: 标签

        private mutating func tag(at position: Int, limit: Int) -> Int {
            // 边界和 Web 端 `TAG_PATTERN` 一致：`#` 前面不能是标签字符（`v1.2#12` 不算标签）。
            if position > 0, isTagScalar(scalars[position - 1]) { return position + 1 }
            var index = position + 1
            guard index < limit, isTagScalar(scalars[index]) else { return position + 1 }
            while index < limit, isTagScalar(scalars[index]) { index += 1 }
            // 结尾的 `/` 是标点：`#tag/` 的标签名是 `tag`。
            var end = index
            while end > position + 1, scalars[end - 1].value == 47 { end -= 1 }
            if end > position + 1 {
                let text = String(String.UnicodeScalarView(scalars[position..<end]))
                appendSpan(from: position, to: end, .tag(text))
            }
            return index
        }

        // MARK: 失败备忘录的位定义

        private enum CloserBit {
            static let starBoldItalic: UInt32 = 1 << 0
            static let starBold: UInt32 = 1 << 1
            static let starItalic: UInt32 = 1 << 2
            static let underscoreBoldItalic: UInt32 = 1 << 3
            static let underscoreBold: UInt32 = 1 << 4
            static let underscoreItalic: UInt32 = 1 << 5
            static let strikethrough: UInt32 = 1 << 6
            static let highlight: UInt32 = 1 << 7
            static let link: UInt32 = 1 << 8
            static let linkParen: UInt32 = 1 << 9

            /// 反引号按长度分位（1…9+），落在 bit 18…26。
            static func backtick(for run: Int) -> UInt32 {
                1 << UInt32(18 + min(run, 9))
            }
        }

        /// CommonMark 允许被反斜杠转义的 ASCII 标点。
        static let escapableASCII: Set<UInt32> = Set(
            "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".unicodeScalars.map(\.value)
        )
    }
}
