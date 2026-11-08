//
//  FMInlineScannerSyntaxTests.swift
//  FlareMoMarkdownTests
//
//  职责：行内语法的正例 / 负例。负例（未闭合、转义、跨行、词内下划线）和正例一样重要：
//  编辑器宁可不給一段文字上色，也不能把后面整段吞进样式里。
//

import Testing

@testable import FlareMoMarkdown

@Suite("行内语法：强调")
struct FMInlineScannerEmphasisTests {
    @Test(
        "加粗 / 斜体 / 粗斜体的正例",
        arguments: [
            ("**粗**", ["2+1:bold"]),
            ("**bold**", ["2+4:bold"]),
            ("*斜*", ["1+1:italic"]),
            ("_斜_", ["1+1:italic"]),
            ("__粗__", ["2+1:bold"]),
            ("***粗斜***", ["3+2:boldItalic"]),
            ("___粗斜___", ["3+2:boldItalic"]),
            ("中文**粗**体", ["4+1:bold"]),
            ("**粗体**，后面还有字", ["2+2:bold"]),
            ("_斜_。", ["1+1:italic"]),
            ("a*b*c", ["2+1:italic"]),
        ]
    )
    func emphasis(source: String, expected: [String]) {
        #expect(describe(FMInlineScanner.spans(in: source)) == expected)
    }

    @Test(
        "嵌套：外层加粗包住内层斜体",
        arguments: [
            ("**粗 *斜* 体**", ["2+7:bold", "5+1:italic"]),
            ("**a `码` b**", ["2+7:bold", "5+1:code"]),
        ]
    )
    func nested(source: String, expected: [String]) {
        #expect(describe(FMInlineScanner.spans(in: source)) == expected)
    }

    @Test(
        "未闭合的强调一律不产生 span",
        arguments: [
            "**未闭合",
            "*未闭合",
            "_未闭合",
            "***未闭合",
            "**粗*",
            "**",
            "****",
            "a ** b ** c",
        ]
    )
    func unclosed(source: String) {
        #expect(describe(FMInlineScanner.spans(in: source)) == [])
    }

    @Test(
        "词内下划线不是强调（snake_case / 1_000）",
        arguments: [
            "snake_case_name",
            "中文_斜_中文",
            "let foo_bar = 1_000",
        ]
    )
    func intrawordUnderscore(source: String) {
        #expect(describe(FMInlineScanner.spans(in: source)) == [])
    }

    @Test("跨行的行内标记不产生 span（星号不吞下一行）")
    func doesNotSpanLines() {
        let source = "**第一行\n第二行**"
        #expect(describe(FMInlineScanner.spans(in: source)) == [])
    }
}

@Suite("行内语法：行内代码")
struct FMInlineScannerCodeTests {
    @Test(
        "行内代码",
        arguments: [
            ("`行内码`", ["1+3:code"]),
            ("`**不解析**`", ["1+7:code"]),
            ("前`码`后", ["2+1:code"]),
            ("``a`b``", ["2+3:code"]),
        ]
    )
    func code(source: String, expected: [String]) {
        #expect(describe(FMInlineScanner.spans(in: source)) == expected)
    }

    @Test(
        "落单 / 数量不匹配的反引号不产生 span",
        arguments: [
            "`落单",
            "``a",
            "`未闭合 `` 也不",
        ]
    )
    func unclosed(source: String) {
        #expect(describe(FMInlineScanner.spans(in: source)) == [])
    }

    @Test("代码里的星号与井号不再解析")
    func suppressesInnerMarkers() {
        let source = "`**粗** 和 #标签`"
        #expect(describe(FMInlineScanner.spans(in: source)) == ["1+11:code"])
    }
}

@Suite("行内语法：删除线与高亮")
struct FMInlineScannerStrikeTests {
    @Test(
        "删除线与高亮",
        arguments: [
            ("~~删除~~", ["2+2:strikethrough"]),
            ("==高亮==", ["2+2:highlight"]),
            ("前 ==高亮== 后", ["4+2:highlight"]),
        ]
    )
    func markers(source: String, expected: [String]) {
        #expect(describe(FMInlineScanner.spans(in: source)) == expected)
    }

    @Test(
        "落单的删除线 / 高亮不产生 span",
        arguments: [
            "~~未闭合",
            "~单个~",
            "前 ~~~删除~~~ 后",
            "== 高亮 ==",
            "a == b",
            "a = b",
            "====",
        ]
    )
    func unclosed(source: String) {
        #expect(describe(FMInlineScanner.spans(in: source)) == [])
    }
}

