import SwiftUI

/// 全局动效策略。
///
/// 设计规则（docs/design-system.md「动效」）：
/// - 时长只有三档（`FMMotion.feedback/overlay/surface`），不要新增档位；
/// - 系统开启「减弱动态」时全部动画归零，这是兜底，不是给组件逐个加判断。
///
/// 这里读的是系统级开关而不是 SwiftUI 的 `Environment`，因为 `FMDuration.animation`
/// 是值类型上的计算属性、拿不到视图环境；系统开关在所有窗口上是一致的。
@MainActor
public enum FMAnimationPolicy {
    /// 系统是否要求减弱动态效果。
    public static var prefersReducedMotion: Bool {
        #if os(macOS)
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        #else
        UIAccessibility.isReduceMotionEnabled
        #endif
    }

    /// 把秒数按策略缩放：减弱动态时返回 0（SwiftUI 对 0 时长的动画等价于直接到位）。
    public static func scale(_ seconds: Double) -> Double {
        prefersReducedMotion ? 0 : seconds
    }

    /// 给 `withAnimation` 用的一站式工厂。
    public static func animation(_ duration: FMDuration, curve: FMCurve = FMMotion.signal) -> Animation {
        curve.animation(duration: duration)
    }
}
