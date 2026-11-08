import SwiftUI

/// FlareMo "Ember" 设计系统在 Apple 端的入口。
/// 颜色 / 字体 / 间距 / 圆角 / 阴影全部由 `scripts/apple/gen-theme.mjs`
/// 从 `apps/web/src/index.css` 生成到 `Generated/Theme.swift`，禁止手写色值。
public enum FlareMoDesign {
    public static let version = "0.1.0"
}