@Suite("行内语法：链接")
struct FMInlineScannerLinkTests {
    @Test(
        "链接的 span 只覆盖方括号里的文字，URL 走 kind 的负载",
        arguments: [
            ("[文字](https://a.b/c)", ["1+2:link(https://a.b/c)"]),
            ("看[文档](url)吧", ["2+2:link(url)"]),
            ("[文字](url \"标题\")", ["1+2:link(url)"]),
            ("[文字](<url>)", ["1+2:link(url)"]),
            ("[文字]( )", ["1+2:link(nil)"]),
        ]
    )
    func link(source: String, expected: [String]) {
        #expect(describe(FMInlineScanner.spans(in: source)) == expected)
    }

    @Test(
        "不完整的链接不产生 span",
        arguments: [
            "[文字]",
            "[文字](url",
            "[文字] (url)",
            "[](url)",
            "[]",
        ]
    )
    func unclosed(source: String) {
        #expect(describe(FMInlineScanner.spans(in: source)) == [])
    }

    @Test("链接文字里可以再有强调")
    func emphasisInsideLabel() {
        let source = "[**粗**](url)"
        #expect(describe(FMInlineScanner.spans(in: source)) == ["1+5:link(url)", "3+1:bold"])
    }
}

@Suite("行内语法：标签")
struct FMInlineScannerTagTests {
    @Test(
        "标签（span 含 # 本体）",
        arguments: [
            ("#标签", ["0+3:tag(#标签)"]),
            ("#标签，后面", ["0+3:tag(#标签)"]),
            ("#12", ["0+3:tag(#12)"]),
            ("#tag/", ["0+4:tag(#tag)"]),
            ("#tags/scala", ["0+11:tag(#tags/scala)"]),
            ("（#标签）", ["1+3:tag(#标签)"]),
            ("#标签😀", ["0+3:tag(#标签)"]),
            ("正文 #笔记 #读书", ["3+3:tag(#笔记)", "7+3:tag(#读书)"]),
        ]
    )
    func tag(source: String, expected: [String]) {
        #expect(describe(FMInlineScanner.spans(in: source)) == expected)
    }

    @Test(
        "不是标签的情形",
        arguments: [
            "a#b",
            "中文#标签",
            "v1.2#12",
            "#",
            "##",
            "abc # 后面是空格",
        ]
    )
    func notTags(source: String) {
        #expect(describe(FMInlineScanner.spans(in: source)) == [])
    }

    @Test("标签名可以剥掉 # 前缀给过滤用")
    func tagName() {
        #expect(FMSpanKind.tag("#读书").tagName == "读书")
        #expect(FMSpanKind.tag("#tags/scala").tagName == "tags/scala")
        #expect(FMSpanKind.bold.tagName == nil)
    }
}

@Suite("行内语法：转义与混合")
struct FMInlineScannerEscapeTests {
    @Test(
        "反斜杠转义：转义掉的标记符号不参与解析",
        arguments: [
            ("\\*不是斜体\\*", [] as [String]),
            ("\\`不是代码\\`", [] as [String]),
            ("\\~~不是删除~~", [] as [String]),
            ("\\#不是标签", [] as [String]),
        ]
    )
    func escaped(source: String, expected: [String]) {
        #expect(describe(FMInlineScanner.spans(in: source)) == expected)
    }

    @Test("转义双反斜杠后剩下的星号恢复正常语义")
    func escapedBackslash() {
        let source = "\\\\*斜*"
        #expect(describe(FMInlineScanner.spans(in: source)) == ["3+1:italic"])
    }

    @Test("一段里混合多种行内标记，顺序按源码位置递增")
    func mixed() {
        let source = "**粗** 和 `码` 和 ~~删~~"
        let expected = ["2+1:bold", "9+1:code", "16+1:strikethrough"]
        #expect(describe(FMInlineScanner.spans(in: source)) == expected)
    }

    @Test("空串、纯空白、纯换行没有 span", arguments: ["", "   ", "\n\n\n", "\t\n \t"])
    func empty(source: String) {
        #expect(describe(FMInlineScanner.spans(in: source)) == [])
    }
}

@Suite("行内语法：span 切片")
struct FMInlineScannerSliceTests {
    @Test("每个 span 切出来的文字正是它该覆盖的内容")
    func slices() {
        let source = "**粗** 和 `码` 和 [文字](url) 和 #标签"
        let spans = FMInlineScanner.spans(in: source)
        #expect(spans.map { text(of: $0, in: source) } == ["粗", "码", "文字", "#标签"])
    }

    @Test("块级标记的 span 切出来是行首标记")
    func blockSlices() {
        let source = "## 标题\n- [x] 待办\n> 引用\n```swift\ncode\n```"
        let spans = FMInlineScanner.spans(in: source)
        #expect(spans.map { text(of: $0, in: source) } == ["## ", "- [x]", "> ", "```swift", "```"])
    }
}
