import FlareMoDesign
import FlareMoUI
import SwiftUI

/// macOS App 入口。
///
/// 职责只有三件：开窗口、装命令、装菜单栏速记。界面本体全在 `FlareMoUI`
/// 里，这样 iOS 端能复用同一批视图，将来建 Xcode 工程时它也只是一层壳。
@main
struct FlareMoMacApp: App {
    /// 本地库 → 界面的唯一数据入口。
    @State private var model = FMAppModel()

    var body: some Scene {
        WindowGroup("FlareMo") {
            FMWorkspaceRoot(model: model)
            .frame(minWidth: 980, minHeight: 620)
            .background(FMColor.background.color)
        }
        .windowStyle(.hiddenTitleBar)
        .windowToolbarStyle(.unifiedCompact)
        .defaultSize(width: 1360, height: 860)
        .commands {
            FlareMoCommands()
        }

        // 设置窗（⌘,）。SwiftUI 会把它挂到 App 菜单的「设置…」上。
        Settings {
            FMSettingsView(sync: model.sync)
        }
    }
}

/// macOS 的菜单与快捷键。
///
/// 快捷键在这一层声明而不是视图里，理由：菜单栏里能看到、能发现、能和系统
/// 其他 App 的冲突处理走同一套机制（这是原生端相对网页壳最大的一块体验差）。
struct FlareMoCommands: Commands {
    var body: some Commands {
        CommandGroup(after: .newItem) {
            Button("新建速记") {}
                .keyboardShortcut("n", modifiers: .command)
            Button("快速记录") {}
                .keyboardShortcut(" ", modifiers: [.command, .shift])
        }
    }
}

// MARK: - 占位数据

/// 本地库接上之前，App 启动先用这组数据把界面点亮。
/// 接 GRDB 之后这里会被 `MemoStore` 的 `ValueObservation` 整体替掉。
@MainActor
enum SampleMemos {
    static let stats = FMSidebarStats(recordCount: 0, tagCount: 0, streakDays: 0)
    static let tags: [String] = []
    static let all: [MemoPresentation] = []
}
