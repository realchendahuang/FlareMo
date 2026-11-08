//
//  FMBlockParser.swift
//  FlareMoMarkdown
//
//  职责：把 Markdown 源码解析成阅读态块模型 `FMBlock`（卡片 / 详情 / 回顾用）。
//
//  这里**可以也应该**用 swift-markdown：阅读态不需要「标记符号在源码哪里」，只要「渲染结果
//  是什么」；swift-markdown 的 cmark-gfm 已经处理了嵌入、缩进、表格、列表缩进这些恶心细节。
//  编辑器那条路径（`FMInlineScanner`）不能这么干，原因写在那个文件顶部。
//
//  口径（对齐 Web 端 `MemoContent` 的 react-markdown + remark-gfm + remark-breaks）：
//  - 软换行保留成换行（`\n`），这是 flomo 的习惯，也是备忘录「保持原样」的语义。
//  - `#标签` 不特殊渲染：标签是查询维度，不是排版语法。Web 端的标签 chip 是 remark 插件加的，
//    阅读态这里只当普通文字，点击跳转由视图层用 `FMInlineScanner` 的 `tag` span 自己决定。
//  - 不做代码高亮（§5.6 明写 v1 不做）。
//  - 没有对应 case 的语法降级成文字而不是丢弃：表格每行是一段段落、图片只留 alt 文本、
//    HTML 直接丢（Web 端 `skipHtml` 也是丢）。
//

import Foundation
import Markdown

/// 阅读态块解析器。
public enum FMBlockParser {
    /// 产出块模型。块里的 span 偏移相对块内容文本，块文本请用 `contents(in:)` 一起取。
    public static func blocks(in source: String) -> [FMBlock] {
        contents(in: source).map(\.block)
    }

    /// 产出「块 + 块文本」的成对结果。渲染器应该用这个：
    /// 只拿 `FMBlock` 是画不出字的（span 只有偏移，没有文字）。
    public static func contents(in source: String) -> [FMBlockContent] {
        guard !source.isEmpty else { return [] }
        let document = Document(parsing: source)
        var output: [FMBlockContent] = []
        for child in document.children {
            collect(block: child, into: &output)
        }
        return output
    }
}

// MARK: - 行内收集

extension FMBlockParser {
    /// 把一段行内节点收集成「文本 + span」。所有偏移相对收集出来的这段文本。
    struct InlineCollector {
        var text: String
        var spans: [FMInlineSpan]
        var utf16Length: Int

        init() {
            self.text = ""
            self.spans = []
            self.utf16Length = 0
        }

        init(text: String) {
            self.text = text
            self.spans = []
            self.utf16Length = text.utf16.count
        }

        mutating func append(_ string: String) {
            guard !string.isEmpty else { return }
            text += string
            utf16Length += string.utf16.count
        }

        /// 把软换行折成空格。列表项和引用行必须「一个元素一行」，而段落里的软换行
        /// （`- 第一行\n  第二行` 这种续行）折成空格才读得顺。
        /// 长度不变（`\n` 与空格都是 1 个 UTF-16 单元），span 偏移不用动。
        mutating func collapseSoftBreaks() {
            guard text.contains("\n") else { return }
            text = text.replacingOccurrences(of: "\n", with: " ")
        }

        /// 合并另一段收集好的内容（嵌套列表项压平时用）。
        mutating func append(_ other: InlineCollector) {
            guard !other.text.isEmpty else { return }
            let offset = utf16Length
            text += other.text
            utf16Length += other.utf16Length
            spans.append(
                contentsOf: other.spans.map {
                    FMInlineSpan(location: $0.location + offset, length: $0.length, kind: $0.kind)
                }
            )
        }

        /// 去掉开头 `count` 个 UTF-16 单元并前移所有 span 偏移。
        mutating func dropPrefix(_ count: Int) {
            guard count > 0, count <= utf16Length else { return }
            text.removeFirst(count)
            utf16Length -= count
            spans = spans.compactMap { span in
                if span.end <= count { return nil }
                if span.location >= count {
                    return FMInlineSpan(location: span.location - count, length: span.length, kind: span.kind)
                }
                return FMInlineSpan(location: 0, length: span.end - count, kind: span.kind)
            }
        }

        mutating func addSpan(from start: Int, to end: Int, _ kind: FMSpanKind) {
            guard end > start else { return }
            spans.append(FMInlineSpan(location: start, length: end - start, kind: kind))
        }

