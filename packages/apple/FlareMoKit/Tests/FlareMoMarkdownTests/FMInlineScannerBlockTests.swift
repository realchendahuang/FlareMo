//
//  FMInlineScannerBlockTests.swift
//  FlareMoMarkdownTests
//
//  职责：块级标记（行首标题 / 列表 / 引用 / 围栏 / 待办框）的扫描结果与边界。
//  编辑器靠这些 span 决定行首标记怎么压暗、缩进多少，所以「哪几个字符算标记」必须钉死。
//

import Testing

@testable import FlareMoMarkdown

@Suite("块级标记：标题")
struct FMInlineScannerHeadingTests {
    @Test(
        "一至六级标题，span 覆盖 `#*` 加一个空格",
        arguments: [
            ("# 标题", ["0+2:heading(1)"]),
            ("## 标题", ["0+3:heading(2)"]),
            ("### 标题", ["0+4:heading(3)"]),
            ("#### 标题", ["0+5:heading(4)"]),
            ("##### 标题", ["0+6:heading(5)"]),
            ("###### 标题", ["0+7:heading(6)"]),
            ("# 标题 **粗**", ["0+2:heading(1)", "7+1:bold"]),
            ("   # 缩进三格", ["3+2:heading(1)"]),
        ]
    )
    func headings(source: String, expected: [String]) {
        #expect(describe(FMInlineScanner.spans(in: source)) == expected)
    }

    @Test(
        "不是标题：七级、无空格（是标签）、空标题、四格缩进",
        arguments: [
            "####### 七级",
            "#",
            "### ",
            "    # 四格缩进",
        ]
    )
    func notHeadings(source: String) {
        #expect(describe(FMInlineScanner.spans(in: source)) == [])
    }

    @Test("`#标签` 是标签不是标题")
    func hashWithoutSpaceIsTag() {
        #expect(describe(FMInlineScanner.spans(in: "#读书")) == ["0+3:tag(#读书)"])
    }
}

@Suite("块级标记：列表与待办")
struct FMInlineScannerListTests {
    @Test(
        "无序列表标记",
        arguments: [
            ("- 项目", ["0+2:listMarker"]),
            ("* 项目", ["0+2:listMarker"]),
            ("+ 项目", ["0+2:listMarker"]),
            ("  - 缩进两格", ["2+2:listMarker"]),
            ("- ", ["0+2:listMarker"]),
        ]
    )
    func bullet(source: String, expected: [String]) {
        #expect(describe(FMInlineScanner.spans(in: source)) == expected)
    }

    @Test(
        "有序列表标记",
        arguments: [
            ("1. 第一", ["0+3:listMarker"]),
            ("1) 第一", ["0+3:listMarker"]),
            ("9. 第一", ["0+3:listMarker"]),
            ("123456789. 第一", ["0+11:listMarker"]),
        ]
    )
    func ordered(source: String, expected: [String]) {
        #expect(describe(FMInlineScanner.spans(in: source)) == expected)
    }

    @Test(
        "不是列表：标记后没有空格、十位数字、非数字前缀",
        arguments: [
            "-无空格",
            "1.无空格",
            "1.5 版本",
            "1234567890. 十位把位",
            "-",
            "a. 不是列表",
        ]
    )
    func notLists(source: String) {
        #expect(describe(FMInlineScanner.spans(in: source)) == [])
    }

    @Test(
        "待办框：列表标记与复选框合成一个 span",
        arguments: [
            ("- [ ] 待办", ["0+5:todo(false)"]),
            ("- [x] 完成", ["0+5:todo(true)"]),
            ("- [X] 完成", ["0+5:todo(true)"]),
            ("* [ ] 星号待办", ["0+5:todo(false)"]),
            ("1. [ ] 有序待办", ["0+6:todo(false)"]),
            ("- [ ]", ["0+5:todo(false)"]),
            ("- [x] 买 **牛奶**", ["0+5:todo(true)", "10+2:bold"]),
        ]
    )
    func todo(source: String, expected: [String]) {
        #expect(describe(FMInlineScanner.spans(in: source)) == expected)
    }

