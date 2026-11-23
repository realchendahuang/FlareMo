#if os(iOS)
    import UIKit

    /// 键盘上方工具栏与编辑器的连接点。
    ///
    /// 工具栏按钮要「作用在光标/选区上」，而 SwiftUI 的 `@Binding<String>` 拿不到选区。
    /// 所以让 representable 把 `UITextView` 挂到这里，工具栏通过它做包装与插入——
    /// 所有修改都走同一条路径，`textViewDidChange` 会照常触发样式重算。
    @MainActor
    public final class FMIOSEditorController: ObservableObject {
        weak var textView: UITextView?

        public init() {}

        /// 用标记包住选区；没有选区就插入一对标记并把光标放在中间。
        public func wrap(_ marker: String) {
            guard let textView else { return }
            let source = textView.text as NSString
            let selection = textView.selectedRange
            let selected = selection.length > 0 ? source.substring(with: selection) : ""
            let replacement = marker + selected + marker
            let cursorOffset = marker.count + selected.count
            replace(in: textView, range: selection, with: replacement, cursorOffset: cursorOffset)
        }

        /// 在每一行的行首加/去掉前缀（列表、待办、引用）。
        public func toggleLinePrefix(_ prefix: String) {
            guard let textView else { return }
            let source = textView.text as NSString
            let selection = textView.selectedRange
            let lineRange = source.lineRange(for: selection)
            let block = source.substring(with: lineRange)
            let lines = block.components(separatedBy: "\n")
            let allPrefixed = lines.filter { !$0.isEmpty }.allSatisfy { $0.hasPrefix(prefix) }
            let updated = lines.map { line -> String in
                if line.isEmpty { return line }
                return allPrefixed ? String(line.dropFirst(prefix.count)) : prefix + line
            }
            replace(
                in: textView,
                range: lineRange,
                with: updated.joined(separator: "\n"),
                cursorOffset: nil
            )
        }

        /// 在光标处插入一段文本（标签、分隔线）。
        public func insert(_ text: String) {
            guard let textView else { return }
            replace(in: textView, range: textView.selectedRange, with: text, cursorOffset: text.count)
        }

        private func replace(
            in textView: UITextView,
            range: NSRange,
            with replacement: String,
            cursorOffset: Int?
        ) {
            guard let start = textView.position(from: textView.beginningOfDocument, offset: range.location),
                  let end = textView.position(from: start, offset: range.length),
                  let textRange = textView.textRange(from: start, to: end)
            else { return }
            textView.replace(textRange, withText: replacement)
            if let cursorOffset {
                let caret = range.location + cursorOffset
                textView.selectedRange = NSRange(location: caret, length: 0)
            }
            textView.scrollRangeToVisible(textView.selectedRange)
        }
    }
#endif