        /// 按位置排序，起始位置相同的外层优先（`**[x](u)**` 这种同一段文字套两层样式）。
        mutating func sortSpans() {
            guard spans.count > 1 else { return }
            spans.sort { first, second in
                if first.location != second.location { return first.location < second.location }
                return first.length > second.length
            }
        }
    }

    static func collectInline(_ node: Markup, into collector: inout InlineCollector) {
        if let text = node as? Markdown.Text {
            collector.append(text.string)
        } else if let code = node as? InlineCode {
            let start = collector.utf16Length
            collector.append(code.code)
            collector.addSpan(from: start, to: collector.utf16Length, .code)
        } else if let link = node as? Link {
            let start = collector.utf16Length
            for child in link.children {
                collectInline(child, into: &collector)
            }
            collector.addSpan(from: start, to: collector.utf16Length, .link(url: link.destination))
        } else if let image = node as? Image {
            // 块模型没有图片 case，v1 只显示附件占位：这里退化成 alt 文本（没有 alt 时用地址）。
            let alt = plainText(of: image.children)
            collector.append(alt.isEmpty ? (image.source ?? "") : alt)
        } else if let strong = node as? Strong {
            collectEmphasis(Array(strong.children), fallbackKind: .bold, into: &collector)
        } else if let emphasis = node as? Emphasis {
            collectEmphasis(Array(emphasis.children), fallbackKind: .italic, into: &collector)
        } else if node is Strikethrough {
            let start = collector.utf16Length
            for child in node.children {
                collectInline(child, into: &collector)
            }
            collector.addSpan(from: start, to: collector.utf16Length, .strikethrough)
        } else if node is SoftBreak || node is LineBreak {
            // flomo 的习惯：软换行就是换行，不折成一个空格。
            collector.append("\n")
        } else if node is InlineHTML {
            // Web 端 `skipHtml`：内联 HTML 不渲染。
        } else if let symbol = node as? SymbolLink {
            collector.append(symbol.destination ?? "")
        } else if let custom = node as? CustomInline {
            let children = Array(custom.children)
            if children.isEmpty {
                collector.append(custom.text)
            } else {
                for child in children {
                    collectInline(child, into: &collector)
                }
            }
        } else {
            let children = Array(node.children)
            if children.isEmpty {
                collector.append(node.format())
            } else {
                for child in children {
                    collectInline(child, into: &collector)
                }
            }
        }
    }

    /// `**粗**` / `*斜*`。`***粗斜***` 在 AST 里是 Strong 套 Emphasis（或反过来），
    /// 这里合成一个 `.boldItalic` span，保证与编辑器扫描器的种类一致。
    static func collectEmphasis(_ children: [Markup], fallbackKind: FMSpanKind, into collector: inout InlineCollector) {
        let start = collector.utf16Length
        if children.count == 1, let inner = combinedEmphasisChildren(children[0]) {
            for child in inner {
                collectInline(child, into: &collector)
            }
            collector.addSpan(from: start, to: collector.utf16Length, .boldItalic)
            return
        }
        for child in children {
            collectInline(child, into: &collector)
        }
        collector.addSpan(from: start, to: collector.utf16Length, fallbackKind)
    }

    /// `***粗斜***`：外层是 Strong 里只套一个 Emphasis（或反过来）。返回内层子节点。
    static func combinedEmphasisChildren(_ node: Markup) -> [Markup]? {
        if let strong = node as? Strong {
            let children = Array(strong.children)
            if children.count == 1 { return children }
        }
        if let emphasis = node as? Emphasis {
            let children = Array(emphasis.children)
            if children.count == 1 { return children }
        }
        return nil
    }

    /// 只取文字（不加 span）。用于图片 alt、表格单元格这类「没有样式语义」的地方。
    static func plainText(of children: some Sequence<Markup>) -> String {
        var collector = InlineCollector()
        for child in children {
            collectInline(child, into: &collector)
        }
        return collector.text
    }
}

// MARK: - 块收集

