#if os(macOS)
import FlareMoDesign
import SwiftUI

/// 速记输入框（flomo 的 composer）。
///
/// 结构照 Web 端 `memo-composer.tsx` + `docs/design-system.md`「Composer」：
/// 纸面卡片，聚焦时只加深描边并抬高阴影——**不画焦点环**，写字的地方不该像表单。
/// 底栏与正文之间一条发丝线，空闲收起时隐去。
///
/// v1 的文本视图先用 SwiftUI 的 `TextEditor`（底层就是 NSTextView）。
/// 行内实时样式（标题/加粗/代码）要等 `MarkdownTextView`（NSTextView + TextKit 2）
/// 落地后替换，接口不变。
public struct FMComposer: View {
    @Binding private var text: String
    private let placeholder: String
    private let onSend: () -> Void
    private let focusSignal: Int
    /// 工具条要作用在选区上，得拿到 NSTextView。
    @StateObject private var editorController = FMEditorController()

    @FocusState private var isFocused: Bool
    @Environment(\.colorScheme) private var colorScheme

    public init(
        text: Binding<String>,
        placeholder: String = "记点什么…",
        focusSignal: Int = 0,
        onSend: @escaping () -> Void
    ) {
        _text = text
        self.placeholder = placeholder
        self.focusSignal = focusSignal
        self.onSend = onSend
    }

    private var hasContent: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            editor
            Rectangle()
                .fill(FMColor.border.color.opacity(0.5))
                .frame(height: 1)
            toolbar
        }
        .background {
            RoundedRectangle(cornerRadius: FMRadius.xl, style: .continuous)
                .fill(FMColor.card.color)
                .fmPaperGrain()
        }
        .overlay {
            RoundedRectangle(cornerRadius: FMRadius.xl, style: .continuous)
                .strokeBorder(
                    isFocused
                        ? FMColor.border.color
                        : FMColor.border.color.opacity(0.6),
                    lineWidth: 1
                )
        }
        .fmShadow(isFocused ? FMShadow.sm : FMShadow.xs)
        .animation(FMAnimationPolicy.animation(FMMotion.feedback), value: isFocused)
        .animation(FMAnimationPolicy.animation(FMMotion.feedback), value: hasContent)
    }

    // MARK: 正文

    private var editor: some View {
        ZStack(alignment: .topLeading) {
            #if os(macOS)
                // macOS 走真正的 NSTextView + TextKit 2（见 FMEditorView 的注释）。
                FMEditorView(
                    text: $text,
                    minHeight: 44,
                    maxHeight: 220,
                    onFocusChange: { isFocused = $0 },
                    focusSignal: focusSignal,
                    controller: editorController
                )
                .frame(height: 82)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            #else
                TextEditor(text: $text)
                    .font(.system(size: 15))
                    .lineSpacing(28 - 15 * 1.2)
                    .foregroundStyle(FMColor.cardForeground.color)
                    .scrollContentBackground(.hidden)
                    .scrollDisabled(text.isEmpty)
                    .focused($isFocused)
                    .frame(minHeight: 44, maxHeight: 220)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .accessibilityLabel("速记内容")
            #endif

            if text.isEmpty {
                Text(placeholder)
                    .font(.system(size: 15))
                    .foregroundStyle(FMColor.mutedForeground.color.opacity(0.8))
                    .padding(.horizontal, 17)
                    .padding(.vertical, 18)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
    }

    // MARK: 底栏

    private var toolbar: some View {
        HStack(spacing: 2) {
            // 三组以发丝线分隔：插入 / 结构 / 采集（docs/design-system.md「Composer」）
            // 只放真的能用的：图片与语音速记还没做，先不摆出来
            // （仓库规则：不要放未实现功能的按钮）。
            toolButton("bold", label: "加粗") { editorController.wrap("**") }
            toolButton("italic", label: "斜体") { editorController.wrap("*") }
            toolButton("chevron.left.forwardslash.chevron.right", label: "行内代码") {
                editorController.wrap("`")
            }
            toolDivider
            toolButton("list.bullet", label: "列表") { editorController.toggleLinePrefix("- ") }
            toolButton("checklist", label: "待办") { editorController.toggleLinePrefix("- [ ] ") }
            toolButton("number", label: "标签") { editorController.insert("#") }

            Spacer(minLength: 8)

            if hasContent {
                Text("⌘↩")
                    .font(.system(size: 11).monospacedDigit())
                    .foregroundStyle(FMColor.mutedForeground.color.opacity(0.8))
                    .transition(.opacity)
            }

            sendButton
        }
        .padding(.horizontal, 8)
        .frame(height: 40)
    }

    private func toolButton(_ systemImage: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 12))
                .foregroundStyle(FMColor.mutedForeground.color)
                .frame(width: 26, height: 26)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private var toolDivider: some View {
        Rectangle()
            .fill(FMColor.border.color.opacity(0.7))
            .frame(width: 1, height: 14)
            .padding(.horizontal, 4)
            .accessibilityHidden(true)
    }

    private var sendButton: some View {
        Button(action: onSend) {
            Image(systemName: "paperplane.fill")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(hasContent ? Color.white : FMColor.mutedForeground.color.opacity(0.7))
                .frame(width: 26, height: 26)
                .background {
                    Circle()
                        .fill(
                            hasContent
                                ? AnyShapeStyle(
                                    LinearGradient(
                                        colors: [FMColor.brand400.color, FMColor.brandCoral.color],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    )
                                )
                                : AnyShapeStyle(FMColor.muted.color)
                        )
                }
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(!hasContent)
        .keyboardShortcut(.return, modifiers: .command)
        .accessibilityLabel("发送")
    }
}
#endif
