//
//  FMBlockView.swift
//  FlareMoUI
//
//  职责：阅读态（详情页 / 回顾 / 卡片展开）的 Markdown 渲染 —— 把
//  `FMBlockParser.contents(in:)` 产出的块模型画成 SwiftUI 视图。
//
//  为什么需要它：列表卡片用 `AttributedString(markdown:)` 的 inline-only 模式就够了
//  （一条速记基本是一段话），但详情页要真的排版：标题分级、列表的悬挂缩进、
//  引用竖线、代码块、分隔线、待办勾选框 —— 这些 inline-only 的 AttributedString
//  给不了。块模型由 `FlareMoMarkdown` 解析（cmark-gfm），这里只负责画。
//
//  设计约束（对齐 docs/native-clients.md §5.6）：
//  - **宽度由外部决定**：内部只用 `frame(maxWidth: .infinity)`，不读窗口/屏幕尺寸，
//    同一份文档在任何宽度下重排，快照可控；
//  - **无异步、无状态**：不加载图片、不发请求、不持有 `@State`；待办只画状态，
//    点击改内容是后续任务（这里刻意不加手势，避免和详情页的文本选择抢事件）；
//  - **颜色/字号/间距全部来自 FlareMoDesign token**，见 `FMReadingMetrics` / `FMReadingPalette`；
//  - **v1 不做代码高亮**（§5.6 明写），代码块只保证等宽、可选中、不折行错位。
//
//  与 Web 端的两处已知差异（有意）：
//  1. 标签用 `brand500` 文字色而不是 Web 的灰底圆角 chip —— AttributedString 画不出
//     圆角 chip，且编辑器 `FMEditorStyler` 已经把标签定为 `brand500`，阅读态跟着走；
//  2. 连续空行不保留：块模型把 `\n\n` 折叠成段落分隔（Web 端 `protectLiteralLayout`
//     会把多余空行渲染成空段落）。要保留得给块模型加一个空行块，属 parser 改动，
//     当前任务不动 Markdown 模块。
//

import FlareMoDesign
import FlareMoMarkdown
import SwiftUI

/// 阅读态 Markdown 视图。
///
/// 最省事的用法：`FMBlockView(markdown: memo.content)`。
/// 详情页建议先在模型层把 `FMBlockParser.contents(in:)` 的结果缓存下来，
/// 再用 `FMBlockView(contents:)`，避免每次 body 求值都重新解析。
public struct FMBlockView: View {
    /// 已解析好的块（每块带自己的内容文本，span 偏移相对这段文本）。
    public let contents: [FMBlockContent]

    /// 直接渲染 Markdown 源码。
    public init(markdown: String) {
        self.init(contents: FMBlockParser.contents(in: markdown))
    }

    /// 渲染已经解析好的块。
    public init(contents: [FMBlockContent]) {
        self.contents = contents
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(contents.enumerated()), id: \.offset) { index, content in
                blockView(content)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(
                        .top,
                        FMReadingMetrics.spacing(
                            previous: index > 0 ? contents[index - 1].block : nil,
                            current: content.block
                        )
                    )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }

    // MARK: - 分派

    @ViewBuilder
    private func blockView(_ content: FMBlockContent) -> some View {
        switch content.block {
        case .paragraph:
            paragraph(content)
        case let .heading(level, _):
            inlineText(
                content.text,
                spans: inlineSpans(of: content),
                style: FMReadingMetrics.heading(level: level),
                color: palette.body
            )
            .accessibilityAddTraits(.isHeader)
        case let .bulletList(lines):
            list(content, count: lines.count, ordered: false)
        case let .orderedList(lines):
            list(content, count: lines.count, ordered: true)
        case .quote:
            quote(content)
        case let .codeBlock(_, code):
            codeBlock(code)
        case .divider:
            divider
        case let .todo(checked, _):
            todo(content, checked: checked)
        }
    }

    // MARK: - 块

    private func paragraph(_ content: FMBlockContent) -> some View {
        inlineText(
            content.text,
            spans: inlineSpans(of: content),
            style: FMReadingMetrics.body,
            color: palette.body
        )
    }

