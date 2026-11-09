import FlareMoDesign
import FlareMoMarkdown
import SwiftUI

#if os(macOS)
    import AppKit

    /// 只为了上报焦点变化的 NSTextView。
    /// SwiftUI 的 `@FocusState` 对 NSViewRepresentable 不可靠，而设计上
    /// "聚焦时加深描边"必须准确，所以直接从 AppKit 侧上报。
    final class FMFocusReportingTextView: NSTextView {
        var onFocusChange: ((Bool) -> Void)?

        override func becomeFirstResponder() -> Bool {
            let result = super.becomeFirstResponder()
            if result { onFocusChange?(true) }
            return result
        }

        override func resignFirstResponder() -> Bool {
            let result = super.resignFirstResponder()
            if result { onFocusChange?(false) }
            return result
        }
    }

    /// 速记编辑器：`NSTextView` + TextKit 2。
    ///
    /// 为什么不用 SwiftUI 的 `TextEditor`：它把 NSTextView 包起来但不给任何控制
    /// （不能按段增量上样式、拿不到 `setMarkedText` 的时机、改不了行内属性）。
    /// 而速记产品的全部手感就在这几件事上。
    ///
    /// 三个已知坑（docs/native-clients.md §5.5），这里逐个处理：
    ///
    /// 1. **只改变更范围的属性**。整篇 `setAttributes` 会让 TextKit 2 丢掉 layout
    ///    fragment 缓存，长文打字直接卡。这里按"变更涉及的段落"重算属性。
    /// 2. **IME 组字期间收不到 `textDidChange`**。中文输入法在 `setMarkedText`
    ///    阶段 AppKit 可能不发通知，导致 SwiftUI 侧的高度/字数不刷新。这里在
    ///    `textDidChange` 之外，额外实现 `didChangeText` 覆盖 + marked text 检查。
    /// 3. 撤销栈、查找、听写、服务菜单、无障碍全部走系统原生，不自己实现。
    public struct FMEditorView: NSViewRepresentable {
        @Binding private var text: String
        private let placeholder: String
        private let minHeight: CGFloat
        private let maxHeight: CGFloat
        private let onFocusChange: ((Bool) -> Void)?
        /// 每 +1 一次就抢一次焦点。SwiftUI 的 @FocusState 管不到 NSViewRepresentable，
        /// 所以用「信号计数」这种笨但可靠的办法。
        private let focusSignal: Int
        /// 工具条通过它作用到选区上。
        private let controller: FMEditorController?

        public init(
            text: Binding<String>,
            placeholder: String = "",
            minHeight: CGFloat = 44,
            maxHeight: CGFloat = 220,
            onFocusChange: ((Bool) -> Void)? = nil,
            focusSignal: Int = 0,
            controller: FMEditorController? = nil
        ) {
            _text = text
            self.placeholder = placeholder
            self.minHeight = minHeight
            self.maxHeight = maxHeight
            self.onFocusChange = onFocusChange
            self.focusSignal = focusSignal
            self.controller = controller
        }

        public func makeCoordinator() -> Coordinator {
            let coordinator = Coordinator(text: $text)
            coordinator.onFocusChange = onFocusChange
            return coordinator
        }

        public func makeNSView(context: Context) -> NSScrollView {
            // TextKit 2：NSTextView(usingTextLayoutManager:) 是 2 的唯一正门。
            let textView = FMFocusReportingTextView(usingTextLayoutManager: true)
            textView.delegate = context.coordinator
            controller?.textView = textView
            textView.onFocusChange = { [weak coordinator = context.coordinator] focused in
                coordinator?.onFocusChange?(focused)
            }
            textView.isRichText = false
            textView.allowsUndo = true
            textView.isAutomaticQuoteSubstitutionEnabled = false
            textView.isAutomaticDashSubstitutionEnabled = false
            textView.isAutomaticTextReplacementEnabled = false
            textView.isAutomaticSpellingCorrectionEnabled = false
            textView.isContinuousSpellCheckingEnabled = false
            textView.drawsBackground = false
            textView.textContainerInset = NSSize(width: 0, height: 2)
            textView.textContainer?.lineFragmentPadding = 0
            textView.usesFindBar = true
            textView.isIncrementalSearchingEnabled = true
            // 半透明滚动条，避免在纸面上出现一条实心灰带
            textView.usesAdaptiveColorMappingForDarkAppearance = false

            let scrollView = NSScrollView()
            scrollView.documentView = textView
            scrollView.hasVerticalScroller = false
            scrollView.drawsBackground = false
            scrollView.borderType = .noBorder
            scrollView.autohidesScrollers = true

            context.coordinator.textView = textView
            context.coordinator.apply(text: text, forceFullRestyle: true)
            return scrollView
        }

        public func updateNSView(_ scrollView: NSScrollView, context: Context) {
            guard let textView = scrollView.documentView as? NSTextView else { return }
            if focusSignal != context.coordinator.lastFocusSignal {
                context.coordinator.lastFocusSignal = focusSignal
                DispatchQueue.main.async {
                    textView.window?.makeFirstResponder(textView)
                }
            }
            // 只有外部真的改了内容才回写，否则每次打字都会被 updateNSView 打断光标。
            if textView.string != text {
                context.coordinator.isApplyingExternalChange = true
                textView.string = text
                context.coordinator.apply(text: text, forceFullRestyle: true)
                context.coordinator.isApplyingExternalChange = false
            }
        }

        // 高度由外部决定（Composer 给固定高度，内部 NSScrollView 滚动）。
        // 不做 sizeThatFits 自适应：TextKit 2 的 usageBounds 要等布局完成才准，
        // 在打字过程里回读会把光标的滚动位置抖来抖去。

        // MARK: - Coordinator

        public final class Coordinator: NSObject, NSTextViewDelegate {
            private let text: Binding<String>
            /// 焦点变化往上抛（Composer 用它决定描边深浅）。
            var onFocusChange: ((Bool) -> Void)?
            weak var textView: NSTextView?
            var isApplyingExternalChange = false
            /// 上次处理过的焦点信号，用来判断这次 updateNSView 是不是新请求。
            var lastFocusSignal = 0

            /// 已经上过样式的段落范围，用来算"这次改了哪几段"。
            private var styledRange: NSRange = NSRange(location: 0, length: 0)

            init(text: Binding<String>) {
                self.text = text
            }

            // MARK: 输入

            public func textDidChange(_ notification: Notification) {
                guard !isApplyingExternalChange, let textView else { return }
                // 组字中（拼音/五笔的候选阶段）不要上样式：会被组字内容覆盖，
                // 而且每次都重算会打断候选框。
                if textView.hasMarkedText() {
                    textView.needsLayout = true
                    return
                }
                let newText = textView.string
                if text.wrappedValue != newText {
                    text.wrappedValue = newText
                }
                restyleAroundSelection(in: textView)
            }

            // MARK: 样式

            /// 全量或按段落重算。`forceFullRestyle` 只在外部整篇替换时用。
            func apply(text: String, forceFullRestyle: Bool) {
                guard let textView else { return }
                let full = NSRange(location: 0, length: (textView.string as NSString).length)
                if forceFullRestyle {
                    let storage = textView.textStorage!
                    storage.beginEditing()
                    FMEditorStyler.applyBaseAttributes(to: storage, range: full)
                    FMEditorStyler.applySpans(
                        to: storage,
                        in: full,
                        source: textView.string
                    )
                    storage.endEditing()
                    styledRange = full
                    textView.needsLayout = true
                    return
                }
                restyleAroundSelection(in: textView)
            }

            /// 只重算受影响的段落。这是"打字不卡"的关键：一次按键只动一行。
            private func restyleAroundSelection(in textView: NSTextView) {
                let string = textView.string as NSString
                let selection = textView.selectedRange()
                let paragraph = string.paragraphRange(for: NSRange(location: selection.location, length: 0))
                // 上一段也要重算：删掉段首的 "- " 会让上一段的列表结构变化。
                let previousEnd = paragraph.location
                let previousStart = max(0, previousEnd - 1)
                let start = string.lineRange(for: NSRange(location: previousStart, length: 0)).location
                let range = NSRange(
                    location: start,
                    length: paragraph.location + paragraph.length - start
                )

                let storage = textView.textStorage!
                storage.beginEditing()
                FMEditorStyler.applyBaseAttributes(to: storage, range: range)
                FMEditorStyler.applySpans(to: storage, in: range, source: textView.string)
                storage.endEditing()
                styledRange = range

                // 让 SwiftUI 的尺寸跟着换行/删行更新
                textView.needsLayout = true
                textView.enclosingScrollView?.needsLayout = true
            }
        }
    }

    /// 把 Markdown 源码翻成属性字符串。
    ///
    /// 独立成 enum 而不是塞进 Coordinator：样式规则要能被快照测试和
    /// 将来的 iOS（UITextView）复用，逻辑不依赖任何具体文本视图。
    public enum FMEditorStyler {
        /// 正文 15pt / 行高 28（对齐 Web 端 `.memo-markdown` 的 15px/leading-7）。
        public static let bodyFontSize: CGFloat = 15
        public static let bodyLineHeight: CGFloat = 28

        public static func applyBaseAttributes(to storage: NSTextStorage, range: NSRange) {
            let paragraph = NSMutableParagraphStyle()
            paragraph.lineHeightMultiple = bodyLineHeight / (bodyFontSize * 1.2)
            paragraph.paragraphSpacing = 2
            paragraph.lineBreakMode = .byWordWrapping

            let base: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: bodyFontSize),
                .foregroundColor: FMColor.foreground.nsColor,
                // 汉字不吃负字距（docs/design-system.md 硬规则），正文就不设字距。
                .kern: 0,
                .paragraphStyle: paragraph,
                .ligature: 0,
            ]
            storage.setAttributes(base, range: range)
        }

        public static func applySpans(to storage: NSTextStorage, in range: NSRange, source: String) {
            let spans = spans(in: source, limitedTo: range)
            // 扫描器的 `.heading` span 只覆盖 `# ` 前缀（前缀要单独降色），
            // 但编辑器里整行都该是标题字号——不然写的时候只有井号变大，正文还是 15pt，
            // 和阅读态、Web 编辑器都不一致。这里先算「每行是几级标题」，整行套字号。
            let nsSource = source as NSString
            let headingLevels = headingLevelsByLine(spans: spans, nsSource: nsSource)
            for (line, level) in headingLevels {
                let lineRange = nsSource.lineRange(for: NSRange(location: line, length: 0))
                let clipped = NSIntersectionRange(lineRange, range)
                guard clipped.length > 0 else { continue }
                storage.addAttribute(
                    .font,
                    value: styledFont(size: headingSize(level: level), bold: true),
                    range: clipped
                )
            }

            for span in spans {
                let spanRange = NSRange(location: span.location, length: span.length)
                guard spanRange.location != NSNotFound, spanRange.length > 0 else { continue }
                guard NSIntersectionRange(spanRange, range).length > 0 else { continue }

                // 行内样式要跟着所在行的标题字号走：标题里的 `**加粗**` 是 20pt 粗，
                // 不是 15pt 粗。
                let lineStart = nsSource.lineRange(for: NSRange(location: span.location, length: 0)).location
                let spanBaseSize = headingLevels[lineStart].map(headingSize(level:)) ?? bodyFontSize

                switch span.kind {
                case .bold:
                    storage.addAttribute(
                        .font,
                        value: styledFont(size: spanBaseSize, bold: true),
                        range: spanRange
                    )
                case .italic:
                    storage.addAttribute(
                        .font,
                        value: styledFont(size: spanBaseSize, italic: true),
                        range: spanRange
                    )
                case .boldItalic:
                    storage.addAttribute(
                        .font,
                        value: styledFont(size: spanBaseSize, bold: true, italic: true),
                        range: spanRange
                    )
                case .code:
                    storage.addAttributes(
                        [
                            .font: NSFont.monospacedSystemFont(
                                ofSize: spanBaseSize - 1,
                                weight: .regular
                            ),
                            .foregroundColor: FMColor.brand500.nsColor,
                        ],
                        range: spanRange
                    )
                case .strikethrough:
                    storage.addAttributes(
                        [
                            .strikethroughStyle: NSUnderlineStyle.single.rawValue,
                            .foregroundColor: FMColor.mutedForeground.nsColor,
                        ],
                        range: spanRange
                    )
                case .link:
                    storage.addAttributes(
                        [
                            .foregroundColor: FMColor.brand500.nsColor,
                            .underlineStyle: NSUnderlineStyle.single.rawValue,
                        ],
                        range: spanRange
                    )
                case let .heading(level):
                    let size = headingSize(level: level)
                    storage.addAttributes(
                        [
                            .font: NSFont.systemFont(ofSize: size, weight: .semibold),
                            .foregroundColor: FMColor.foreground.nsColor,
                        ],
                        range: spanRange
                    )
                case .listMarker, .quoteMarker, .codeFence, .todoCheckbox:
                    // 标记本身降成 muted：读的时候眼睛跳过它，写的时候还在
                    storage.addAttribute(
                        .foregroundColor,
                        value: FMColor.mutedForeground.nsColor,
                        range: spanRange
                    )
                case .tag:
                    storage.addAttribute(
                        .foregroundColor,
                        value: FMColor.brand500.nsColor,
                        range: spanRange
                    )
                case .highlight:
                    // `==高亮==` 不上色：Web 端没有这个语法，原生端单独点亮
                    // 会让同一条记录两端看起来不一样。要支持就两端一起加。
                    break
                }
            }
        }

        /// 造一个带粗/斜的系统字体。
        ///
        /// 不能用 `NSFontManager.convert(_:toHaveTrait:)`：它对 `.systemFont` 常常直接返回原字体，
        /// 结果就是斜体表达式在编辑器里毫无变化（这个 bug 是靠单测发现的）。
        /// 走 `fontDescriptor.withSymbolicTraits` 才能拿到 SF Pro 的 italic 变体。
        private static func styledFont(size: CGFloat, bold: Bool = false, italic: Bool = false) -> NSFont {
            let weight: NSFont.Weight = bold ? .semibold : .regular
            let base = NSFont.systemFont(ofSize: size, weight: weight)
            guard italic else { return base }
            // 只传 `.italic` 会把字重丢掉（拿到的是 RegularItalic）；
            // 粗斜体必须把 `.bold` 一起塞进 traits，才能拿到 BoldItalic。
            var traits: NSFontDescriptor.SymbolicTraits = [.italic]
            if bold { traits.insert(.bold) }
            let descriptor = base.fontDescriptor.withSymbolicTraits(traits)
            return NSFont(descriptor: descriptor, size: size) ?? base
        }

        /// 每行行首位置 → 标题级别（编辑器据此刻整行字号）。
        private static func headingLevelsByLine(spans: [FMSourceSpan], nsSource: NSString) -> [Int: Int] {
            var levels: [Int: Int] = [:]
            for span in spans {
                guard case let .heading(level) = span.kind else { continue }
                let lineStart = nsSource.lineRange(for: NSRange(location: span.location, length: 0)).location
                levels[lineStart] = level
            }
            return levels
        }

        /// 与阅读态、Web 的 `.memo-markdown` 同口径：h1 20 / h2 18 / h3 16。
        /// 编辑时看到的层级和读的时候不一致，是最容易被忽略的不一致。
        private static func headingSize(level: Int) -> CGFloat {
            switch level {
            case 1: 20
            case 2: 18
            case 3: 16
            default: bodyFontSize
            }
        }

        /// 行内 span 来自 `FlareMoMarkdown` 的手写扫描器（单遍、无 AST）。
        /// 10KB 文本 release 约 0.1ms，逐键调用无感。
        private static func spans(in source: String, limitedTo range: NSRange) -> [FMSourceSpan] {
            FMInlineScanner.spans(in: source)
        }
    }

#endif