    @Test("不像待办的复选框只当普通列表项", arguments: ["- [y] 不是待办", "- [] 也不是"])
    func todoLookalikes(source: String) {
        #expect(describe(FMInlineScanner.spans(in: source)) == ["0+2:listMarker"])
    }

    @Test("列表标记后面的行内标记照常扫描")
    func inlineAfterMarker() {
        #expect(describe(FMInlineScanner.spans(in: "- **粗**")) == ["0+2:listMarker", "4+1:bold"])
    }
}

@Suite("块级标记：引用")
struct FMInlineScannerQuoteTests {
    @Test(
        "引用标记，嵌套引用合成一个 span",
        arguments: [
            ("> 引用", ["0+2:quoteMarker"]),
            (">引用", ["0+1:quoteMarker"]),
            ("> > 引用", ["0+4:quoteMarker"]),
            (">>引用", ["0+2:quoteMarker"]),
            ("  > 缩进两格", ["2+2:quoteMarker"]),
        ]
    )
    func quote(source: String, expected: [String]) {
        #expect(describe(FMInlineScanner.spans(in: source)) == expected)
    }

    @Test("引用里行内的标记照常扫描")
    func inlineInsideQuote() {
        #expect(describe(FMInlineScanner.spans(in: "> **粗** #标签")) == ["0+2:quoteMarker", "4+1:bold", "8+3:tag(#标签)"])
    }

    @Test(
        "引用里的块级标记照常识别（与 Web 端的嵌套渲染对齐）",
        arguments: [
            ("> # 标题", ["0+2:quoteMarker", "2+2:heading(1)"]),
            ("> - 事项", ["0+2:quoteMarker", "2+2:listMarker"]),
            ("> - [ ] 待办", ["0+2:quoteMarker", "2+5:todo(false)"]),
            ("> > # 标题", ["0+4:quoteMarker", "4+2:heading(1)"]),
        ]
    )
    func blockInsideQuote(source: String, expected: [String]) {
        #expect(describe(FMInlineScanner.spans(in: source)) == expected)
    }
}

@Suite("块级标记：围栏代码块")
struct FMInlineScannerFenceTests {
    @Test(
        "开闭围栏各行一个 span",
        arguments: [
            (
                "```\nlet a = 1\n```",
                ["0+3:codeFence", "14+3:codeFence"]
            ),
            (
                "```swift\nlet a = 1\n```",
                ["0+8:codeFence", "19+3:codeFence"]
            ),
            (
                "  ```\ncode\n  ```",
                ["2+3:codeFence", "13+3:codeFence"]
            ),
            (
                "~~~\ntext\n~~~",
                ["0+3:codeFence", "9+3:codeFence"]
            ),
        ]
    )
    func fences(source: String, expected: [String]) {
        #expect(describe(FMInlineScanner.spans(in: source)) == expected)
    }

    @Test("围栏内部整段不扫描行内 / 块级标记")
    func fencedContentIsNotScanned() {
        let source = "```\n**粗** #标签\n- 项目\n# 标题\n```"
        #expect(describe(FMInlineScanner.spans(in: source)) == ["0+3:codeFence", "24+3:codeFence"])
    }

    @Test("未闭合的围栏：只有开头那行是 span，后面整段当代码")
    func unclosedFence() {
        let source = "```\n**粗** #标签\n- 项目"
        #expect(describe(FMInlineScanner.spans(in: source)) == ["0+3:codeFence"])
    }

    @Test("闭围栏必须与开围栏同字符、且不短于开围栏")
    func closingRules() {
        #expect(describe(FMInlineScanner.spans(in: "````\ncode\n```")) == ["0+4:codeFence"])
        #expect(describe(FMInlineScanner.spans(in: "````\n``\n````")) == ["0+4:codeFence", "8+4:codeFence"])
    }

    @Test("info string 里有反引号的行不是围栏")
    func infoStringWithBacktick() {
        #expect(describe(FMInlineScanner.spans(in: "```a`b")) == [])
    }

    @Test("CRLF 换行的围栏也能识别（回车视为行尾空白）")
    func crlf() {
        #expect(describe(FMInlineScanner.spans(in: "```\r\ncode\r\n```\r\n")) == ["0+3:codeFence", "11+3:codeFence"])
    }
}
