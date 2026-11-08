import FlareMoDesign
import FlareMoUI
import SwiftUI

/// macOS App 入口（Xcode 工程里的 target）。
///
/// 只有一层壳：窗口、菜单命令、设置窗。界面本体全在 `FlareMoUI` 里，
/// iOS target 复用同一批视图。内核包里的 `FlareMoMac` 可执行目标是同一份
/// 逻辑的"没有 Xcode 也能跑"版本，两者故意保持极薄以免漂移。
@main
struct FlareMoMacOSApp: App {
    var body: some Scene {
        WindowGroup("FlareMo") {
            FMWorkspaceRoot()
                .frame(minWidth: 980, minHeight: 620)
                .background(FMColor.background.color)
        }
        .windowStyle(.hiddenTitleBar)
        .windowToolbarStyle(.unifiedCompact)
        .defaultSize(width: 1360, height: 860)
        .commands {
            CommandGroup(after: .newItem) {
                Button("新建速记") {}
                    .keyboardShortcut("n", modifiers: .command)
                Button("快速记录") {}
                    .keyboardShortcut(" ", modifiers: [.command, .shift])
            }
        }

        Settings {
            FMSettingsView()
        }
    }
}
