//
//  FlareMoMarkdownTests.swift
//  FlareMoMarkdownTests
//
//  职责：模块门面与公共类型的自洽性（版本号、span 几何、种类分类）。
//  具体语法的用例在 `FMInlineScanner*` 与 `FMBlockParser*` 两个文件族里。
//

import Testing

@testable import FlareMoMarkdown

@Suite("模块基础")
struct FlareMoMarkdownBasics {
    @Test("版本号非空")
    func versionIsSet() {
        #expect(!FlareMoMarkdown.version.isEmpty)
    }

    @Test("span 的偏移、range、end 自洽")
    func spanGeometry() {
        let span = FMSourceSpan(location: 3, length: 4, kind: .bold)
        #expect(span.range == 3..<7)
        #expect(span.end == 7)
    }

    @Test("行内 / 块级分类：块级标记不覆盖正文文字")
    func kindClassification() {
        #expect(FMSpanKind.bold.isInline)
        #expect(FMSpanKind.link(url: nil).isInline)
        #expect(FMSpanKind.tag("#读书").isInline)
        #expect(FMSpanKind.heading(level: 1).isBlockLevel)
        #expect(FMSpanKind.listMarker.isBlockLevel)
        #expect(FMSpanKind.codeFence.isBlockLevel)
        #expect(FMSpanKind.todoCheckbox(checked: true).isBlockLevel)
        #expect(!FMSpanKind.listMarker.isInline)
    }
}
