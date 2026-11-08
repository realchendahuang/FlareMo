import Foundation

/// FlareMo Apple 端内核：本地库、API 客户端、离线同步。
///
/// 这一层不 import SwiftUI / AppKit —— 它必须能在 iOS、macOS 以及未来的
/// 命令行工具里跑，单元测试不启动任何窗口。
public enum FlareMoCore {
    /// 内核包版本，与 App 的 MARKETING_VERSION 独立（内核改动不必发版）。
    public static let version = "0.1.0"
}
