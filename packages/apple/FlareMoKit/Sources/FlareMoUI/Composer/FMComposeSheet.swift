#if os(iOS)
    import FlareMoDesign
    import SwiftUI

    /// iOS 的全屏速记编辑器。
    ///
    /// 手机上「写长内容」的体验决定这个 App 能不能当主力：吸底输入框只适合一句话。
    /// 这里给一个整屏编辑器 + 键盘上方工具条（`**`、`*`、列表、待办、标签、分隔线），
    /// 因为在手机上敲 Markdown 标记的成本比桌面上高得多。
    public struct FMComposeSheet: View {
        @Binding private var text: String
        private let onSend: () -> Void

        @StateObject private var editorController = FMIOSEditorController()
        @FocusState private var focused: Bool
        @State private var counter = 0

        public init(text: Binding<String>, onSend: @escaping () -> Void) {
            _text = text
            self.onSend = onSend
        }

        public var body: some View {
            NavigationStack {
                ZStack(alignment: .topLeading) {
                    FMIOSEditorView(
                        text: $text,
                        placeholder: "",
                        autoFocus: true,
                        controller: editorController
                    )
                    .scrollContentBackground(.hidden)

                    if text.isEmpty {
                        Text("记点什么…")
                            .font(.system(size: 15))
                            .foregroundStyle(FMColor.mutedForeground.color.opacity(0.7))
                            .padding(.top, 16)
                            .padding(.leading, 5)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                }
                .background(FMColor.background.color)
                .navigationTitle("新速记")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("取消") {
                            text = ""
                            onSend()
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("记下") {
                            onSend()
                        }
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .fontWeight(.semibold)
                    }
                    ToolbarItemGroup(placement: .keyboard) {
                        keyboardToolbar
                    }
                }
            }
        }

        private var keyboardToolbar: some View {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    toolbarButton("bold", label: "加粗") { editorController.wrap("**") }
                    toolbarButton("italic", label: "斜体") { editorController.wrap("*") }
                    toolbarButton("list.bullet", label: "列表") { editorController.toggleLinePrefix("- ") }
                    toolbarButton("checklist", label: "待办") { editorController.toggleLinePrefix("- [ ] ") }
                    toolbarButton("number", label: "标签") { editorController.insert("#") }
                    toolbarButton("minus", label: "分隔线") { editorController.insert("\n---\n") }
                }
                .padding(.horizontal, 16)
            }
        }

        private func toolbarButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
            Button(action: action) {
                Image(systemName: symbol)
                    .font(.system(size: 16))
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(FMColor.foreground.color)
            .accessibilityLabel(label)
        }
    }
#endif
