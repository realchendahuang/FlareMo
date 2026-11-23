//
//  FMReadingInlineTests.swift
//  FlareMoUITests
//
//  职责：行内样式重放的纯逻辑断言——把「块文本 + span」变成不重叠样式段，
//  再变成 `AttributedString` 的属性。这里不渲染视图，只验证「哪几个字是什么样式」，
//  所以能在没有窗口/快照的情况下守住排版正确性。
//

import FlareMoDesign
import FlareMoMarkdown
import SwiftUI
import Testing

@testable import FlareMoUI

/// 固定色板：不比较动态 token，断言的是「属性有没有被设成我们给的那一档」。
private let testPalette = FMReadingPalette(
    body: .black,
    secondary: .gray,
    inlineCodeBackground: .white,
    link: .blue,
    strikethrough: .gray,
    quoteBar: .orange,
    codeBackground: .white,
    codeBorder: .gray,
    divider: .gray,
    listMarker: .gray,
    todoBorder: .gray,
    todoCheckedFill: .red,
    todoCheckmark: .white,
    todoUncheckedFill: .white
)

/// 取块里的行内 span（单行块直接给）。
private func spans(of content: FMBlockContent) -> [FMInlineSpan] {
    switch content.block {
    case let .paragraph(spans), let .heading(_, spans), let .todo(_, spans):
        return spans
    case let .bulletList(lines), let .orderedList(_, lines), let .quote(lines):
        return lines.flatMap { $0 }
    case .codeBlock, .divider, .blankLine:
        return []
    }
}

/// 找出「文字包含 `text`」的那一段（标签不参与分段时，它和相邻正文在同一段里）。
private func part(containing text: String, in attributed: AttributedString) -> AttributedSubstring? {
    for run in attributed.runs {
        let slice = attributed[run.range]
        if String(slice.characters).contains(text) {
            return slice
        }
    }
    return nil
}

/// 在属性字符串里找出文字正好等于 `text` 的那一段（用于取它的属性）。
private func part(of text: String, in attributed: AttributedString) -> AttributedSubstring? {
    for run in attributed.runs {
        let slice = attributed[run.range]
        if String(slice.characters) == text {
            return slice
        }
    }
    return nil
}

@MainActor
@Suite("阅读态行内样式")
struct FMReadingInlineTests {
    @Test("重叠的 span 合并成互不重叠的样式段（嵌套加粗 + 斜体）")
    func mergesNestedSpans() {
        let content = FMBlockParser.contents(in: "**粗 *斜* 体**")[0]
        let runs = FMReadingInline.runs(text: content.text, spans: spans(of: content))

        #expect(content.text == "粗 斜 体")
        #expect(runs.map(\.range) == [0..<2, 2..<3, 3..<5])
        #expect(runs[0].traits == FMReadingInline.Traits(isBold: true))
        #expect(runs[1].traits == FMReadingInline.Traits(isBold: true, isItalic: true))
        #expect(runs[2].traits == FMReadingInline.Traits(isBold: true))
    }

    @Test("emoji 用 UTF-16 偏移切段，不会错位")
    func emojiOffsets() {
        let content = FMBlockParser.contents(in: "😀**粗**")[0]
        let runs = FMReadingInline.runs(text: content.text, spans: spans(of: content))

        #expect(content.text == "😀粗")
        #expect(runs.map(\.range) == [0..<2, 2..<3])
        #expect(!runs[0].traits.isBold)
        #expect(runs[1].traits.isBold)
    }

    @Test("没有 span 的文本只有一段普通样式")
    func plainTextSingleRun() {
        let runs = FMReadingInline.runs(text: "普通文本", spans: [])
        #expect(runs == [FMReadingInline.Run(range: 0..<4, traits: FMReadingInline.Traits())])
        #expect(FMReadingInline.runs(text: "", spans: []).isEmpty)
    }

    @Test("标签 span 由扫描器补出来（块模型本身不产出标签）")
    func tagSpansAreDerived() {
        let content = FMBlockParser.contents(in: "#读书 和 #笔记/读书")[0]
        let tags = FMReadingInline.tagSpans(text: content.text, spans: spans(of: content))

        #expect(tags.map(\.kind.tagName) == ["读书", "笔记/读书"])
        #expect(tags.map(\.location) == [0, 6])
        // 阅读态的块模型里没有标签 span（标签是查询维度），补出来的这份只在渲染层用。
        #expect(spans(of: content).isEmpty)
    }

    @Test("代码 / 链接里的 # 不当标签")
    func tagSpansSkipCodeAndLink() {
        let code = FMBlockParser.contents(in: "`#不是标签`")[0]
        #expect(FMReadingInline.tagSpans(text: code.text, spans: spans(of: code)).isEmpty)

        let link = FMBlockParser.contents(in: "[#标签](https://a.b)")[0]
        #expect(FMReadingInline.tagSpans(text: link.text, spans: spans(of: link)).isEmpty)
    }