extension FMBlockParser {
    static func collect(block: Markup, into output: inout [FMBlockContent]) {
        if let paragraph = block as? Paragraph {
            let collector = inlineCollector(paragraph.children)
            output.append(FMBlockContent(block: .paragraph(collector.spans), text: collector.text))
        } else if let heading = block as? Heading {
            let collector = inlineCollector(heading.children)
            output.append(
                FMBlockContent(block: .heading(level: heading.level, spans: collector.spans), text: collector.text)
            )
        } else if let list = block as? UnorderedList {
            collect(list: list, ordered: false, into: &output)
        } else if let list = block as? OrderedList {
            collect(list: list, ordered: true, into: &output)
        } else if let quote = block as? BlockQuote {
            var builder = LinesBuilder()
            appendQuoteBlocks(quote.children, into: &builder)
            output.append(FMBlockContent(block: .quote(builder.lines), text: builder.text))
        } else if let codeBlock = block as? CodeBlock {
            let code = trimTrailingNewline(codeBlock.code)
            output.append(
                FMBlockContent(
                    block: .codeBlock(language: normalizedLanguage(codeBlock.language), code: code),
                    text: code
                )
            )
        } else if block is ThematicBreak {
            output.append(FMBlockContent(block: .divider, text: ""))
        } else if let table = block as? Table {
            // 块模型没有表格 case：每行退化成一段文字，单元格之间用 " | " 隔开。
            var rows: [[String]] = [table.head.cells.map { plainText(of: $0.children) }]
            for row in table.body.rows {
                rows.append(row.cells.map { plainText(of: $0.children) })
            }
            for cells in rows {
                var collector = InlineCollector()
                collector.append(cells.joined(separator: " | "))
                output.append(FMBlockContent(block: .paragraph(collector.spans), text: collector.text))
            }
        } else if block is HTMLBlock {
            // Web 端 `skipHtml`：HTML 块丢弃。
        } else if let document = block as? Document {
            for child in document.children {
                collect(block: child, into: &output)
            }
        } else {
            let children = Array(block.children)
            if children.isEmpty {
                // 没有子节点的未知块没有可渲染的文字，直接丢（与 Web 端「不认识就不显示」一致）。
                return
            } else if children.contains(where: { $0 is BlockMarkup }) {
                for child in children {
                    collect(block: child, into: &output)
                }
            } else {
                let collector = inlineCollector(children)
                output.append(FMBlockContent(block: .paragraph(collector.spans), text: collector.text))
            }
        }
    }

    static func inlineCollector(_ children: some Sequence<Markup>) -> InlineCollector {
        var collector = InlineCollector()
        for child in children {
            collectInline(child, into: &collector)
        }
        collector.sortSpans()
        return collector
    }

    // MARK: 列表

    static func collect(list: some BlockMarkup, ordered: Bool, into output: inout [FMBlockContent]) {
        var group: [InlineCollector] = []
        func flushGroup() {
            guard !group.isEmpty else { return }
            var builder = LinesBuilder()
            for collector in group {
                builder.add(collector)
            }
            output.append(
                FMBlockContent(block: ordered ? .orderedList(builder.lines) : .bulletList(builder.lines), text: builder.text)
            )
            group.removeAll(keepingCapacity: true)
        }
        for child in list.children {
            guard let item = child as? ListItem else { continue }
            let line = listItemLine(item)
            if let checkbox = item.checkbox {
                // 模型里待办是顶层块（与 `bulletList` 平级），所以待办项单独成块，
                // 同级的普通项按连续的组各自并成一个列表块。
                flushGroup()
                output.append(
                    FMBlockContent(block: .todo(checked: checkbox == .checked, spans: line.spans), text: line.text)
                )
            } else {
                group.append(line)
            }
        }
        flushGroup()
    }

    /// 一个列表项 = 一行。项里有多段（或嵌套列表）时用空格连接，保证「项数与行数」始终对得上。
    static func listItemLine(_ item: ListItem) -> InlineCollector {
        var collector = InlineCollector()
        var isFirst = true
        for child in item.children {
            if !isFirst { collector.append(" ") }
            isFirst = false
            appendBlockText(child, into: &collector)
        }
        collector.collapseSoftBreaks()
        // 引用 / 嵌套位置里的待办列表：cmark 在那里的 ListItem 不带 checkbox 元数据，
        // 文字会留下 `[ ] ` 前缀。阅读态不显示复选框，统一剥掉，读起来才是纯文字。
        for prefix in ["[ ] ", "[x] ", "[X] "] where collector.text.hasPrefix(prefix) {
            collector.dropPrefix(prefix.utf16.count)
            break
        }
        collector.sortSpans()
        return collector
    }

