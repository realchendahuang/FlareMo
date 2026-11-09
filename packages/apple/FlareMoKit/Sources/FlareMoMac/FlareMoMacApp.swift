import FlareMoDesign
import FlareMoUI
import SwiftUI

/// macOS App 入口。
///
/// 职责只有三件事：开窗口、装菜单命令、装菜单栏快速捕获。
/// 界面本体全在 `FlareMoUI` 里，iOS 端复用同一批视图。
@main
struct FlareMoMacApp: App {
    /// 本地库 → 界面的唯一数据入口。
    @State private var model = FMAppModel()
    /// 快速捕获的浮动面板（⌘⇧Space 呼出）。首帧之后再建，因为它要拿 model 落库。
    @State private var quickCapture: FMQuickCaptureController?
    /// 全局热键要有人持有，否则注册完就被释放。
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
            FlareMoCommands(model: model, onQuickCapture: { quickCapture?.show() })
        }

        Settings {
            FMSettingsView(sync: model.sync)
        }
    }

    /// 装一个全局热键 + 一个浮动面板。
    ///
    /// 只做一次：`@State` 里存引用，重复调用直接返回，避免注册多个热键。
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

/// macOS 的菜单与快捷键。
///
/// 快捷键在这一层声明而不是视图里：菜单栏里能看到、能发现，
/// 也能和系统里其它 App 的冲突走同一套处理机制。
struct FlareMoCommands: Commands {
    let model: FMAppModel
    let onQuickCapture: () -> Void

    var body: some Commands {
        CommandGroup(after: .newItem) {
            Button("新建速记") { model.pendingCommand = .focusComposer }
                .keyboardShortcut("n", modifiers: .command)
            Button("快速记录") { onQuickCapture() }
                .keyboardShortcut(" ", modifiers: [.command, .shift])
            Button("搜索") { model.pendingCommand = .focusSearch }
                .keyboardShortcut("k", modifiers: .command)
        }
        CommandGroup(after: .saveItem) {
            Button("立即同步") { model.pendingCommand = .syncNow }
                .keyboardShortcut("r", modifiers: .command)
        }
    }
}
