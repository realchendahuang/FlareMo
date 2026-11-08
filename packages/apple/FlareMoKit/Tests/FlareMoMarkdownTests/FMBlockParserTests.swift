//
//  FMBlockParserTests.swift
//  FlareMoMarkdownTests
//
//  职责：阅读态块模型（`FMBlock` + 文本）的解析结果。
//  断言口径：块种类与行内 span 的位置（相对块文本的 UTF-16 偏移）+ 块文本本身。
//

import Testing

@testable import FlareMoMarkdown

@Suite("块模型：段落与行内")
struct FMBlockParserParagraphTests {
    @Test("段落里的行内标记")
    func paragraphInline() {
        let source = "第一段**粗**和第二行\n换行后 *斜*"
        let contents = FMBlockParser.contents(in: source)
        #expect(contents.count == 1)
        #expect(describe(contents[0]) == "paragraph[3+1:bold,13+1:italic] text=|第一段粗和第二行⏎换行后 斜|")
        // 软换行按 flomo 的习惯保留成换行，不折成空格。
        #expect(contents[0].text.contains("\n"))
    }

    @Test(
        "行内语法的块模型形态",
        arguments: [
            ("**粗**", "paragraph[0+1:bold] text=|粗|"),
            ("*斜*", "paragraph[0+1:italic] text=|斜|"),
            ("_斜_", "paragraph[0+1:italic] text=|斜|"),
            ("***粗斜***", "paragraph[0+2:boldItalic] text=|粗斜|"),
            ("`码`", "paragraph[0+1:code] text=|码|"),
            ("~~删~~", "paragraph[0+1:strikethrough] text=|删|"),
            ("[文字](https://a.b)", "paragraph[0+2:link(https://a.b)] text=|文字|"),
            ("**粗 *斜* 体**", "paragraph[0+5:bold,2+1:italic] text=|粗 斜 体|"),
        ]
    )
    func inlineForms(source: String, expected: String) {
        #expect(describe(FMBlockParser.contents(in: source)) == [expected])
    }

    @Test("空串与纯空白不产生块")
    func empty() {
        #expect(FMBlockParser.blocks(in: "").isEmpty)
        #expect(FMBlockParser.blocks(in: "   \n\n  ").isEmpty)
    }

    @Test("硬换行也是换行")
    func hardBreak() {
        let contents = FMBlockParser.contents(in: "第一行  \n第二行")
        #expect(describe(contents) == ["paragraph[] text=|第一行⏎第二行|"])
    }

    @Test("`#标签` 在阅读态只是普通文字")
    func tagIsPlainText() {
        let contents = FMBlockParser.contents(in: "今天 #读书 很有收获")
        #expect(describe(contents) == ["paragraph[] text=|今天 #读书 很有收获|"])
    }

    @Test("图片降级成 alt 文本（v1 不内联图片）")
    func imageFallsBackToAlt() {
        #expect(describe(FMBlockParser.contents(in: "![图](x.png)")) == ["paragraph[] text=|图|"])
    }

    @Test("HTML 块直接丢弃（与 Web 端 skipHtml 一致）")
    func htmlDropped() {
        #expect(FMBlockParser.contents(in: "<div>坏</div>").isEmpty)
    }

    @Test("表格降级成每行一段文字")
    func tableDegrades() {
        let source = "| a | b |\n| --- | --- |\n| 1 | 2 |"
        #expect(
            describe(FMBlockParser.contents(in: source)) == [
                "paragraph[] text=|a | b|",
                "paragraph[] text=|1 | 2|",
            ]
        )
    }

    @Test("无语言标记的行内代码与普通文字共存")
    func mixedInline() {
        let source = "a `码` b [链](u) c"
        #expect(describe(FMBlockParser.contents(in: source)) == ["paragraph[2+1:code,6+1:link(u)] text=|a 码 b 链 c|"])
    }
}

@Suite("块模型：块级结构")
struct FMBlockParserBlockTests {
    @Test(
        "标题",
        arguments: [
            ("# 标题", "heading(1)[] text=|标题|"),
            ("## 标题 **粗**", "heading(2)[3+1:bold] text=|标题 粗|"),
            ("###### 六级", "heading(6)[] text=|六级|"),
            ("标题\n===", "heading(1)[] text=|标题|"),
        ]
    )
    func headings(source: String, expected: String) {
        #expect(describe(FMBlockParser.contents(in: source)) == [expected])
    }