    /// 列表：标记与正文用第一行基线对齐，正文换行后挂在标记右侧（悬挂缩进），
    /// 而不是用 SwiftUI 的默认缩进把标记也推着走。
    private func list(_ content: FMBlockContent, count: Int, ordered: Bool) -> some View {
        VStack(alignment: .leading, spacing: FMReadingMetrics.listItemSpacing) {
            ForEach(0..<count, id: \.self) { index in
                if let line = content.line(at: index) {
                    HStack(alignment: .firstTextBaseline, spacing: FMReadingMetrics.listMarkerSpacing) {
                        listMarker(index: index, count: count, ordered: ordered)
                        inlineText(
                            line.text,
                            spans: line.spans,
                            style: FMReadingMetrics.body,
                            color: palette.body
                        )
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }

    private func listMarker(index: Int, count: Int, ordered: Bool) -> some View {
        Group {
            if ordered {
                Text("\(index + 1).")
                    .font(FMReadingMetrics.body.font.monospacedDigit())
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                    .frame(width: FMReadingMetrics.orderedMarkerWidth(count: count), alignment: .trailing)
            } else {
                Text("•")
                    .font(FMReadingMetrics.body.font)
                    .frame(width: FMReadingMetrics.bulletWidth, alignment: .leading)
            }
        }
        .foregroundStyle(palette.listMarker)
        .accessibilityHidden(true)
    }

    /// 引用：左侧 3pt 竖线 + 稍浅的文字色（Web `border-s-2 border-primary/45 text-muted-foreground`）。
    private func quote(_ content: FMBlockContent) -> some View {
        inlineText(
            content.text,
            spans: inlineSpans(of: content),
            style: FMReadingMetrics.body,
            color: palette.secondary
        )
        .padding(.leading, FMReadingMetrics.quoteBarSpacing)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: FMReadingMetrics.quoteBarWidth / 2, style: .continuous)
                .fill(palette.quoteBar)
                .frame(width: FMReadingMetrics.quoteBarWidth)
        }
    }

    /// 代码块：等宽 13 / 20 + 卡片色底 + 圆角 8 + 内边距 10（v1 不做语法高亮）。
    /// 代码永远 LTR —— 阿拉伯语环境下 RTL 会把括号和运算符镜像过去（Web 端同样处理）。
    private func codeBlock(_ code: String) -> some View {
        Text(code.isEmpty ? "\u{00A0}" : code)
            .font(FMReadingMetrics.codeFont)
            .foregroundStyle(palette.body)
            .lineSpacing(FMReadingMetrics.code.resolvedLineSpacing)
            .multilineTextAlignment(.leading)
            .environment(\.layoutDirection, .leftToRight)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(FMReadingMetrics.codeBlockPadding)
            .background {
                RoundedRectangle(cornerRadius: FMReadingMetrics.codeBlockRadius, style: .continuous)
                    .fill(palette.codeBackground)
            }
            .overlay {
                RoundedRectangle(cornerRadius: FMReadingMetrics.codeBlockRadius, style: .continuous)
                    .strokeBorder(palette.codeBorder, lineWidth: 1)
            }
    }

    /// 分隔线：1pt 发丝线，上下留白。
    private var divider: some View {
        Rectangle()
            .fill(palette.divider)
            .frame(height: FMReadingMetrics.dividerWidth)
            .frame(maxWidth: .infinity)
            .padding(.vertical, FMReadingMetrics.dividerInset)
            .accessibilityHidden(true)
    }

    /// 待办：只画勾选状态，不加手势（点击改内容是后续任务）。
    private func todo(_ content: FMBlockContent, checked: Bool) -> some View {
        HStack(alignment: .top, spacing: FMReadingMetrics.listMarkerSpacing) {
            todoBox(checked: checked)
                .padding(.top, FMReadingMetrics.todoBoxTopInset)
            inlineText(
                content.text,
                spans: inlineSpans(of: content),
                style: FMReadingMetrics.body,
                color: checked ? palette.secondary : palette.body
            )
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(checked ? "已完成" : "未完成")
    }

    private func todoBox(checked: Bool) -> some View {
        RoundedRectangle(cornerRadius: FMReadingMetrics.todoBoxRadius, style: .continuous)
            .fill(checked ? palette.todoCheckedFill : palette.todoUncheckedFill)
            .overlay {
                RoundedRectangle(cornerRadius: FMReadingMetrics.todoBoxRadius, style: .continuous)
                    .strokeBorder(
                        checked ? Color.clear : palette.todoBorder,
                        lineWidth: FMReadingMetrics.todoBoxBorder
                    )
            }
            .overlay {
                if checked {
                    Image(systemName: "checkmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(palette.todoCheckmark)
                }
            }
            .frame(width: FMReadingMetrics.todoBoxSize, height: FMReadingMetrics.todoBoxSize)
            .accessibilityHidden(true)
    }

    // MARK: - 行内

    private func inlineText(
        _ text: String,
        spans: [FMInlineSpan],
        style: FMTextStyle,
        color: Color
    ) -> some View {
        Text(FMReadingInline.attributed(text: text, spans: spans, style: style, color: color, palette: palette))
            .lineSpacing(style.resolvedLineSpacing)
            .tracking(style.resolvedTracking)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// 块模型里的 span。单行块直接给，多行块摊平（列表/引用按行渲染时用 `line(at:)`）。
    private func inlineSpans(of content: FMBlockContent) -> [FMInlineSpan] {
        switch content.block {
        case let .paragraph(spans), let .heading(_, spans), let .todo(_, spans):
            return spans
        case let .bulletList(lines), let .orderedList(lines), let .quote(lines):
            return lines.flatMap { $0 }
        case .codeBlock, .divider:
            return []
        }
    }

    private var palette: FMReadingPalette { .standard }
}