    /// 把一个块里的文字按「行内内容」压平（列表项、引用里遇到嵌套结构时用）。
    static func appendBlockText(_ block: Markup, into collector: inout InlineCollector) {
        if let paragraph = block as? Paragraph {
            for child in paragraph.children {
                collectInline(child, into: &collector)
            }
        } else if let heading = block as? Heading {
            for child in heading.children {
                collectInline(child, into: &collector)
            }
        } else if let code = block as? CodeBlock {
            collector.append(trimTrailingNewline(code.code))
        } else if let item = block as? ListItem {
            // 压平的嵌套列表项同样走「一项一行」的规则（软换行折空格、剥掉残留的复选框前缀）。
            collector.append(listItemLine(item))
        } else if block is ThematicBreak || block is HTMLBlock {
            // 列表项 / 引用里的分割线与 HTML 没有可显示的文字。
        } else {
            var isFirst = true
            for child in block.children {
                if !isFirst { collector.append(" ") }
                isFirst = false
                appendBlockText(child, into: &collector)
            }
        }
    }

    // MARK: 引用

    static func appendQuoteBlocks(_ children: some Sequence<Markup>, into builder: inout LinesBuilder) {
        for child in children {
            if let paragraph = child as? Paragraph {
                var collector = inlineCollector(paragraph.children)
                // 引用行同样一行一元素：段落里的软换行折成空格。
                collector.collapseSoftBreaks()
                builder.add(collector)
            } else if let heading = child as? Heading {
                builder.add(inlineCollector(heading.children))
            } else if let list = child as? UnorderedList {
                appendQuoteListItems(list.children, into: &builder)
            } else if let list = child as? OrderedList {
                appendQuoteListItems(list.children, into: &builder)
            } else if let nested = child as? BlockQuote {
                appendQuoteBlocks(nested.children, into: &builder)
            } else if let code = child as? CodeBlock {
                builder.addPlainLine(trimTrailingNewline(code.code))
            } else if let table = child as? Table {
                // 引用里的表格同样降级成每行一段文字。
                var rows: [[String]] = [table.head.cells.map { plainText(of: $0.children) }]
                for row in table.body.rows {
                    rows.append(row.cells.map { plainText(of: $0.children) })
                }
                for cells in rows {
                    builder.addPlainLine(cells.joined(separator: " | "))
                }
            } else if child is ThematicBreak || child is HTMLBlock {
                continue
            } else {
                var collector = InlineCollector()
                appendBlockText(child, into: &collector)
                if !collector.text.isEmpty {
                    builder.add(collector)
                }
            }
        }
    }

    static func appendQuoteListItems(_ children: some Sequence<Markup>, into builder: inout LinesBuilder) {
        for child in children {
            guard let item = child as? ListItem else { continue }
            builder.add(listItemLine(item))
        }
    }

    // MARK: 工具

    /// 多行块（列表 / 引用）的构建器：负责把每行文本与偏移拼到一起。
    struct LinesBuilder {
        var lines: [[FMInlineSpan]] = []
        var text = ""
        private var utf16Length = 0

        mutating func add(_ collector: InlineCollector) {
            if !lines.isEmpty {
                text += "\n"
                utf16Length += 1
            }
            let offset = utf16Length
            text += collector.text
            utf16Length += collector.text.utf16.count
            lines.append(
                collector.spans.map {
                    FMInlineSpan(location: $0.location + offset, length: $0.length, kind: $0.kind)
                }
            )
        }

        mutating func addPlainLine(_ line: String) {
            add(InlineCollector(text: line))
        }
    }

    static func trimTrailingNewline(_ code: String) -> String {
        // cmark 的代码块内容总带一个收尾换行；去掉它，渲染时行数才对。
        guard code.hasSuffix("\n") else { return code }
        return String(code.dropLast())
    }

    /// 围栏后面的 info string 只取第一个词当语言（```` ```swift title=x ```` → `swift`），
    /// 与 CommonMark / Web 端高亮插件取语言的口径一致。
    static func normalizedLanguage(_ language: String?) -> String? {
        guard let language else { return nil }
        let trimmed = language.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return trimmed.split(whereSeparator: { $0.isWhitespace }).first.map(String.init)
    }
}