    @Test("属性字符串：加粗 / 行内代码 / 链接 / 标签 / 删除线各就各位")
    func attributedAttributes() throws {
        let source = "**粗** `码` [链](https://a.b) #标签 ~~删~~"
        let content = FMBlockParser.contents(in: source)[0]
        let attributed = FMReadingInline.attributed(
            text: content.text,
            spans: spans(of: content),
            style: FMReadingMetrics.body,
            color: testPalette.body,
            palette: testPalette
        )

        // 基础样式
        let plainSpace = try #require(part(of: " ", in: attributed))
        #expect(plainSpace.font == FMReadingMetrics.body.font)
        #expect(plainSpace.foregroundColor == testPalette.body)

        // 加粗
        let bold = try #require(part(of: "粗", in: attributed))
        #expect(bold.font == Font.system(size: 15, weight: .bold))
        #expect(bold.foregroundColor == testPalette.body)

        // 行内代码：等宽 0.85em + muted 底，正文色不加改动（Web `bg-muted/70 text-[0.85em]`）
        let code = try #require(part(of: "码", in: attributed))
        #expect(code.font == Font.system(size: 15 * 0.85, design: .monospaced))
        #expect(code.backgroundColor == testPalette.inlineCodeBackground)
        #expect(code.foregroundColor == testPalette.body)

        // 链接：品牌色 + 下划线 + 真的 URL
        let link = try #require(part(of: "链", in: attributed))
        #expect(link.foregroundColor == testPalette.link)
        #expect(link.underlineStyle != nil)
        #expect(link.link == URL(string: "https://a.b"))

        // 标签：阅读态就是普通文字（不上色、无下划线、默认不可点）——
        // 不可点时标签不参与分段，会和相邻正文并成同一段。
        let tag = try #require(part(containing: "#标签", in: attributed))
        #expect(tag.foregroundColor == testPalette.body)
        #expect(tag.underlineStyle == nil)
        #expect(tag.link == nil)

        // 删除线：灰色 + 删除线
        let struck = try #require(part(of: "删", in: attributed))
        #expect(struck.strikethroughStyle != nil)
        #expect(struck.foregroundColor == testPalette.strikethrough)
    }

    @Test("斜体 / 粗斜体的字体")
    func italicFonts() throws {
        let source = "*斜* ***粗斜***"
        let content = FMBlockParser.contents(in: source)[0]
        let attributed = FMReadingInline.attributed(
            text: content.text,
            spans: spans(of: content),
            style: FMReadingMetrics.body,
            color: testPalette.body,
            palette: testPalette
        )

        let italic = try #require(part(of: "斜", in: attributed))
        #expect(italic.font == Font.system(size: 15).italic())
        let boldItalic = try #require(part(of: "粗斜", in: attributed))
        #expect(boldItalic.font == Font.system(size: 15, weight: .bold).italic())
    }

    @Test("onTagClick 存在时：标签挂自定义 scheme 链接，但外观仍是普通文字")
    func clickableTags() throws {
        let content = FMBlockParser.contents(in: "#读书 很好")[0]
        let attributed = FMReadingInline.attributed(
            text: content.text,
            spans: spans(of: content),
            style: FMReadingMetrics.body,
            color: testPalette.body,
            palette: testPalette,
            tagLinks: true
        )
        let tag = try #require(part(of: "#读书", in: attributed))
        #expect(tag.link == FMReadingInline.tagLinkURL("读书"))
        #expect(tag.foregroundColor == testPalette.body)
        #expect(tag.underlineStyle == nil)
    }

    @Test("标签链接 scheme 双向可逆（中文、斜杠、下划线都不能丢）")
    func tagLinkRoundTrip() throws {
        for name in ["读书", "笔记/读书", "swift_6-2", "标签😀"] {
            let url = try #require(FMReadingInline.tagLinkURL(name))
            #expect(FMReadingInline.tagName(from: url) == name)
        }
        #expect(FMReadingInline.tagName(from: URL(string: "https://flaremo.app")!) == nil)
        #expect(FMReadingInline.tagLinkURL("") == nil)
    }

    @Test("标题里的行内代码跟着标题字号走")
    func inlineCodeInHeading() throws {
        let content = FMBlockParser.contents(in: "## 标题 `码`")[0]
        let style = FMReadingMetrics.heading(level: 2)
        let attributed = FMReadingInline.attributed(
            text: content.text,
            spans: spans(of: content),
            style: style,
            color: testPalette.body,
            palette: testPalette
        )
        let code = try #require(part(of: "码", in: attributed))
        #expect(code.font == Font.system(size: style.size * 0.85, design: .monospaced))
    }
}
