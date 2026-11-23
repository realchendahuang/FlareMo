//
//  FMReadingInline.swift
//  FlareMoUI
//
//  职责：把「一段块文本 + 它的行内 span」翻成带样式的 `AttributedString`，
//  供阅读态的 `Text` 直接渲染。
//
//  为什么不用 `AttributedString(markdown:)`：
//  1. 它只能表达行内样式，块级结构（标题/列表/引用/代码块/分隔线/待办）给不了；
//  2. 它对 GFM 删除线的支持依赖解析选项，也没有「行内代码底色」这种渲染层决定；
//  3. 块模型已经用 cmark 解析过一遍，span 是**准确的 UTF-16 偏移**（含 emoji 代理对），
//     照着偏移重放样式比再解析一遍更准也更快。
//
//  样式口径（Web `apps/web/src/index.css` 的 `.memo-markdown`）：
//  - 加粗/斜体/粗斜体：换字体（与编辑器 `FMEditorStyler` 一致）；
//  - 行内代码：`font-mono text-[0.85em] bg-muted/70`。Web 还有 `rounded-[5px]` 圆角和
//    `border border-border/60`，AttributedString 的 `.backgroundColor` 画不了圆角和描边，
//    这里只做底色 + 字号比例 + 等宽（v1 能做的两件）；
//  - 删除线：`mutedForeground` + 删除线（编辑器同款）；
//  - 链接：`brand500` + 下划线（Web 是 `brand-600 / dark:brand-300`，原生端跟随编辑器统一 brand500）；
//  - 标签：**不上色**。Web 正文里的 `#标签` 就是普通文字（标签是查询维度，不是装饰），
//    `remarkTags` 把它变成 chip 是「可点击筛选」的副作用，这里用另一种方式实现：
//    文字保持原样，只在 `onTagClick` 存在时把标签区间挂上自定义 scheme 的链接，
//    由 `FMBlockView` 用 `OpenURLAction` 拦截成回调（SwiftUI 没有「按区间点按」的 API）。
//    编辑态保留上色（写的时候能看见自己打了标签，这个差异是有意的）。
//
//  标签 span 的来源：`FMBlockParser` 有意不产出标签 span，这里用 `FMInlineScanner`
//  在块文本上补一份，并排除落在行内代码 / 链接里的 `#`
//  （与 Web 端 `remarkTags` 的「代码里的 # 不是标签」一致）。
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
        /// 标签名（不含 `#`），点击回调要的就是它。
        var tagName: String?
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
        case let .tag(text):
            traits.isTag = true
            traits.tagName = text.hasPrefix("#") ? String(text.dropFirst()) : text
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
    ///   - tagLinks: 是否为标签挂上可点击的链接（`onTagClick` 存在时才是 true）。
    ///     标签本身**不上色**，这里只加点击命中区。
    static func attributed(
        text: String,
        spans: [FMInlineSpan],
        style: FMTextStyle,
        color: Color,
        palette: FMReadingPalette,
        tagLinks: Bool = false
    ) -> AttributedString {
        var attributed = AttributedString(text)
        attributed.font = style.font
        attributed.foregroundColor = color

        // 不点击时不必扫标签：标签在阅读态没有任何视觉差异。
        let tagLinkSpans = tagLinks ? tagSpans(text: text, spans: spans) : []
        let allSpans = spans + tagLinkSpans
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
            // Web `code` 是 `font-mono text-[0.85em] bg-muted/70`：字号按父级 0.85 倍缩、
            // 底色用 muted。圆角与描边画不了（见文件头），正文色继承不变。
            font = Font.system(size: style.size * 0.85, design: .monospaced)
            fontChanged = true
            attributed[range].backgroundColor = palette.inlineCodeBackground
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
        if traits.isTag, let name = traits.tagName, let url = tagLinkURL(name) {
            // 标签保持正文外观：只挂链接拿点击，不改颜色/不加下划线。
            attributed[range].link = url
        }
        if traits.isStrikethrough {
            attributed[range].strikethroughStyle = Text.LineStyle(pattern: .solid, color: palette.strikethrough)
            attributed[range].foregroundColor = palette.strikethrough
        }
    }

    // MARK: 标签点击

    /// 标签点击用的自定义 URL scheme。
    /// SwiftUI 的 `Text` 没有「按区间点按」的 API，唯一能拿到区间点击的是 link 属性；
    /// 用自定义 scheme 把标签包成链接，再在 `FMBlockView` 里用 `OpenURLAction` 拦下来，
    /// 就不会真的去打开浏览器。标签名里的 `/`、中文靠 `URLComponents` 自动转义。
    static let tagLinkScheme = "flaremo-tag"

    static func tagLinkURL(_ name: String) -> URL? {
        guard !name.isEmpty else { return nil }
        var components = URLComponents()
        components.scheme = tagLinkScheme
        components.host = "tag"
        components.path = "/" + name
        return components.url
    }

    static func tagName(from url: URL) -> String? {
        guard url.scheme == tagLinkScheme else { return nil }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let path = components.percentEncodedPath
        guard path.hasPrefix("/") else { return nil }
        let encoded = String(path.dropFirst())
        let name = encoded.removingPercentEncoding ?? encoded
        return name.isEmpty ? nil : name
    }
}
