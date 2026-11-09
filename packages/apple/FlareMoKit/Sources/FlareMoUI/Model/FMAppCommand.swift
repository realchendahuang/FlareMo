import Foundation

/// 菜单命令。由 `Commands` 写入 `FMAppModel.pendingCommand`，视图消费。
public enum FMAppCommand: Sendable, Equatable {
    /// 把光标放到速记输入框（⌘N）
    case focusComposer
    /// 聚焦搜索框（⌘K）
    case focusSearch
    /// 立刻同步一轮（⌘R）
    case syncNow
}
