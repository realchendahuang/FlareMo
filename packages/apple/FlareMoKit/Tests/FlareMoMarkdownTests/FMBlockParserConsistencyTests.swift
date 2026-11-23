//
//  FMBlockParserConsistencyTests.swift
//  FlareMoMarkdownTests
//
//  职责：钉住「编辑器扫描器」和「阅读态块模型」对同一段文字给出的结论一致。
//  两条路径的实现完全不同（手写扫描 vs cmark AST），只要口径漂了，就会出现
//  「编辑时是粗体、发出去变普通字」这类最让人困惑的问题。
//
//  也顺手把两处**有意的不一致**写成用例，避免以后被当成 bug 改掉：
//  1. `#标签`：编辑器里是 span（要上色成 chip），阅读态是普通文字（标签是查询维度）。
//  2. `==高亮==`：Apple 端编辑器扩展语法，Web 端没有，阅读态不渲染。
//

import Testing

@testable import FlareMoMarkdown

@Suite("一致性：编辑器扫描器 vs 阅读态块模型")
struct FMBlockParserConsistencyTests {
    @Test(
        "单行行内语法：种类序列与覆盖的文字一致",
        arguments: [
            "**粗**",
            "*斜*",
            "_斜_",
            "***粗斜***",
            "`码`",
            "~~删~~",
            "[文字](url)",
            "**粗** 和 `码`",
            "中文 **粗** 体",
            "a [链](u) b `码`",
        ]
    )
    func inlineFormsMatch(source: String) {
        let scannerSpans = FMInlineScanner.spans(in: source)
        let blocks = FMBlockParser.blocks(in: source)
        #expect(blocks.count == 1)
        let blockSpans = inlineSpans(of: blocks[0])
        #expect(scannerSpans.map { kindName($0.kind) } == blockSpans.map { kindName($0.kind) })
        #expect(scannerSpans.map { text(of: $0, in: source) } == blockSpans.map { text(of: $0, in: FMBlockParser.contents(in: source)[0].text) })
    }

    @Test("嵌套强调：两边都给出 外层加粗 + 内层斜体")
    func nestedFormsMatch() {
        let source = "**粗 *斜* 体**"
        let scannerKinds = FMInlineScanner.spans(in: source).map { kindName($0.kind) }
        let blocks = FMBlockParser.blocks(in: source)
        let blockKinds = inlineSpans(of: blocks[0]).map { kindName($0.kind) }
        #expect(scannerKinds == ["bold", "italic"])
        #expect(blockKinds == ["bold", "italic"])
    }

    @Test("标题等级一致")
    func headingLevelsMatch() {
        for level in 1...6 {
            let source = String(repeating: "#", count: level) + " 标题"
            #expect(FMInlineScanner.spans(in: source).map(\.kind) == [.heading(level: level)])
            #expect(FMBlockParser.blocks(in: source) == [.heading(level: level, spans: [])])
        }
    }

    @Test("待办状态一致")
    func todoMatches() {
        for (source, checked) in [("- [ ] 待办", false), ("- [x] 完成", true), ("- [X] 完成", true)] {
            #expect(FMInlineScanner.spans(in: source).map(\.kind) == [.todoCheckbox(checked: checked)])
            #expect(FMBlockParser.blocks(in: source) == [.todo(checked: checked, spans: [])])
        }
    }

    @Test("围栏代码块的语言与代码一致")
    func codeFenceMatches() {
        let source = "```swift\nlet a = 1\n```"
        let fences = FMInlineScanner.spans(in: source).filter { $0.kind == .codeFence }
        #expect(fences.count == 2)
        #expect(text(of: fences[0], in: source) == "```swift")
        #expect(text(of: fences[1], in: source) == "```")
        #expect(
            FMBlockParser.blocks(in: source) == [.codeBlock(language: "swift", code: "let a = 1")]
        )
    }

    @Test("标签：编辑器有 span，阅读态不特殊渲染")
    func tagOnlyInEditor() {
        let source = "#读书 心得"
        #expect(FMInlineScanner.spans(in: source).map { kindName($0.kind) } == ["tag(#读书)"])
        #expect(inlineSpans(of: FMBlockParser.blocks(in: source)[0]).isEmpty)
        #expect(FMBlockParser.contents(in: source)[0].text == "#读书 心得")
    }

    @Test("高亮：Apple 端编辑器扩展，阅读态不渲染（Web 端没有这个语法）")
    func highlightOnlyInEditor() {
        let source = "==高亮=="
        #expect(FMInlineScanner.spans(in: source).map(\.kind) == [.highlight])
        #expect(inlineSpans(of: FMBlockParser.blocks(in: source)[0]).isEmpty)
    }

    @Test("列表项文字：编辑器只认标记，阅读态只认内容")
    func listItemAgreement() {
        let source = "- 甲\n- 乙"
        #expect(FMInlineScanner.spans(in: source).map { kindName($0.kind) } == ["listMarker", "listMarker"])
        let contents = FMBlockParser.contents(in: source)
        #expect(contents.count == 1)
        #expect(contents[0].text == "甲\n乙")
    }
}
