import FlareMoDesign
import FlareMoUI
import SwiftUI

/// macOS App 入口（Xcode 工程里的 target）。
///
/// 只有一层壳：窗口、菜单命令、快速捕获。界面本体全在 `FlareMoUI` 里。
/// 内核包里的 `FlareMoMac` 可执行目标是同一份逻辑的「没有 Xcode 也能跑」版本。
@main
struct FlareMoMacOSApp: App {
    /// 本地库（SQLite）→ 界面。界面永远读它，导航不发网络请求。
    @State private var model = FMAppModel()
    @State private var quickCapture: FMQuickCaptureController?
    @State private var hotkey: FMGlobalHotkey?

    var body: some Scene {
        WindowGroup("FlareMo") {
            FMWorkspaceRoot(model: model)
                .frame(minWidth: 980, minHeight: 620)
                .background(FMColor.background.color)
                .task { installQuickCapture() }
        }
        .windowStyle(.hiddenTitleBar)
        .windowToolbarStyle(.unifiedCompact)
        .defaultSize(width: 1360, height: 860)
        .commands {
            CommandGroup(after: .newItem) {
                Button("新建速记") { model.pendingCommand = .focusComposer }
                    .keyboardShortcut("n", modifiers: .command)
                Button("快速记录") { quickCapture?.show() }
                    .keyboardShortcut(" ", modifiers: [.command, .shift])
                Button("搜索") { model.pendingCommand = .focusSearch }
                    .keyboardShortcut("k", modifiers: .command)
            }
            CommandGroup(after: .saveItem) {
                Button("立即同步") { model.pendingCommand = .syncNow }
                    .keyboardShortcut("r", modifiers: .command)
            }
        }

        Settings {
            FMSettingsView(sync: model.sync)
        }
    }

    private func installQuickCapture() {
        guard quickCapture == nil else { return }
        let controller = FMQuickCaptureController { content in
            _ = model.createMemo(content: content)
        }
        let registered = FMGlobalHotkey()
        registered.registerCommandShiftSpace { controller.toggle() }
        quickCapture = controller
        hotkey = registered
    }
}
