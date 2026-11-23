//
//  FMReadingMetricsTests.swift
//  FlareMoUITests
//
//  职责：阅读态排版档位与块间距的纯逻辑断言。
//  这些数字直接决定「详情页看起来像不像 Web」，所以钉住它们，别被无意改掉。
//

import FlareMoDesign
import FlareMoMarkdown
import SwiftUI
import Testing

@testable import FlareMoUI

@MainActor
@Suite("阅读态排版")
struct FMReadingMetricsTests {
    @Test("块间距：第一个块不留白，段落之间 4，其余 12")
    func blockSpacing() {
        #expect(FMReadingMetrics.spacing(previous: nil, current: .paragraph([])) == 0)
        #expect(
            FMReadingMetrics.spacing(previous: .paragraph([]), current: .paragraph([]))
                == FMReadingMetrics.paragraphSpacing
        )
        #expect(
            FMReadingMetrics.spacing(previous: .paragraph([]), current: .heading(level: 1, spans: []))
                == FMReadingMetrics.blockSpacing
        )
        #expect(
            FMReadingMetrics.spacing(previous: .heading(level: 1, spans: []), current: .paragraph([]))
                == FMReadingMetrics.blockSpacing
        )
        #expect(FMReadingMetrics.spacing(previous: .divider, current: .todo(checked: false, spans: [])) == FMReadingMetrics.blockSpacing)
        #expect(FMReadingMetrics.blockSpacing == 12)
        #expect(FMReadingMetrics.paragraphSpacing == 4)
    }

    @Test("标题档位：1–3 级 20/17/16 semibold，4–6 级退化为正文加粗")
    func headingStyles() {
        #expect(FMReadingMetrics.heading(level: 1).size == 20)
        #expect(FMReadingMetrics.heading(level: 2).size == 18)
        #expect(FMReadingMetrics.heading(level: 3).size == 16)
        for level in 1...3 {
            #expect(FMReadingMetrics.heading(level: level).weight == .semibold)
        }
        for level in 4...6 {
            #expect(FMReadingMetrics.heading(level: level).size == FMTypography.body.size)
            #expect(FMReadingMetrics.heading(level: level).weight == .semibold)
        }
    }

    @Test("正文与代码的档位来自设计 token")
    func bodyAndCode() {
        #expect(FMReadingMetrics.body.size == 15)
        #expect(FMReadingMetrics.body.lineHeight == 28)
        #expect(FMReadingMetrics.code.size == FMTypography.monospace.size)
        #expect(FMReadingMetrics.code.size == 13)
        #expect(FMReadingMetrics.codeBlockRadius == FMRadius.md)
        #expect(FMReadingMetrics.codeBlockPadding == 10)
    }

    @Test("有序列表序号列宽：不窄于项目符号，位数变多会变宽")
    func orderedMarkerWidth() {
        #expect(FMReadingMetrics.orderedMarkerWidth(count: 3) >= FMReadingMetrics.bulletWidth)
        #expect(FMReadingMetrics.orderedMarkerWidth(count: 3) == FMReadingMetrics.orderedMarkerWidth(count: 9))
        #expect(FMReadingMetrics.orderedMarkerWidth(count: 120) > FMReadingMetrics.orderedMarkerWidth(count: 9))
        #expect(FMReadingMetrics.orderedMarkerWidth(count: 0) >= FMReadingMetrics.bulletWidth)
        // 起始序号参与列宽：8. 开头的三项最大是 10，要按两位数留宽。
        #expect(FMReadingMetrics.orderedMarkerWidth(count: 3, start: 8) > FMReadingMetrics.orderedMarkerWidth(count: 3))
    }

    @Test("空行块：前后各 12pt 块距 + 自身 4pt，合计约一行留白")
    func blankLineSpacing() {
        #expect(
            FMReadingMetrics.spacing(previous: .paragraph([]), current: .blankLine)
                == FMReadingMetrics.blockSpacing
        )
        #expect(
            FMReadingMetrics.spacing(previous: .blankLine, current: .paragraph([]))
                == FMReadingMetrics.blockSpacing
        )
        let total = FMReadingMetrics.blockSpacing * 2 + FMReadingMetrics.paragraphSpacing
        #expect(total == 28)
    }

    @Test("有序列表序号列宽要放得下「数字 + 句点」")
    func orderedMarkerWidthFitsPeriod() {
        // 回归：宽度曾经只按「数字位数 × 9」算，正好等于数字的宽度，
        // 「1.」里的句点被挤到下一行（数字在上、句点掉下来）。
        #expect(FMReadingMetrics.orderedMarkerWidth(count: 9) >= 18)
        #expect(FMReadingMetrics.orderedMarkerWidth(count: 120) >= 27)
    }

    @Test("待办复选框在 28pt 正文行高里垂直居中")
    func todoBoxInset() {
        #expect(FMReadingMetrics.todoBoxSize == 15)
        #expect(FMReadingMetrics.todoBoxTopInset == (FMReadingMetrics.body.lineHeight - FMReadingMetrics.todoBoxSize) / 2)
    }
}
