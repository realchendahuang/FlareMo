//
//  FMBlockViewTests.swift
//  FlareMoUITests
//
//  职责：阅读态视图「接线」的正确性——文档解析出来的块序列、块内容、以及
//  `FMBlockView` 的两种初始化是否把同一份块喂给了渲染层。
//  渲染像素靠预览器目检（详见任务约定），这里守住的是「块没丢、类型没串、文本没漏」。
//

import FlareMoMarkdown
import SwiftUI
import Testing

@testable import FlareMoUI

private func typeName(_ block: FMBlock) -> String {
    switch block {
    case .paragraph: return "paragraph"
    case .heading: return "heading"
    case .bulletList: return "bulletList"
    case .orderedList: return "orderedList"
    case .quote: return "quote"
    case .codeBlock: return "codeBlock"
    case .divider: return "divider"
    case .todo: return "todo"
    case .blankLine: return "blankLine"
    }
}

/// 一份把所有块级形态都用上的文档（和 `FMReadingSample` 分开写，测试不依赖生产样例的措辞）。
private let fullDocument = """
# 标题

正文 **粗** 和 `码`。

- 项目一
- 项目二

1. 甲
2. 乙

> 引用一

```swift
let a = 1
```

---

- [ ] 待办
- [x] 完成
"""

@MainActor
@Suite("阅读态视图接线")
struct FMBlockViewTests {
    @Test("全类型文档：块数与类型序列正确")
    func documentBlocks() {
        let contents = FMBlockParser.contents(in: fullDocument)
        #expect(
            contents.map { typeName($0.block) } == [
                "heading",
                "paragraph",
                "bulletList",
                "orderedList",
                "quote",
                "codeBlock",
                "divider",
                "todo",
                "todo",
            ]
        )
    }

    @Test("每个块的文本 / 状态都带到了渲染层")
    func blockContents() throws {
        let contents = FMBlockParser.contents(in: fullDocument)
        #expect(contents.count == 9)

        guard case let .heading(level, _) = contents[0].block else {
            Issue.record("第一块应当是标题")
            return
        }
        #expect(level == 1)
        #expect(contents[0].text == "标题")

        #expect(contents[1].text == "正文 粗 和 码。")

        guard case let .bulletList(items) = contents[2].block else {
            Issue.record("第三块应当是无序列表")
            return
        }
        #expect(items.count == 2)
        #expect(contents[2].text == "项目一\n项目二")

        guard case let .orderedList(start, ordered) = contents[3].block else {
            Issue.record("第四块应当是有序列表")
            return
        }
        #expect(start == 1)
        #expect(ordered.count == 2)
        #expect(contents[3].text == "甲\n乙")

        guard case let .codeBlock(language, code) = contents[5].block else {
            Issue.record("第六块应当是代码块")
            return
        }
        #expect(language == "swift")
        #expect(code == "let a = 1")

        guard case let .todo(unchecked, _) = contents[7].block,
            case let .todo(checked, _) = contents[8].block
        else {
            Issue.record("最后两块应当是待办")
            return
        }
        #expect(unchecked == false)
        #expect(checked == true)
        #expect(contents[7].text == "待办")
        #expect(contents[8].text == "完成")
    }

    @Test("两种初始化喂给渲染层的是同一份块")
    func initialisersAgree() {
        let parsed = FMBlockParser.contents(in: fullDocument)
        let fromMarkdown = FMBlockView(markdown: fullDocument)
        let fromContents = FMBlockView(contents: parsed)

        #expect(fromMarkdown.contents.map { typeName($0.block) } == parsed.map { typeName($0.block) })
        #expect(fromMarkdown.contents == parsed)
        #expect(fromContents.contents == parsed)
    }

    @Test("空文档与纯空白不产生块，视图也不会崩")
    func emptyDocument() {
        for source in ["", "   ", "\n\n\n"] {
            let view = FMBlockView(markdown: source)
            #expect(view.contents.isEmpty)
            _ = view.body
        }
    }

    @Test("样例文档覆盖所有块类型与 1–6 级标题（预览器目检用同一份）")
    func sampleCoversEveryKind() {
        let contents = FMBlockParser.contents(in: FMReadingSample.markdown)
        #expect(contents.count == 18)

        #expect(
            Set(contents.map { typeName($0.block) }) == [
                "paragraph", "heading", "bulletList", "orderedList", "quote", "codeBlock", "divider", "todo",
                "blankLine",
            ]
        )

        // 样例里那条「隔了两个空行」的段落会产出 1 个 blankLine 块。
        #expect(contents.filter { typeName($0.block) == "blankLine" }.count == 1)

        let headingLevels = contents.compactMap { content -> Int? in
            guard case let .heading(level, _) = content.block else { return nil }
            return level
        }
        #expect(headingLevels == [1, 2, 3, 4, 5, 6])

        let bulletCount = contents.compactMap { content -> Int? in
            guard case let .bulletList(lines) = content.block else { return nil }
            return lines.count
        }.first
        #expect(bulletCount == 3)

        let orderedCount = contents.compactMap { content -> Int? in
            guard case let .orderedList(_, lines) = content.block else { return nil }
            return lines.count
        }.first
        #expect(orderedCount == 3)

        // 样例里的有序列表从 3 开始，用来目检「起始序号被保留」。
        let orderedStart = contents.compactMap { content -> Int? in
            guard case let .orderedList(start, _) = content.block else { return nil }
            return start
        }.first
        #expect(orderedStart == 3)

        let todoStates = contents.compactMap { content -> Bool? in
            guard case let .todo(checked, _) = content.block else { return nil }
            return checked
        }
        #expect(todoStates == [false, true])

        // 每个块要么有文本、要么是分隔线 / 空行；不能出现「块解析出来但内容全空」的漏字。
        for content in contents {
            switch content.block {
            case .divider, .blankLine: continue
            default: break
            }
            #expect(!content.text.isEmpty, "块没有内容：\(content.block)")
        }
    }

    @Test("注入的正文色与标签回调被原样存下来")
    func injectedParameters() {
        let view = FMBlockView(markdown: "正文", textColor: .red) { tag in
            _ = tag
        }
        #expect(view.textColor == .red)
        #expect(view.onTagClick != nil)

        let plain = FMBlockView(contents: [])
        #expect(plain.textColor == nil)
        #expect(plain.onTagClick == nil)
    }

    @Test("多空行文档：blankLine 块能被视图吃到并求值 body")
    func blankLinesRender() {
        let view = FMBlockView(markdown: "第一段\n\n\n第二段")
        #expect(view.contents.map { typeName($0.block) } == ["paragraph", "blankLine", "paragraph"])
        _ = view.body
    }

    @Test("所有块类型都能安全求值 body（无异步、无状态）")
    func bodyEvaluatesForEveryKind() {
        let contents = FMBlockParser.contents(in: fullDocument)
        var view = FMBlockView(contents: [])
        for content in contents {
            view = FMBlockView(contents: [content])
            _ = view.body
        }
        _ = FMBlockView(contents: contents).body
    }
}
