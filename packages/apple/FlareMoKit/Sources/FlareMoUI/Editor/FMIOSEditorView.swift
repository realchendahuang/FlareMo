#if os(iOS)
    import FlareMoDesign
    import FlareMoMarkdown
    import SwiftUI
    import UIKit

    /// iOS 侧的编辑器。
    ///
    /// 和 macOS 的 `FMEditorView` 是**同一套规则的两份实现**：那边是 AppKit 的
    /// `NSTextView`，这边是 UIKit 的 `UITextView`。之所以不硬抽一个「跨平台文本视图」，
    /// 是因为两边的光标、选区、输入法、滚动行为差异很大，抽象层会立刻变成一堆
    /// `#if`；而样式规则（字号/行高/颜色/span 映射）是稳定的，那部分照抄即可，
    /// 两份实现都在同一个 `FMEditorStyler` 的语义下，改动时对照着改。
    public struct FMIOSEditorView: UIViewRepresentable {
        @Binding private var text: String
        private let placeholder: String
        private let autoFocus: Bool
        /// 键盘上方工具栏要通过它改选区文本（包装加粗、插列表前缀）。
        private let controller: FMIOSEditorController?

        public init(
            text: Binding<String>,
            placeholder: String = "",
            autoFocus: Bool = false,
            controller: FMIOSEditorController? = nil
        ) {
            _text = text
            self.placeholder = placeholder
            self.autoFocus = autoFocus
            self.controller = controller
        }

        public func makeUIView(context: Context) -> UITextView {
            let view = UITextView()
            view.delegate = context.coordinator
            view.backgroundColor = .clear
            view.textContainerInset = UIEdgeInsets(top: 8, left: 4, bottom: 8, right: 4)
            view.textContainer.lineFragmentPadding = 0
            view.text = text
            view.typingAttributes = FMIOSEditorStyler.baseAttributes
            FMIOSEditorStyler.apply(to: view.textStorage, source: text)
            controller?.textView = view
            if autoFocus {
                DispatchQueue.main.async { view.becomeFirstResponder() }
            }
            return view
        }

        public func updateUIView(_ view: UITextView, context: Context) {
            guard view.text != text else { return }
            // 外部改写（比如发送后清空）才回填；用户正在打字时不碰，免得光标跳位。
            let selected = view.selectedRange
            view.text = text
            view.selectedRange = NSRange(
                location: min(selected.location, (text as NSString).length),
                length: 0
            )
            FMIOSEditorStyler.apply(to: view.textStorage, source: text)
        }

        public func makeCoordinator() -> Coordinator {
            Coordinator(text: $text, placeholder: placeholder)
        }

        public final class Coordinator: NSObject, UITextViewDelegate {
            private let text: Binding<String>
            private let placeholder: String

            init(text: Binding<String>, placeholder: String) {
                self.text = text
                self.placeholder = placeholder
            }

            public func textViewDidChange(_ textView: UITextView) {
                text.wrappedValue = textView.text
                // 输入法组字期间不动样式：重写 attributes 会打断中文候选。
                guard !textView.markedTextRange.isSome else { return }
                FMIOSEditorStyler.apply(to: textView.textStorage, source: textView.text)
                textView.typingAttributes = FMIOSEditorStyler.baseAttributes
            }

            public func textView(
                _ textView: UITextView,
                shouldChangeTextIn range: NSRange,
                replacementText replacement: String
            ) -> Bool {
                true
            }
        }
    }

    private extension Optional {
        var isSome: Bool { self != nil }
    }

    /// iOS 侧的样式规则。
    ///
    /// 与 macOS 的 `FMEditorStyler` 同口径：正文 15/28、标题 20/18/16、
    /// 加粗用 semibold、斜体走 descriptor 的 `.italic`（系统字体的 italic 变体只能这么拿）。
    public enum FMIOSEditorStyler {
        public static let bodyFontSize: CGFloat = 15
        public static let bodyLineHeight: CGFloat = 28

        public static var baseAttributes: [NSAttributedString.Key: Any] {
            let paragraph = NSMutableParagraphStyle()
            paragraph.lineHeightMultiple = bodyLineHeight / (bodyFontSize * 1.2)
            paragraph.paragraphSpacing = 2
            paragraph.lineBreakMode = .byWordWrapping
            return [
                .font: UIFont.systemFont(ofSize: bodyFontSize),
                .foregroundColor: UIColor(FMColor.foreground.color),
                .kern: 0,
                .paragraphStyle: paragraph,
                .ligature: 0,
            ]
        }

        public static func apply(to storage: NSTextStorage?, source: String) {
            guard let storage else { return }
            let full = NSRange(location: 0, length: (source as NSString).length)
            guard full.length > 0 else { return }
            storage.setAttributes(baseAttributes, range: full)

            let nsSource = source as NSString
            let spans = FMInlineScanner.spans(in: source)

            // 标题整行放大（扫描器的 heading span 只覆盖 `# ` 前缀）
            var headingLevelByLine: [Int: Int] = [:]
            for span in spans {
                guard case let .heading(level) = span.kind else { continue }
                let lineStart = nsSource.lineRange(for: NSRange(location: span.location, length: 0)).location
                headingLevelByLine[lineStart] = level
            }
            for (lineStart, level) in headingLevelByLine {
                let lineRange = nsSource.lineRange(for: NSRange(location: lineStart, length: 0))
                storage.addAttribute(
                    .font,
                    value: font(size: headingSize(level: level), bold: true),
                    range: lineRange
                )
            }

            for span in spans {
                let range = NSRange(location: span.location, length: span.length)
                guard range.length > 0, NSMaxRange(range) <= nsSource.length else { continue }
                let lineStart = nsSource.lineRange(for: NSRange(location: span.location, length: 0)).location
                let baseSize = headingLevelByLine[lineStart].map(headingSize(level:)) ?? bodyFontSize

                switch span.kind {
                case .bold:
                    storage.addAttribute(.font, value: font(size: baseSize, bold: true), range: range)
                case .italic:
                    storage.addAttribute(.font, value: font(size: baseSize, italic: true), range: range)
                case .boldItalic:
                    storage.addAttribute(.font, value: font(size: baseSize, bold: true, italic: true), range: range)
                case .code:
                    storage.addAttributes(
                        [
                            .font: UIFont.monospacedSystemFont(ofSize: baseSize - 1, weight: .regular),
                            .foregroundColor: UIColor(FMColor.brand500.color),
                        ],
                        range: range
                    )
                case .strikethrough:
                    storage.addAttributes(
                        [
                            .strikethroughStyle: NSUnderlineStyle.single.rawValue,
                            .foregroundColor: UIColor(FMColor.mutedForeground.color),
                        ],
                        range: range
                    )
                case .link:
                    storage.addAttributes(
                        [
                            .foregroundColor: UIColor(FMColor.brand500.color),
                            .underlineStyle: NSUnderlineStyle.single.rawValue,
                        ],
                        range: range
                    )
                case let .heading(level):
                    storage.addAttribute(
                        .font,
                        value: font(size: headingSize(level: level), bold: true),
                        range: range
                    )
                case .listMarker, .quoteMarker, .codeFence, .todoCheckbox:
                    storage.addAttribute(
                        .foregroundColor,
                        value: UIColor(FMColor.mutedForeground.color),
                        range: range
                    )
                case .tag:
                    // 编辑态标签上色（阅读态不上色）：写的时候能看见自己打了标签。
                    storage.addAttribute(
                        .foregroundColor,
                        value: UIColor(FMColor.brand500.color),
                        range: range
                    )
                case .highlight:
                    break
                }
            }
        }

        static func headingSize(level: Int) -> CGFloat {
            switch level {
            case 1: 20
            case 2: 18
            case 3: 16
            default: bodyFontSize
            }
        }

        /// 斜体只能靠 descriptor 拿：`UIFont` 没有直接的 italic 构造函数，
        /// 而 `.italic` 单独传会丢掉字重，所以粗斜体要把 `.traitBold` 一起传。
        static func font(size: CGFloat, bold: Bool = false, italic: Bool = false) -> UIFont {
            let base = bold
                ? UIFont.systemFont(ofSize: size, weight: .semibold)
                : UIFont.systemFont(ofSize: size)
            guard italic else { return base }
            var traits: UIFontDescriptor.SymbolicTraits = [.traitItalic]
            if bold { traits.insert(.traitBold) }
            guard let descriptor = base.fontDescriptor.withSymbolicTraits(traits) else { return base }
            return UIFont(descriptor: descriptor, size: size)
        }
    }
#endif
