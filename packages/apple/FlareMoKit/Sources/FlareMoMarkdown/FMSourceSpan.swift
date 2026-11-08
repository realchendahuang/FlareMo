//
//  FMSourceSpan.swift
//  FlareMoMarkdown
//
//  职责：定义「一段源码／一段块内文本落在什么位置上、是什么标记」这两个基础类型。
//  `FMInlineScanner`（编辑器逐键样式计算）与 `FMBlockParser`（阅读态块模型）共用它们。
//
//  位置口径是 **UTF-16 偏移**，不是 `String.count`（字素簇口径）、也不是字节偏移：
//  - `NSTextView` / `UITextView` 的 `NSRange`、`NSAttributedString` 的范围都是 UTF-16 单元；
//  - 中文一字一个单元，emoji 是代理对、占两个单元。用字素簇口径会把 emoji 之后的所有
//    span 整体偏移一截，表现出来就是「表情后面一段莫名变粗」；字节偏移则在中文上差 3 倍。
//  所以所有对外给出的 `location` / `length` 一律按 UTF-16 计。
//

import Foundation

/// 源码里一段被标记覆盖的文本。
///
/// `location` / `length` 的单位是 UTF-16 代码单元，与 `NSRange` 一致。
/// 行内标记（`bold` / `italic` / `code` / `link` …）的跨度是**内容**，不含标记符号本身；
/// 例外是 `tag`（含 `#`）与 `link`（只覆盖方括号里的文字，拼接成 `[文字](url)` 的
/// 标记符号和 URL 不在跨度里，URL 由 `FMSpanKind.link(url:)` 携带）。
/// 块级标记（标题、列表、引用、围栏、待办框）的跨度是行首那一段标记符号，不含缩进。
public struct FMSourceSpan: Sendable, Hashable {
    /// UTF-16 偏移。
    public let location: Int
    /// UTF-16 长度（`length == 0` 的 span 不会被产出）。
    public let length: Int
    public let kind: FMSpanKind

    public init(location: Int, length: Int, kind: FMSpanKind) {
        self.location = location
        self.length = length
        self.kind = kind
    }

    /// `location..<location+length`，方便切片用。
    public var range: Range<Int> { location..<(location + length) }
    /// 结束位置的 UTF-16 偏移。
    public var end: Int { location + length }
}

/// 标记的种类。
///
/// 行内组（`bold` 到 `tag`）作用于内容，编辑器把它们翻译成字体／颜色／下划线；
/// 块级组（`heading` 到 `todoCheckbox`）作用于行首标记，编辑器靠它们上色、算缩进。
/// `tag` 虽然排在最末，语义上是行内的：它和 Web 端 composer 的 `#tag` 高亮一一对应，
/// 阅读态反而**不**特殊渲染（见 `FMBlockParser` 的说明）。
public enum FMSpanKind: Sendable, Hashable {
    // MARK: 行内

    case bold
    case italic
    case boldItalic
    case strikethrough
    case code
    case highlight
    case link(url: String?)

    // MARK: 块级

    /// `# ` 到 `###### `：`location` 指向第一个 `#`，跨度含标记后那一个空格。
    case heading(level: Int)
    /// `- ` / `* ` / `+ ` / `1. `：跨度含标记后那一个空格。
    case listMarker
    /// `> `：跨度覆盖行首连续的引用标记（`> > ` 也算一个 span），不含缩进。
    case quoteMarker
    /// 围栏行（开围栏含语言标记，如 ```` ```swift ````；闭围栏只含反引号）。
    case codeFence
    /// `- [ ]` / `- [x]`：列表标记与复选框合成一个 span，不拆开，编辑器一眼就知道整段前缀要整体上色。
    case todoCheckbox(checked: Bool)
    /// `#标签`：跨度含 `#` 本体（与 Web composer 的高亮范围一致）。
    /// 尾部 `/` 是标点、不算标签的一部分，会被排除在 span 外。
    case tag(String)

    /// 作用于内容、可叠加到正文文字上的标记。
    public var isInline: Bool {
        switch self {
        case .bold, .italic, .boldItalic, .strikethrough, .code, .highlight, .link, .tag:
            return true
        case .heading, .listMarker, .quoteMarker, .codeFence, .todoCheckbox:
            return false
        }
    }

    /// 作用于行首标记、不覆盖正文文字的标记。
    public var isBlockLevel: Bool { !isInline }

    /// `#标签` 的标签名（去掉开头的 `#`），非标签返回 `nil`。
    /// 过滤／跳转要用的是名字本身（与 Web 端 `tagFromHref` 一致），所以这里替调用方剥掉前缀。
    public var tagName: String? {
        guard case let .tag(text) = self else { return nil }
        return text.hasPrefix("#") ? String(text.dropFirst()) : text
    }
}

// MARK: - 便利拼接

extension FMSourceSpan: CustomStringConvertible {
    public var description: String {
        "\(location)+\(length) \(kind)"
    }
}
