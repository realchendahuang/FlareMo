//
//  FMBlock.swift
//  FlareMoMarkdown
//
//  职责：定义阅读态（卡片 / 详情 / 回顾）的块模型。
//  与编辑器用的 `FMInlineScanner` 共用 `FMSourceSpan` / `FMSpanKind`，这样「同一段文字在编辑态和
//  阅读态被认成什么」只有一套定义，不会出现「编辑时是粗体、发出去就没了」。
//
//  为什么块模型要额外带文本（`FMBlockContent`）：`FMBlock` 的每个 case 只描述「哪一段在什么
//  样式下」——span 是偏移，不是文字。渲染器要把文字画出来，就必须同时拿到块的内容文本，
//  而 span 的 `location` / `length` 是**相对这个块文本**的 UTF-16 偏移（多行块用 `\n` 连接，
//  列表项之间、引用行之间各占一行）。`FMBlockParser.contents(in:)` 成对返回块与文本。
//

import Foundation

/// 行内 span。语义与 `FMSourceSpan` 完全相同（复用同一类型，避免两套偏移口径）。
/// 在块模型里它的偏移相对**块文本**；在编辑器扫描器里相对**整段源码**。
public typealias FMInlineSpan = FMSourceSpan

/// 阅读态的块。只覆盖 v1 要渲染的形态：段落、标题、项目列表、有序列表、引用、代码块、
/// 分割线、待办。表格、图片、HTML 在这里没有对应 case，`FMBlockParser` 会把它们降级成
/// 段落文本（见那边的说明），因为 Web 端 `MemoContent` 也是「不认识的就退化成文字」。
public enum FMBlock: Sendable, Equatable {
    case paragraph([FMInlineSpan])
    case heading(level: Int, spans: [FMInlineSpan])
    case bulletList([[FMInlineSpan]])
    /// `start` 是作者写的起始序号（`3. 三` → 3），从 1 开始编号会把内容改错。
    case orderedList(start: Int, lines: [[FMInlineSpan]])
    case quote([[FMInlineSpan]])
    case codeBlock(language: String?, code: String)
    case divider
    case todo(checked: Bool, spans: [FMInlineSpan])
    /// 作者敲出来的多余空行（一行一个块）。
    /// 速记的「呼吸感」是作者敲出来的：Web 端 `protectLiteralLayout` 会把
    /// `\n\n\n` 里多出来的那一行渲染成 1.75rem 高的空段落，折掉会让原生端读起来比 Web 紧。
    case blankLine
}

/// 块 + 它的内容文本。`block` 里所有 span 的偏移都相对 `text`。
///
/// 多行块（`bulletList` / `orderedList` / `quote`）的 `text` 是各行用 `\n` 连接的结果，
/// 行数与 span 数组的外层元素一一对应；单行块（`paragraph` / `heading` / `todo`）只有一行。
/// `codeBlock` 的 `text` 就是代码本身（span 为空），`divider` 的 `text` 是空串。
public struct FMBlockContent: Sendable, Equatable {
    public let block: FMBlock
    public let text: String

    public init(block: FMBlock, text: String) {
        self.block = block
        self.text = text
    }

    /// 裁剪到某一行的文本与**偏移已归一到该行**的 span，供「多行块按行渲染」用。
    /// `line` 是 0 起的行号，越界返回 `nil`。
    public func line(at line: Int) -> (text: String, spans: [FMInlineSpan])? {
        switch block {
        case let .bulletList(lines),
             let .orderedList(_, lines),
             let .quote(lines):
            guard line >= 0, line < lines.count else { return nil }
            let textLines = Self.lines(of: text)
            guard line < textLines.count else { return nil }
            // 该行在整块文本里的起始 UTF-16 偏移：前面每行长度 + 每行一个 `\n`。
            var start = 0
            for index in 0..<line {
                start += textLines[index].utf16.count + 1
            }
            let shifted = lines[line].map {
                FMInlineSpan(location: $0.location - start, length: $0.length, kind: $0.kind)
            }
            return (textLines[line], shifted)
        default:
            guard line == 0 else { return nil }
            return (text, spansOfBlock)
        }
    }

    /// 该块所有 span（outer 数组摊平），单行块就是全部。
    private var spansOfBlock: [FMInlineSpan] {
        switch block {
        case let .paragraph(spans),
             let .heading(_, spans),
             let .todo(_, spans):
            return spans
        case let .bulletList(lines),
             let .orderedList(_, lines),
             let .quote(lines):
            return lines.flatMap { $0 }
        case .codeBlock, .divider, .blankLine:
            return []
        }
    }

    private static func lines(of text: String) -> [String] {
        text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    }
}

extension FMBlock: CustomStringConvertible {
    public var description: String {
        switch self {
        case let .paragraph(spans): return "paragraph(\(spans.count) spans)"
        case let .heading(level, spans): return "heading(h\(level), \(spans.count) spans)"
        case let .bulletList(lines): return "bulletList(\(lines.count) items)"
        case let .orderedList(start, lines): return "orderedList(start: \(start), \(lines.count) items)"
        case let .quote(lines): return "quote(\(lines.count) lines)"
        case let .codeBlock(language, code):
            return "codeBlock(\(language ?? "-"), \(code.utf16.count) units)"
        case .divider: return "divider"
        case let .todo(checked, spans): return "todo(\(checked), \(spans.count) spans)"
        case .blankLine: return "blankLine"
        }
    }
}
