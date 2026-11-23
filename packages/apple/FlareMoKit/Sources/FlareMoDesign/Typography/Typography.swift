import SwiftUI

/// 一档排版样式。
///
/// 数字取自 docs/design-system.md「全站统一排版阶梯（Type Scale）」，不是自己编的：
/// 页面大标题 text-xl=20、弹窗标题 text-base=16、分组标签 text-xs=12、
/// 笔记正文 15px/leading-7(28)、UI 说明 text-sm=14、侧栏项 13.5px。
public struct FMTextStyle: Sendable, Hashable {
    /// 字号（pt）。
    public let size: CGFloat
    /// 字重。
    public let weight: Font.Weight
    /// 行高（pt）。0 表示跟随系统默认（用于只有一行的控件）。
    public let lineHeight: CGFloat
    /// 负字距系数（em）。仅对拉丁文生效，CJK 一律归零，见 `resolvedTracking`。
    public let trackingEm: CGFloat
    /// 是否等宽数字（统计大数、计数徽标、时间戳）。
    public let tabularFigures: Bool

    public init(
        size: CGFloat,
        weight: Font.Weight = .regular,
        lineHeight: CGFloat = 0,
        trackingEm: CGFloat = 0,
        tabularFigures: Bool = false
    ) {
        self.size = size
        self.weight = weight
        self.lineHeight = lineHeight
        self.trackingEm = trackingEm
        self.tabularFigures = tabularFigures
    }

    /// SwiftUI 字体。等宽数字走 `Font.monospacedDigit()`，中文不受影响。
    public var font: Font {
        let base = Font.system(size: size, weight: weight)
        return tabularFigures ? base.monospacedDigit() : base
    }

    /// 实际字距（pt）。
    ///
    /// design-system.md 的硬规则：`tracking-tight` 只对拉丁语系成立，中文/日文/韩文
    /// 必须归零——汉字字面几乎占满 em 框，负字距会让笔画多的字粘连。Web 端是按
    /// `:lang()` 全局归零的，原生端按当前语言做同一件事。
    public var resolvedTracking: CGFloat {
        guard trackingEm != 0 else { return 0 }
        return FMTextStyle.isCJKLanguage ? 0 : size * trackingEm
    }

    /// 行距（SwiftUI 的 `lineSpacing` 是「行高 − 自然行高」，不是绝对行高）。
    /// 自然行高约等于字号的 1.2 倍，这里按该比例反推。
    public var resolvedLineSpacing: CGFloat {
        guard lineHeight > 0 else { return 0 }
        return max(0, lineHeight - size * 1.2)
    }

    static var isCJKLanguage: Bool {
        guard let code = Locale.current.language.languageCode?.identifier else { return false }
        return ["zh", "ja", "ko"].contains(code)
    }
}

public extension View {
    /// 应用一档排版样式。作用在容器上而不是单个 Text 上，这样多行文本的
    /// 行距与字距会统一继承下去。
    func fmTextStyle(_ style: FMTextStyle, color: Color? = nil) -> some View {
        self
            .font(style.font)
            .tracking(style.resolvedTracking)
            .lineSpacing(style.resolvedLineSpacing)
            .foregroundStyle(color ?? .primary)
    }
}

/// 全站排版阶梯。新增文案一律从这里取，不要在组件里写 `.system(size:)`。
public enum FMTypography {
    /// 统计大数：`text-2xl leading-none font-semibold tabular-nums`
    public static let display = FMTextStyle(
        size: 24, weight: .semibold, lineHeight: 24, trackingEm: -0.02, tabularFigures: true
    )

    /// 页面大标题（H1）：`text-xl font-semibold tracking-tight`
    public static let title = FMTextStyle(size: 20, weight: .semibold, trackingEm: -0.02)

    /// 弹窗/区域标题（H2）：`text-base font-semibold tracking-tight`
    public static let headline = FMTextStyle(size: 16, weight: .semibold, trackingEm: -0.015)

    /// 卡片标题、列表主文本（速记第一行）
    public static let cardTitle = FMTextStyle(size: 15, weight: .medium, lineHeight: 22)

    /// 笔记正文：15px / leading-7(28)
    public static let body = FMTextStyle(size: 15, lineHeight: 28)

    /// UI 说明文案：`text-sm leading-relaxed`
    public static let callout = FMTextStyle(size: 14, lineHeight: 21)

    /// 侧边栏与设置导航项：13.5px
    public static let navigation = FMTextStyle(size: 13.5, lineHeight: 18)

    /// 分组标签（H3/Label）：`text-xs font-medium text-muted-foreground`
    public static let label = FMTextStyle(size: 12, weight: .medium, lineHeight: 16)

    /// 辅助信息、时间戳、徽标：12px（硬下限，汉字在 12px 以下笔画粘连）
    public static let caption = FMTextStyle(size: 12, lineHeight: 16, tabularFigures: true)

    /// 代码与键盘符号
    public static let monospace = FMTextStyle(size: 13, lineHeight: 20)
}
