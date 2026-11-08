import SwiftUI

#if os(macOS)
    import AppKit

    /// AppKit 侧的动态颜色。
    ///
    /// `FMColorToken.color` 给的是 SwiftUI 的 `Color`，而 `NSTextView` 的属性字符串
    /// 只认 `NSColor`。这里按同一个外观规则造一份 NSColor，保证编辑器里的正文色
    /// 和卡片、侧栏完全一致（不是"看起来差不多"）。
    public extension FMColorToken {
        var nsColor: NSColor {
            NSColor(name: nil) { appearance in
                let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
                return (isDark ? dark : light).platform
            }
        }
    }

#endif
