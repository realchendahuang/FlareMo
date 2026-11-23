#if os(macOS)
import AppKit
import FlareMoDesign
import SwiftUI

/// 快速捕获面板的控制器（AppKit 的 `NSPanel` + SwiftUI 内容）。
///
/// 为什么不用 `MenuBarExtra`：`MenuBarExtra` 只能由用户点菜单栏图标打开，
/// 没法被全局热键「拉出来」，也没法在提交后立刻收起。
/// 一个浮动的 `NSPanel` 才是「⌘⇧Space 呼出、写完就消失」的正确形态：
/// - `.nonactivatingPanel`：不抢主窗口的 key 状态，但**能收键盘输入**
/// - `.floating`：浮在所有普通窗口之上，切到别的 App 也不挡视线
/// - `hidesOnDeactivate = true`：点别处自动消失，不用手动管生命周期
@MainActor
public final class FMQuickCaptureController {
    /// 面板里的输入内容（面板复用，不每次重建）。
    private final class Draft: ObservableObject {
        @Published var text = ""
    }

    private let draft = Draft()
    private var panel: NSPanel?
    private let onSubmit: (String) -> Void

    public init(onSubmit: @escaping (String) -> Void) {
        self.onSubmit = onSubmit
    }

    /// 呼出面板（已开着就聚焦回输入框）。
    public func show() {
        if panel == nil {
            panel = makePanel()
        }
        guard let panel else { return }
        centerOnActiveScreen(panel)
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: false)
    }

    public func hide() {
        panel?.orderOut(nil)
    }

    public func toggle() {
        if panel?.isVisible == true { hide() } else { show() }
    }

    private func makePanel() -> NSPanel {
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 320, height: 190),
            styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hidesOnDeactivate = true
        panel.isMovableByWindowBackground = true
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true

        let root = FMQuickCaptureView(
            text: Binding(
                get: { [draft] in draft.text },
                set: { [draft] value in draft.text = value }
            ),
            onSubmit: { [weak self] content in
                guard let self else { return }
                onSubmit(content)
                draft.text = ""
                hide()
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: FMRadius.xl, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: FMRadius.xl, style: .continuous)
                .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
        }

        panel.contentView = NSHostingView(rootView: root)
        return panel
    }

    private func centerOnActiveScreen(_ panel: NSPanel) {
        guard let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        let size = panel.frame.size
        // 略微偏上：视线中心比几何中心高一点，面板出现在"眼前"而不是"腰上"。
        let origin = NSPoint(
            x: visible.midX - size.width / 2,
            y: visible.midY - size.height / 2 + visible.height * 0.12
        )
        panel.setFrameOrigin(origin)
    }
}
#endif
