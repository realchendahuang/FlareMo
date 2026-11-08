//
//  TestSupport.swift
//  FlareMoMarkdownTests
//
//  职责：测试用的公共小工具。把 span / 块拍成「可读字符串」再断言，
//  这样失败信息能直接看出「哪个偏移、哪个种类不对」，而不是一串结构体 diff。
//

import Foundation

@testable import FlareMoMarkdown

// MARK: - span 描述

/// 把一组 span 描述成 `"位置+长度:种类"` 列表。
func describe(_ spans: [FMSourceSpan]) -> [String] {
    spans.map { describe($0) }
}

/// 把单个 span 描述成 `"位置+长度:种类"`。
func describe(_ span: FMSourceSpan) -> String {
    "\(span.location)+\(span.length):\(kindName(span.kind))"
}

/// 种类的稳定短名（`link` 会带上 URL，`tag` 带上 `#` 前缀本体）。
func kindName(_ kind: FMSpanKind) -> String {
    switch kind {
    case .bold: return "bold"
    case .italic: return "italic"
    case .boldItalic: return "boldItalic"
    case .strikethrough: return "strikethrough"
    case .code: return "code"
    case .highlight: return "highlight"
    case let .link(url): return "link(\(url ?? "nil"))"
    case let .heading(level): return "heading(\(level))"
    case .listMarker: return "listMarker"
    case .quoteMarker: return "quoteMarker"
    case .codeFence: return "codeFence"
    case let .todoCheckbox(checked): return "todo(\(checked))"
    case let .tag(text): return "tag(\(text))"
    }
}

/// 按 UTF-16 偏移把 span 覆盖的源码切出来。测试里用它核对「span 指的到底是哪几个字」。
func text(of span: FMSourceSpan, in source: String) -> String {
    let utf16 = source.utf16
    let start = utf16.index(utf16.startIndex, offsetBy: span.location)
    let end = utf16.index(start, offsetBy: span.length)
    return String(decoding: utf16[start..<end], as: UTF16.self)
}

// MARK: - 块描述

/// 把一个块描述成可读字符串。
func describe(_ block: FMBlock) -> String {
    switch block {
    case let .paragraph(spans):
        return "paragraph[\(describe(spans).joined(separator: ","))]"
    case let .heading(level, spans):
        return "heading(\(level))[\(describe(spans).joined(separator: ","))]"
    case let .bulletList(lines):
        return "bullet[\(describeLines(lines))]"
    case let .orderedList(lines):
        return "ordered[\(describeLines(lines))]"
    case let .quote(lines):
        return "quote[\(describeLines(lines))]"
    case let .codeBlock(language, code):
        return "code(\(language ?? "nil"))|\(code)"
    case .divider:
        return "divider"
    case let .todo(checked, spans):
        return "todo(\(checked))[\(describe(spans).joined(separator: ","))]"
    }
}

private func describeLines(_ lines: [[FMSourceSpan]]) -> String {
    lines.map { line in "(" + describe(line).joined(separator: ",") + ")" }.joined(separator: ";")
}

/// 块 + 文本，换行显示成 `⏎` 方便肉眼核对。
func describe(_ content: FMBlockContent) -> String {
    "\(describe(content.block)) text=|\(content.text.replacingOccurrences(of: "\n", with: "⏎"))|"
}

/// 一组块的描述。
func describe(_ blocks: [FMBlock]) -> [String] {
    blocks.map { describe($0) }
}

/// 一组「块 + 文本」的描述。
func describe(_ contents: [FMBlockContent]) -> [String] {
    contents.map { describe($0) }
}

/// 取块里所有 span（摊平），用于「块模型 vs 扫描器」的一致性对照。
func inlineSpans(of block: FMBlock) -> [FMSourceSpan] {
    switch block {
    case let .paragraph(spans), let .heading(_, spans), let .todo(_, spans):
        return spans
    case let .bulletList(lines), let .orderedList(lines), let .quote(lines):
        return lines.flatMap { $0 }
    case .codeBlock, .divider:
        return []
    }
}
