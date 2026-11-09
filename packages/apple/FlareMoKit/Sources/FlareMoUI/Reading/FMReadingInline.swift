//
//  FMReadingInline.swift
//  FlareMoUI
//
//  职责：把「一段块文本 + 它的行内 span」翻成带样式的 `AttributedString`，
//  供阅读态的 `Text` 直接渲染。
//
//  为什么不用 `AttributedString(markdown:)`：
//  1. 它只能表达行内样式，块级结构（标题/列表/引用/代码块/分隔线/待办）给不了；
//  2. 它不认 `#标签`（阅读态要画成品牌色）、对 GFM 删除线的支持依赖解析选项；
//  3. 块模型已经用 cmark 解析过一遍，span 是**准确的 UTF-16 偏移**（含 emoji 代理对），
//     照着偏移重放样式比再解析一遍更准也更快。
//
//  标签 span 的来源：`FMBlockParser` 有意不产出标签 span（标签是查询维度，不是排版语法），
//  但详情页要把 `#标签` 画成品牌色，所以这里用 `FMInlineScanner` 在块文本上补一份，
//  并排除落在行内代码 / 链接里的 `#`（与 Web 端 `remarkTags` 的「代码里的 # 不是标签」一致）。
//
//  样式取值与编辑器 `FMEditorStyler` 保持同一套：加粗/斜体/粗斜体换字体，行内代码是
//  等宽 + `brand500`，删除线是 `mutedForeground` + 删除线，链接是 `brand500` + 下划线，
//  标签是 `brand500`。
//

import FlareMoDesign
import FlareMoMarkdown
import Foundation
import SwiftUI

enum FMReadingInline {
    /// 一段文本里「同一组行内样式」的特征。
    struct Traits: Equatable {
        var isBold = false
        var isItalic = false
        var isCode = false
        var isStrikethrough = false
        var isTag = false
        var linkURL: String?

        var isEmpty: Bool {
            !isBold && !isItalic && !isCode && !isStrikethrough && !isTag && linkURL == nil
        }
    }

    /// 一段连续、样式相同的区间。`range` 是相对块文本的 UTF-16 偏移。
    struct Run: Equatable {
        let range: Range<Int>
        let traits: Traits
    }

    // MARK: 样式段

    /// 把可能互相重叠的 span 合并成互不重叠的样式段。
    ///
    /// 为什么要合并：`**粗 *斜* 体**` 会有「加粗覆盖 0..3、斜体覆盖 1..2」这种嵌套，
    /// 直接按顺序给 AttributedString 刷属性时，后刷的斜体会把前面的加粗字体重置掉。
    /// 这里先按 span 的边界切段，再对每段求「所有覆盖它的 span 的并集」，
    /// 于是「斜体那两个字」自然拿到「加粗 + 斜体」。
    static func runs(text: String, spans: [FMInlineSpan]) -> [Run] {
        let length = text.utf16.count
        guard length > 0 else { return [] }
        guard !spans.isEmpty else { return [Run(range: 0..<length, traits: Traits())] }

        var boundaries: Set<Int> = [0, length]
        for span in spans where span.length > 0 {
            boundaries.insert(max(0, min(length, span.location)))
            boundaries.insert(max(0, min(length, span.end)))
        }
        let sorted = boundaries.sorted()

        var runs: [Run] = []
        runs.reserveCapacity(sorted.count)
        for index in 0..<(sorted.count - 1) {
            let start = sorted[index]
            let end = sorted[index + 1]
            guard end > start else { continue }

            var traits = Traits()
            for span in spans where span.length > 0 && span.location <= start && span.end >= end {
                apply(span.kind, to: &traits)
            }
            // 相邻且样式相同就并成一段，减少属性字符串里的 run 数量。
            if let last = runs.last, last.traits == traits, last.range.upperBound == start {
                runs[runs.count - 1] = Run(range: last.range.lowerBound..<end, traits: traits)
            } else {
                runs.append(Run(range: start..<end, traits: traits))
            }
        }
        return runs
    }

