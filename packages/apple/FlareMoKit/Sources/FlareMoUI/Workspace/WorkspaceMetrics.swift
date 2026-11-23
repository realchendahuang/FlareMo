import FlareMoDesign
import SwiftUI

/// 工作区布局尺寸。
///
/// 数字不是随手定的，来自 Web 端的 flomo 式框架
/// （`apps/web/src/components/workspace/workspace-shell.tsx`）：
/// 整组 `[gutter | 侧栏 | 拖拽条 | 640 内容列 | gutter]` 居中，
/// 换成原生端必须逐项对上，否则两个客户端的"呼吸感"会不一样。
public enum FMWorkspaceMetrics {
    /// 侧栏默认宽度（flomo 的侧栏轨宽）。
    public static let sidebarWidth: CGFloat = 312
    /// 侧栏可拖到的最窄宽度。
    public static let sidebarMinWidth: CGFloat = 216
    /// 框架两侧留白。
    public static let frameGutter: CGFloat = 10
    /// 侧栏与内容之间的拖拽热区。
    public static let resizerWidth: CGFloat = 8
    /// 不特别指定的页面，内容列最宽 640。
    public static let contentMaxWidth: CGFloat = 640
    /// 侧栏显隐的动画时长（Web 端 400ms）。
    public static let sidebarMotion = FMDuration(milliseconds: 400)

    // MARK: 列表与卡片

    /// 卡片纵向间距（Web 端 `space-y-3` = 12）。
    public static let cardSpacing: CGFloat = 12
    /// 卡片内边距：水平 16、垂直 14（`px-4 py-3.5`）。
    public static let cardPaddingHorizontal: CGFloat = 16
    public static let cardPaddingVertical: CGFloat = 14
    /// 卡片内元素间距（`gap-2`）。
    public static let cardInnerSpacing: CGFloat = 8

    // MARK: 导航行

    /// 导航行高（`h-8`）。
    public static let navRowHeight: CGFloat = 32
    /// 导航行左右内边距（`px-2.5`）。
    public static let navRowPaddingHorizontal: CGFloat = 10
    /// 导航行图标与文字间距（`gap-2.5`）。
    public static let navRowIconSpacing: CGFloat = 10
    /// 导航行图标尺寸（`size-4`）。
    public static let navIconSize: CGFloat = 16

    /// 列表入场 stagger：每张卡延迟 35ms，最多 8 张（Web 端 `Math.min(index, 7) * 35`）。
    public static func entranceDelay(index: Int) -> Double {
        Double(min(index, 7)) * 0.035
    }
}
