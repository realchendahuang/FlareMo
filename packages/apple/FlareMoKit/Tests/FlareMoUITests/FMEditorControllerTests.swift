import AppKit
import Testing

@testable import FlareMoUI

/// 工具条按钮的单测。
///
/// 这些按钮之前是 `Button {}` 空实现——点了毫无反应。接上之后必须验证
/// 「作用在选区上」这件事真的成立：包装、行首前缀、插入位置对不对。
/// 用真的 `NSTextView` 测，不用假对象——选区 API 的边界（空选区、跨行）只有真的才准。
@MainActor
@Suite("编辑器工具条")
struct FMEditorControllerTests {
    private func makeController(_ text: String) -> (FMEditorController, NSTextView) {
        let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: 400, height: 200))
        textView.string = text
        let controller = FMEditorController()
        controller.textView = textView
        return (controller, textView)
    }

    @Test("加粗：有选区时包住选中文字")
    func wrapSelection() {
        let (controller, textView) = makeController("粗体")
        textView.setSelectedRange(NSRange(location: 0, length: 2))
        controller.wrap("**")
        #expect(textView.string == "**粗体**")
    }

    @Test("加粗：没有选区时插入一对标记，光标停在中间")
    func wrapEmptySelection() {
        let (controller, textView) = makeController("")
        controller.wrap("**")
        #expect(textView.string == "****")
        #expect(textView.selectedRange().location == 2)
    }

    @Test("列表：给选中的每一行加前缀")
    func toggleLinePrefixAdds() {
        let (controller, textView) = makeController("一\n二")
        textView.setSelectedRange(NSRange(location: 0, length: 3))
        controller.toggleLinePrefix("- ")
        #expect(textView.string == "- 一\n- 二")
    }

    @Test("列表：整段都带前缀时再点一次是取消")
    func toggleLinePrefixRemoves() {
        let (controller, textView) = makeController("- 一\n- 二")
        textView.setSelectedRange(NSRange(location: 0, length: 7))
        controller.toggleLinePrefix("- ")
        #expect(textView.string == "一\n二")
    }

    @Test("待办：前缀是 checkbox 而不是纯列表")
    func todoPrefix() {
        let (controller, textView) = makeController("买牛奶")
        textView.setSelectedRange(NSRange(location: 0, length: 0))
        controller.toggleLinePrefix("- [ ] ")
        #expect(textView.string == "- [ ] 买牛奶")
    }

    @Test("插入：标签落在光标处")
    func insertAtCursor() {
        let (controller, textView) = makeController("笔记")
        textView.setSelectedRange(NSRange(location: 0, length: 0))
        controller.insert("#")
        #expect(textView.string == "#笔记")
    }

    @Test("没有挂 textView 时点了不崩")
    func controllerWithoutTextViewIsSafe() {
        let controller = FMEditorController()
        controller.wrap("**")
        controller.toggleLinePrefix("- ")
        controller.insert("#")
        #expect(controller.textView == nil)
    }
}