    private static func apply(_ kind: FMSpanKind, to traits: inout Traits) {
        switch kind {
        case .bold:
            traits.isBold = true
        case .italic:
            traits.isItalic = true
        case .boldItalic:
            traits.isBold = true
            traits.isItalic = true
        case .code:
            traits.isCode = true
        case .strikethrough:
            traits.isStrikethrough = true
        case let .link(url):
            traits.linkURL = url
        case .tag:
            traits.isTag = true
        case .highlight:
            // 块模型不产出高亮（Web 没有 `==高亮==` 这语法，阅读态不渲染）。
            break
        case .heading, .listMarker, .quoteMarker, .codeFence, .todoCheckbox:
            // 块级标记不会出现在块文本的 span 里（它们是源码位置，不是内容偏移）。
            break
        }
    }

    // MARK: 标签

    /// 补出来的 `#标签` span。
    ///
    /// 排除两类位置（与 Web 端 `remarkTags` 一致）：行内代码里的 `#`、链接文字里的 `#`，
    /// 它们已经是别的东西，不该再被画成标签。
    static func tagSpans(text: String, spans: [FMInlineSpan]) -> [FMSourceSpan] {
        guard text.contains("#") else { return [] }
        let excluded = spans.filter { span in
            switch span.kind {
            case .code, .link: return true
            default: return false
            }
        }
        return FMInlineScanner.spans(in: text).filter { candidate in
            guard case .tag = candidate.kind else { return false }
            return !excluded.contains { span in
                span.location <= candidate.location && candidate.end <= span.end
            }
        }
    }

    // MARK: 属性字符串

    /// 生成带样式的属性字符串。
    ///
    /// - Parameters:
    ///   - text: 块文本（span 的偏移基准）。
    ///   - spans: 块模型给出的行内 span（相对 `text`）。
    ///   - style: 基础排版档位（正文字号也决定加粗/斜体的字号）。
    ///   - color: 基础文字色。
    ///   - palette: 行内样式的取色（测试可注入固定色）。
    static func attributed(
        text: String,
        spans: [FMInlineSpan],
        style: FMTextStyle,
        color: Color,
        palette: FMReadingPalette
    ) -> AttributedString {
        var attributed = AttributedString(text)
        attributed.font = style.font
        attributed.foregroundColor = color

        let allSpans = spans + tagSpans(text: text, spans: spans)
        for run in runs(text: text, spans: allSpans) where !run.traits.isEmpty {
            let nsRange = NSRange(location: run.range.lowerBound, length: run.range.count)
            guard let range = Range(nsRange, in: attributed) else { continue }
            apply(run.traits, style: style, palette: palette, to: &attributed, range: range)
        }
        return attributed
    }

    private static func apply(
        _ traits: Traits,
        style: FMTextStyle,
        palette: FMReadingPalette,
        to attributed: inout AttributedString,
        range: Range<AttributedString.Index>
    ) {
        var font = style.font
        var fontChanged = false

        if traits.isCode {
            // 行内代码比正文小 1pt（编辑器也是 `bodyFontSize - 1`）。
            font = Font.system(size: max(12, style.size - 1), design: .monospaced)
            fontChanged = true
            attributed[range].foregroundColor = palette.inlineCode
        }
        if traits.isBold || traits.isItalic {
            if traits.isCode {
                // 代码里的强调只加粗，不换回比例字体。
                font = font.bold()
            } else if traits.isBold, traits.isItalic {
                font = Font.system(size: style.size, weight: .bold).italic()
            } else if traits.isBold {
                font = Font.system(size: style.size, weight: .bold)
            } else {
                font = Font.system(size: style.size).italic()
            }
            fontChanged = true
        }
        if fontChanged {
            attributed[range].font = font
        }

        if let url = traits.linkURL {
            attributed[range].foregroundColor = palette.link
            attributed[range].underlineStyle = Text.LineStyle(pattern: .solid, color: palette.link.opacity(0.45))
            if let resolved = URL(string: url), !url.isEmpty {
                attributed[range].link = resolved
            }
        }
        if traits.isTag {
            attributed[range].foregroundColor = palette.tag
        }
        if traits.isStrikethrough {
            attributed[range].strikethroughStyle = Text.LineStyle(pattern: .solid, color: palette.strikethrough)
            attributed[range].foregroundColor = palette.strikethrough
        }
    }
}