    @Test("无序列表：每项一行，多行块用换行连接")
    func bulletList() {
        let source = "- 一\n- 二 **粗**"
        #expect(describe(FMBlockParser.contents(in: source)) == ["bullet[();(4+1:bold)] text=|一⏎二 粗|"])
    }

    @Test("有序列表")
    func orderedList() {
        #expect(describe(FMBlockParser.contents(in: "1. 甲\n2. 乙")) == ["ordered[();()] text=|甲⏎乙|"])
    }

    @Test("待办单独成块，同级的普通项各自并成列表块")
    func todosSplitLists() {
        let source = "- 一\n- [ ] 待办\n- [x] 完成\n- 二"
        #expect(
            describe(FMBlockParser.contents(in: source)) == [
                "bullet[()] text=|一|",
                "todo(false)[] text=|待办|",
                "todo(true)[] text=|完成|",
                "bullet[()] text=|二|",
            ]
        )
    }

    @Test("引用：多个段落各占一行；段落内的软换行折成空格")
    func quote() {
        #expect(describe(FMBlockParser.contents(in: "> 一\n>\n> 二")) == ["quote[();()] text=|一⏎二|"])
        #expect(describe(FMBlockParser.contents(in: "> - 甲\n> - 乙")) == ["quote[();()] text=|甲⏎乙|"])
        #expect(describe(FMBlockParser.contents(in: "> 引用一\n> 引用二")) == ["quote[()] text=|引用一 引用二|"])
        // 引用里的待办：块模型里引用只有行，勾选状态在阅读态不展示，文字里残留的 `[ ] ` 前缀剥掉。
        #expect(describe(FMBlockParser.contents(in: "> - [ ] 待办")) == ["quote[()] text=|待办|"])
    }

    @Test("列表项的续行折成空格，保证项数 = 行数")
    func listItemContinuation() {
        #expect(describe(FMBlockParser.contents(in: "- 第一行\n  第二行")) == ["bullet[()] text=|第一行 第二行|"])
    }

    @Test("嵌套列表压平成同一项的文字")
    func nestedListFlattens() {
        #expect(describe(FMBlockParser.contents(in: "- 一\n  - 子")) == ["bullet[()] text=|一 子|"])
        #expect(describe(FMBlockParser.contents(in: "- 一\n  - [ ] 子")) == ["bullet[()] text=|一 子|"])
    }

    @Test(
        "代码块（v1 不做高亮，只保留语言与代码）",
        arguments: [
            ("```swift\nlet a = 1\n```", "code(swift)|let a = 1 text=|let a = 1|"),
            ("```\ncode\n```", "code(nil)|code text=|code|"),
            ("```swift\nlet a = 1\nlet b = 2\n```", "code(swift)|let a = 1\nlet b = 2 text=|let a = 1⏎let b = 2|"),
            ("```swift title=x\ncode\n```", "code(swift)|code text=|code|"),
        ]
    )
    func codeBlock(source: String, expected: String) {
        #expect(describe(FMBlockParser.contents(in: source)) == [expected])
    }

    @Test("分割线")
    func divider() {
        #expect(describe(FMBlockParser.contents(in: "---")) == ["divider text=||"])
        #expect(describe(FMBlockParser.contents(in: "***")) == ["divider text=||"])
    }

    @Test("多个块按文档顺序")
    func multipleBlocks() {
        let source = "# 标题\n\n正文\n\n---\n\n- 项"
        #expect(
            describe(FMBlockParser.blocks(in: source)) == [
                "heading(1)[]",
                "paragraph[]",
                "divider",
                "bullet[()]",
            ]
        )
    }
}

@Suite("块模型：按行取用")
struct FMBlockParserLineTests {
    @Test("多行块可以按行切出来，span 偏移归一到该行")
    func lineSlices() throws {
        let contents = FMBlockParser.contents(in: "1. 甲 **粗**\n2. 乙")
        let ordered = try #require(contents.first)
        let firstLine = try #require(ordered.line(at: 0))
        #expect(firstLine.text == "甲 粗")
        #expect(firstLine.spans.map { describe($0) } == ["2+1:bold"])
        let secondLine = try #require(ordered.line(at: 1))
        #expect(secondLine.text == "乙")
        #expect(secondLine.spans.isEmpty)
        #expect(ordered.line(at: 2) == nil)
    }

    @Test("单行块只有第 0 行")
    func singleLine() {
        let contents = FMBlockParser.contents(in: "普通文本")
        #expect(contents.first?.line(at: 0)?.text == "普通文本")
        #expect(contents.first?.line(at: 1) == nil)
    }
}
