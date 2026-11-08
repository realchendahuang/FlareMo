//
//  FMInlineScannerOffsetTests.swift
//  FlareMoMarkdownTests
//
//  职责：UTF-16 偏移的正确性，尤其是中文与 emoji（代理对）。
//  这是编辑器最容易翻车的地方：偏移错了，属性会整体错位，表现成「表情后面一段莫名变粗」。
//

import Testing

@testable import FlareMoMarkdown

@Suite("偏移：中文与 emoji")
struct FMInlineScannerOffsetTests {
    @Test(
        "emoji 占两个 UTF-16 单元，span 必须按代理对口径换算",
        arguments: [
            ("😀**粗**", ["4+1:bold"]),
            ("😀😀**粗**", ["6+1:bold"]),
            ("👨‍👩‍👧‍👦**粗**", ["13+1:bold"]),
            ("中**粗**", ["3+1:bold"]),
            ("中文**粗**体", ["4+1:bold"]),
        ]
    )
    func emojiOffsets(source: String, expected: [String]) {
        #expect(describe(FMInlineScanner.spans(in: source)) == expected)
    }

    @Test(
        "emoji 出现在其他语法前后",
        arguments: [
            ("😀#标签", ["2+3:tag(#标签)"]),
            ("😀`码`", ["3+1:code"]),
            ("[😀](url)", ["1+2:link(url)"]),
            ("~~😀😀~~", ["2+4:strikethrough"]),
            ("**粗**😀**粗2**", ["2+1:bold", "9+2:bold"]),
        ]
    )
    func emojiMixed(source: String, expected: [String]) {
        #expect(describe(FMInlineScanner.spans(in: source)) == expected)
    }

    @Test("跨行后偏移继续按 UTF-16 累加")
    func multilineOffsets() {
        let source = "😀**粗**\n**斜**"
        #expect(describe(FMInlineScanner.spans(in: source)) == ["4+1:bold", "10+1:bold"])
    }

    @Test("emoji 不能当标签的起始字符（不在标签字符集里）")
    func emojiIsNotTagCharacter() {
        #expect(describe(FMInlineScanner.spans(in: "#🏷")) == [])
        #expect(describe(FMInlineScanner.spans(in: "#标签🏷")) == ["0+3:tag(#标签)"])
    }

    @Test("每个 span 都能切出完整字符，不会劈开代理对")
    func spansDoNotSplitSurrogatePairs() {
        let source = "😀**粗**🚀 #标签中 👨‍👩‍👧‍👦 `码`"
        let spans = FMInlineScanner.spans(in: source)
        #expect(!spans.isEmpty)
        for span in spans {
            let slice = text(of: span, in: source)
            #expect(!slice.contains("\u{FFFD}"), "span \(describe(span)) 切出了半个代理对")
        }
        #expect(spans.map { text(of: $0, in: source) } == ["粗", "#标签中", "码"])
    }

    @Test("长度不超过源码的 UTF-16 长度")
    func withinBounds() {
        let source = "😀**粗** 中文 *斜* `码`"
        for span in FMInlineScanner.spans(in: source) {
            #expect(span.location >= 0)
            #expect(span.length > 0)
            #expect(span.end <= source.utf16.count)
        }
    }

    @Test("span 按位置递增排列（编辑器顺序叠加属性）")
    func ordered() {
        let source = "😀**粗** 和 [链接](url) 以及 #标签 `码`"
        let locations = FMInlineScanner.spans(in: source).map(\.location)
        #expect(locations == locations.sorted())
    }
}
