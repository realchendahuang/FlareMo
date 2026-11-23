import FlareMoDesign
import SwiftUI

/// 菜单栏快速捕获面板的内容。
///
/// 设计目标只有一个：**从「想记」到「记完」不超过两次操作**。
/// 所以这里没有侧栏、没有标签选择器、没有格式工具栏——一个输入框一个发送键。
/// 需要排版的时候再进主窗口（`⌘↩` 记完就关）。
public struct FMQuickCaptureView: View {
    @Binding private var text: String
    private let onSubmit: (String) -> Void
    @FocusState private var focused: Bool

    public init(text: Binding<String>, onSubmit: @escaping (String) -> Void) {
        _text = text
        self.onSubmit = onSubmit
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "flame.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [FMColor.brand400.color, FMColor.brandCoral.color],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .accessibilityHidden(true)
                Text("速记")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(FMColor.mutedForeground.color)
                Spacer(minLength: 0)
                Text("⌘↩ 记下")
                    .font(.system(size: 10.5).monospacedDigit())
                    .foregroundStyle(FMColor.mutedForeground.color.opacity(0.8))
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)
            .padding(.bottom, 6)

            TextEditor(text: $text)
                .accessibilityLabel("速记内容")
                .font(.system(size: 15))
                .lineSpacing(28 - 15 * 1.2)
                .scrollContentBackground(.hidden)
                .foregroundStyle(FMColor.foreground.color)
                .focused($focused)
                .frame(height: 96)
                .padding(.horizontal, 8)
                .padding(.bottom, 6)
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text("记点什么…")
                            .font(.system(size: 15))
                            .foregroundStyle(FMColor.mutedForeground.color.opacity(0.7))
                            .padding(.horizontal, 13)
                            .padding(.vertical, 8)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                }

            HStack {
                Spacer(minLength: 0)
                Button("记下", action: submit)
                    .keyboardShortcut(.return, modifiers: .command)
                    .disabled(!canSubmit)
                    .controlSize(.small)
                    .buttonStyle(.borderedProminent)
                    .tint(FMColor.primary.color)
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 10)
        }
        .frame(width: 320)
        .background(FMColor.background.color)
        .task {
            // 面板一出现就把光标放进输入框：呼出热键之后不该再点一下才能写。
            focused = true
        }
    }

    private var canSubmit: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func submit() {
        guard canSubmit else { return }
        onSubmit(text)
        text = ""
    }
}
