#if os(macOS)
    import AppKit

    /// 工具条与 `NSTextView` 的连接点（macOS）。
    ///
    /// 和 iOS 的 `FMIOSEditorController` 同一个思路：`@Binding<String>` 拿不到选区，
    /// 而「加粗选中文字」「给这行加列表前缀」必须知道光标在哪。
    /// representable 把 textView 挂上来，工具条通过它改文本——所有修改都走
    /// `NSTextView` 自己的 `insertText`/`replaceCharacters`，撤销栈和样式重算照常工作。
    @MainActor
    public final class FMEditorController: ObservableObject {
        weak var textView: NSTextView?

        public init() {}

        /// 用标记包住选区；没有选区就插入一对并把光标放中间。
        public func wrap(_ marker: String) {
            guard let textView else { return }
            let range = textView.selectedRange()
            let source = textView.string as NSString
            let selected = range.length > 0 ? source.substring(with: range) : ""
            let replacement = marker + selected + marker
            replace(in: textView, range: range, with: replacement)
            textView.setSelectedRange(NSRange(location: range.location + marker.count, length: selected.count))
        }

        /// 给选中的每一行加/去前缀（列表、待办、引用）。整段都带了就当作取消。
        public func toggleLinePrefix(_ prefix: String) {
            guard let textView else { return }
            let source = textView.string as NSString
            let selection = textView.selectedRange()
            let lineRange = source.lineRange(for: selection)
            let block = source.substring(with: lineRange)
            let lines = block.components(separatedBy: "\n")
            let allPrefixed = lines.filter { !$0.isEmpty }.allSatisfy { $0.hasPrefix(prefix) }
            let updated = lines.map { line -> String in
                if line.isEmpty { return line }
                return allPrefixed ? String(line.dropFirst(prefix.count)) : prefix + line
            }
            replace(in: textView, range: lineRange, with: updated.joined(separator: "\n"))
        }

        /// 在光标处插入一段文本。
        public func insert(_ text: String) {
            guard let textView else { return }
            replace(in: textView, range: textView.selectedRange(), with: text)
        }

        private func replace(in textView: NSTextView, range: NSRange, with replacement: String) {
            guard textView.shouldChangeText(in: range, replacementString: replacement) else { return }
            textView.textStorage?.replaceCharacters(in: range, with: replacement)
            textView.didChangeText()
            textView.setSelectedRange(NSRange(location: range.location + replacement.count, length: 0))
            textView.scrollRangeToVisible(textView.selectedRange())
        }
    }
#endif
