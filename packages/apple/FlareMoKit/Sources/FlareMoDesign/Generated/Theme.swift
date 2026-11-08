// 本文件由 scripts/apple/gen-theme.mjs 从 apps/web/src/index.css 生成，请勿手改。
// 重新生成：node scripts/apple/gen-theme.mjs（或 pnpm apple:theme）
//
// 为什么原生端不手写色值：Web 的 Ember token 是唯一事实源，手抄必然漂。
// 生成器做三件事：展开 var() → 合并 :root/.dark → oklch 转 sRGB。

import Foundation
import SwiftUI

// MARK: - 基础类型

/// 一个 sRGB 颜色，分量是 0–255 整数、alpha 是 0–1。
/// 用整数而不是浮点：生成的代码更短，且能和设计稿里的十六进制逐位对上。
public struct FMRGBA: Sendable, Hashable {
    public let red: UInt8
    public let green: UInt8
    public let blue: UInt8
    public let alpha: Double

    public init(red: UInt8, green: UInt8, blue: UInt8, alpha: Double = 1) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }

    /// 不透明时输出 `#rrggbb`，有 alpha 时输出 `#rrggbbaa`（设计对照、快照测试断言用）。
    public var hex: String {
        let base = String(format: "#%02x%02x%02x", red, green, blue)
        guard alpha < 1 else { return base }
        return base + String(format: "%02x", Int((alpha * 255).rounded()))
    }

    #if os(macOS)
    public var platform: NSColor {
        NSColor(srgbRed: CGFloat(red) / 255, green: CGFloat(green) / 255, blue: CGFloat(blue) / 255, alpha: CGFloat(alpha))
    }
    #else
    public var platform: UIColor {
        UIColor(red: CGFloat(red) / 255, green: CGFloat(green) / 255, blue: CGFloat(blue) / 255, alpha: CGFloat(alpha))
    }
    #endif
}

/// 亮/暗成对的颜色 token。解析是懒的：跟随系统外观自动切换，不缓存。
public struct FMColorToken: Sendable {
    public let light: FMRGBA
    public let dark: FMRGBA

    public init(light: FMRGBA, dark: FMRGBA) {
        self.light = light
        self.dark = dark
    }

    /// 跟随系统外观的 SwiftUI 颜色。
    public var color: Color {
        #if os(macOS)
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return (isDark ? dark : light).platform
        })
        #else
        Color(uiColor: UIColor { traits in
            (traits.userInterfaceStyle == .dark ? dark : light).platform
        })
        #endif
    }

    /// 指定外观取色（快照测试固定 light/dark 用，正常界面用 `color`）。
    public func color(for colorScheme: ColorScheme) -> Color {
        (colorScheme == .dark ? dark : light).platform.swiftUIColor
    }
}

/// 一层阴影。CSS 的 `spread` 在 SwiftUI 没有对应参数，数值保留下来，
/// 由 `View.fmShadow(_:)` 用「放大 blur 抵消 spread」的方式近似。
public struct FMShadowLayer: Sendable, Hashable {
    public let x: CGFloat
    public let y: CGFloat
    public let blur: CGFloat
    public let spread: CGFloat
    public let rgba: FMRGBA

    public init(x: CGFloat, y: CGFloat, blur: CGFloat, spread: CGFloat, rgba: FMRGBA) {
        self.x = x
        self.y = y
        self.blur = blur
        self.spread = spread
        self.rgba = rgba
    }

    public var color: Color { rgba.platform.swiftUIColor }
}

/// 亮/暗成对的阴影 token。暗色下全部归零属于设计决定，不是缺失。
public struct FMShadowToken: Sendable {
    public let light: [FMShadowLayer]
    public let dark: [FMShadowLayer]

    public init(light: [FMShadowLayer], dark: [FMShadowLayer]) {
        self.light = light
        self.dark = dark
    }

    public func layers(for colorScheme: ColorScheme) -> [FMShadowLayer] {
        colorScheme == .dark ? dark : light
    }
}

/// 动效时长。三档是硬约束（见 docs/design-system.md「动效」），不要新增档位。
public struct FMDuration: Sendable, Hashable {
    public let milliseconds: Double

    public init(milliseconds: Double) {
        self.milliseconds = milliseconds
    }

    public var seconds: Double { milliseconds / 1000 }

    /// 平台开关 reduced-motion 时返回 0，调用方拿去喂 Animation 即可静默降级。
    @MainActor
    public var animation: Animation {
        Animation.timingCurve(0.22, 1, 0.36, 1, duration: FMAnimationPolicy.scale(seconds))
    }
}

/// 三次贝塞尔曲线，与 CSS 的 cubic-bezier(x1,y1,x2,y2) 一一对应。
public struct FMCurve: Sendable, Hashable {
    public let x1: Double
    public let y1: Double
    public let x2: Double
    public let y2: Double

    public init(x1: Double, y1: Double, x2: Double, y2: Double) {
        self.x1 = x1
        self.y1 = y1
        self.x2 = x2
        self.y2 = y2
    }

    @MainActor
    public func animation(duration: FMDuration) -> Animation {
        Animation.timingCurve(x1, y1, x2, y2, duration: FMAnimationPolicy.scale(duration.seconds))
    }
}

// MARK: - Tokens

/// Ember 配色的全部颜色 token。每一项都是亮/暗成对的，跟随系统外观解析。
public enum FMColor {
    // MARK: 品牌色阶

    /// 火焰橙 → 珊瑚，来自 logo 渐变采样。品牌色只用于主操作、激活态与置顶标记，不铺大面积。
    /// `--brand-50`
    public static let brand50 = FMColorToken(
        light: FMRGBA(red: 255, green: 238, blue: 227, alpha: 1),
        dark: FMRGBA(red: 255, green: 238, blue: 227, alpha: 1)
    )

    /// `--brand-100`
    public static let brand100 = FMColorToken(
        light: FMRGBA(red: 255, green: 223, blue: 203, alpha: 1),
        dark: FMRGBA(red: 255, green: 223, blue: 203, alpha: 1)
    )

    /// `--brand-200`
    public static let brand200 = FMColorToken(
        light: FMRGBA(red: 255, green: 194, blue: 162, alpha: 1),
        dark: FMRGBA(red: 255, green: 194, blue: 162, alpha: 1)
    )

    /// `--brand-300`
    public static let brand300 = FMColorToken(
        light: FMRGBA(red: 255, green: 156, blue: 115, alpha: 1),
        dark: FMRGBA(red: 255, green: 156, blue: 115, alpha: 1)
    )

    /// `--brand-400`
    public static let brand400 = FMColorToken(
        light: FMRGBA(red: 251, green: 121, blue: 74, alpha: 1),
        dark: FMRGBA(red: 251, green: 121, blue: 74, alpha: 1)
    )

    /// `--brand-500`
    public static let brand500 = FMColorToken(
        light: FMRGBA(red: 228, green: 81, blue: 44, alpha: 1),
        dark: FMRGBA(red: 228, green: 81, blue: 44, alpha: 1)
    )

    /// `--brand-600`
    public static let brand600 = FMColorToken(
        light: FMRGBA(red: 204, green: 42, blue: 27, alpha: 1),
        dark: FMRGBA(red: 204, green: 42, blue: 27, alpha: 1)
    )

    /// `--brand-700`
    public static let brand700 = FMColorToken(
        light: FMRGBA(red: 169, green: 20, blue: 28, alpha: 1),
        dark: FMRGBA(red: 169, green: 20, blue: 28, alpha: 1)
    )

    /// `--brand-coral`
    public static let brandCoral = FMColorToken(
        light: FMRGBA(red: 241, green: 66, blue: 84, alpha: 1),
        dark: FMRGBA(red: 241, green: 66, blue: 84, alpha: 1)
    )

    // MARK: 表面与文字

    /// 暖中性承担约 90% 的面积。暗色不用阴影表达层级，靠表面明度阶梯（0.158 / 0.207 / 0.232）。
    /// `--background`
    public static let background = FMColorToken(
        light: FMRGBA(red: 250, green: 247, blue: 242, alpha: 1),
        dark: FMRGBA(red: 15, green: 12, blue: 10, alpha: 1)
    )

    /// `--foreground`
    public static let foreground = FMColorToken(
        light: FMRGBA(red: 34, green: 29, blue: 24, alpha: 1),
        dark: FMRGBA(red: 241, green: 238, blue: 233, alpha: 1)
    )

    /// `--card`
    public static let card = FMColorToken(
        light: FMRGBA(red: 255, green: 254, blue: 251, alpha: 1),
        dark: FMRGBA(red: 26, green: 23, blue: 20, alpha: 1)
    )

    /// `--card-foreground`
    public static let cardForeground = FMColorToken(
        light: FMRGBA(red: 33, green: 31, blue: 28, alpha: 1),
        dark: FMRGBA(red: 241, green: 240, blue: 238, alpha: 1)
    )

    /// `--popover`
    public static let popover = FMColorToken(
        light: FMRGBA(red: 255, green: 254, blue: 252, alpha: 1),
        dark: FMRGBA(red: 32, green: 29, blue: 26, alpha: 1)
    )

    /// `--popover-foreground`
    public static let popoverForeground = FMColorToken(
        light: FMRGBA(red: 33, green: 31, blue: 28, alpha: 1),
        dark: FMRGBA(red: 241, green: 240, blue: 238, alpha: 1)
    )

    /// `--secondary`
    public static let secondary = FMColorToken(
        light: FMRGBA(red: 242, green: 239, blue: 234, alpha: 1),
        dark: FMRGBA(red: 38, green: 37, blue: 35, alpha: 1)
    )

    /// `--secondary-foreground`
    public static let secondaryForeground = FMColorToken(
        light: FMRGBA(red: 43, green: 40, blue: 38, alpha: 1),
        dark: FMRGBA(red: 241, green: 240, blue: 238, alpha: 1)
    )

    /// `--accent`
    public static let accent = FMColorToken(
        light: FMRGBA(red: 241, green: 237, blue: 232, alpha: 1),
        dark: FMRGBA(red: 44, green: 42, blue: 39, alpha: 1)
    )

    /// `--accent-foreground`
    public static let accentForeground = FMColorToken(
        light: FMRGBA(red: 34, green: 29, blue: 24, alpha: 1),
        dark: FMRGBA(red: 241, green: 238, blue: 233, alpha: 1)
    )

    /// `--muted`
    public static let muted = FMColorToken(
        light: FMRGBA(red: 240, green: 237, blue: 233, alpha: 1),
        dark: FMRGBA(red: 37, green: 36, blue: 34, alpha: 1)
    )

    /// `--muted-foreground`
    public static let mutedForeground = FMColorToken(
        light: FMRGBA(red: 102, green: 99, blue: 94, alpha: 1),
        dark: FMRGBA(red: 155, green: 152, blue: 147, alpha: 1)
    )

    // MARK: 交互与状态

    /// primary 在暗色指向 brand-400（更亮），保证暗底上仍有足够对比。
    /// `--primary`
    public static let primary = FMColorToken(
        light: FMRGBA(red: 228, green: 81, blue: 44, alpha: 1),
        dark: FMRGBA(red: 251, green: 121, blue: 74, alpha: 1)
    )

    /// `--primary-foreground`
    public static let primaryForeground = FMColorToken(
        light: FMRGBA(red: 253, green: 251, blue: 250, alpha: 1),
        dark: FMRGBA(red: 34, green: 17, blue: 14, alpha: 1)
    )

    /// `--destructive`
    public static let destructive = FMColorToken(
        light: FMRGBA(red: 231, green: 0, blue: 11, alpha: 1),
        dark: FMRGBA(red: 255, green: 100, blue: 103, alpha: 1)
    )

    /// `--success`
    public static let success = FMColorToken(
        light: FMRGBA(red: 52, green: 157, blue: 98, alpha: 1),
        dark: FMRGBA(red: 81, green: 182, blue: 122, alpha: 1)
    )

    /// `--success-foreground`
    public static let successForeground = FMColorToken(
        light: FMRGBA(red: 244, green: 250, blue: 245, alpha: 1),
        dark: FMRGBA(red: 3, green: 17, blue: 8, alpha: 1)
    )

    /// `--warning`
    public static let warning = FMColorToken(
        light: FMRGBA(red: 205, green: 145, blue: 48, alpha: 1),
        dark: FMRGBA(red: 221, green: 165, blue: 82, alpha: 1)
    )

    /// `--warning-foreground`
    public static let warningForeground = FMColorToken(
        light: FMRGBA(red: 59, green: 42, blue: 23, alpha: 1),
        dark: FMRGBA(red: 33, green: 18, blue: 1, alpha: 1)
    )

    /// `--info`
    public static let info = FMColorToken(
        light: FMRGBA(red: 59, green: 130, blue: 175, alpha: 1),
        dark: FMRGBA(red: 96, green: 167, blue: 214, alpha: 1)
    )

    /// `--info-foreground`
    public static let infoForeground = FMColorToken(
        light: FMRGBA(red: 246, green: 249, blue: 251, alpha: 1),
        dark: FMRGBA(red: 2, green: 15, blue: 25, alpha: 1)
    )

    /// `--success-emphasis`
    public static let successEmphasis = FMColorToken(
        light: FMRGBA(red: 3, green: 102, blue: 57, alpha: 1),
        dark: FMRGBA(red: 136, green: 217, blue: 165, alpha: 1)
    )

    /// `--warning-emphasis`
    public static let warningEmphasis = FMColorToken(
        light: FMRGBA(red: 128, green: 77, blue: 12, alpha: 1),
        dark: FMRGBA(red: 240, green: 199, blue: 129, alpha: 1)
    )

    /// `--info-emphasis`
    public static let infoEmphasis = FMColorToken(
        light: FMRGBA(red: 24, green: 90, blue: 137, alpha: 1),
        dark: FMRGBA(red: 141, green: 204, blue: 249, alpha: 1)
    )

    // MARK: 描边

    /// 分隔一律发丝线，不要粗边框。
    /// `--border`
    public static let border = FMColorToken(
        light: FMRGBA(red: 231, green: 227, blue: 222, alpha: 1),
        dark: FMRGBA(red: 255, green: 255, blue: 255, alpha: 0.09)
    )

    /// `--input`
    public static let input = FMColorToken(
        light: FMRGBA(red: 220, green: 216, blue: 211, alpha: 1),
        dark: FMRGBA(red: 255, green: 255, blue: 255, alpha: 0.13)
    )

    /// `--ring`
    public static let ring = FMColorToken(
        light: FMRGBA(red: 251, green: 121, blue: 74, alpha: 1),
        dark: FMRGBA(red: 251, green: 121, blue: 74, alpha: 1)
    )

    // MARK: 玻璃材质

    /// 中性玻璃：accent 预设永不染色玻璃。带 alpha，叠在 NSVisualEffectView / .ultraThinMaterial 之上。
    /// `--glass-tint`
    public static let glassTint = FMColorToken(
        light: FMRGBA(red: 255, green: 255, blue: 255, alpha: 0.78),
        dark: FMRGBA(red: 31, green: 25, blue: 21, alpha: 0.7)
    )

    /// `--glass-rim`
    public static let glassRim = FMColorToken(
        light: FMRGBA(red: 255, green: 255, blue: 255, alpha: 0.9),
        dark: FMRGBA(red: 255, green: 255, blue: 255, alpha: 0.24)
    )

    /// `--glass-edge`
    public static let glassEdge = FMColorToken(
        light: FMRGBA(red: 255, green: 255, blue: 255, alpha: 0.28),
        dark: FMRGBA(red: 255, green: 255, blue: 255, alpha: 0.08)
    )

    /// `--glass-shadow`
    public static let glassShadow = FMColorToken(
        light: FMRGBA(red: 29, green: 20, blue: 13, alpha: 0.16),
        dark: FMRGBA(red: 0, green: 0, blue: 0, alpha: 0)
    )
}

extension ShapeStyle where Self == Color {
    /// FMColor.brand50
    public static var fmBrand50: Color { FMColor.brand50.color }

    /// FMColor.brand100
    public static var fmBrand100: Color { FMColor.brand100.color }

    /// FMColor.brand200
    public static var fmBrand200: Color { FMColor.brand200.color }

    /// FMColor.brand300
    public static var fmBrand300: Color { FMColor.brand300.color }

    /// FMColor.brand400
    public static var fmBrand400: Color { FMColor.brand400.color }

    /// FMColor.brand500
    public static var fmBrand500: Color { FMColor.brand500.color }

    /// FMColor.brand600
    public static var fmBrand600: Color { FMColor.brand600.color }

    /// FMColor.brand700
    public static var fmBrand700: Color { FMColor.brand700.color }

    /// FMColor.brandCoral
    public static var fmBrandCoral: Color { FMColor.brandCoral.color }

    /// FMColor.background
    public static var fmBackground: Color { FMColor.background.color }

    /// FMColor.foreground
    public static var fmForeground: Color { FMColor.foreground.color }

    /// FMColor.card
    public static var fmCard: Color { FMColor.card.color }

    /// FMColor.cardForeground
    public static var fmCardForeground: Color { FMColor.cardForeground.color }

    /// FMColor.popover
    public static var fmPopover: Color { FMColor.popover.color }

    /// FMColor.popoverForeground
    public static var fmPopoverForeground: Color { FMColor.popoverForeground.color }

    /// FMColor.secondary
    public static var fmSecondary: Color { FMColor.secondary.color }

    /// FMColor.secondaryForeground
    public static var fmSecondaryForeground: Color { FMColor.secondaryForeground.color }

    /// FMColor.accent
    public static var fmAccent: Color { FMColor.accent.color }

    /// FMColor.accentForeground
    public static var fmAccentForeground: Color { FMColor.accentForeground.color }

    /// FMColor.muted
    public static var fmMuted: Color { FMColor.muted.color }

    /// FMColor.mutedForeground
    public static var fmMutedForeground: Color { FMColor.mutedForeground.color }

    /// FMColor.primary
    public static var fmPrimary: Color { FMColor.primary.color }

    /// FMColor.primaryForeground
    public static var fmPrimaryForeground: Color { FMColor.primaryForeground.color }

    /// FMColor.destructive
    public static var fmDestructive: Color { FMColor.destructive.color }

    /// FMColor.success
    public static var fmSuccess: Color { FMColor.success.color }

    /// FMColor.successForeground
    public static var fmSuccessForeground: Color { FMColor.successForeground.color }

    /// FMColor.warning
    public static var fmWarning: Color { FMColor.warning.color }

    /// FMColor.warningForeground
    public static var fmWarningForeground: Color { FMColor.warningForeground.color }

    /// FMColor.info
    public static var fmInfo: Color { FMColor.info.color }

    /// FMColor.infoForeground
    public static var fmInfoForeground: Color { FMColor.infoForeground.color }

    /// FMColor.successEmphasis
    public static var fmSuccessEmphasis: Color { FMColor.successEmphasis.color }

    /// FMColor.warningEmphasis
    public static var fmWarningEmphasis: Color { FMColor.warningEmphasis.color }

    /// FMColor.infoEmphasis
    public static var fmInfoEmphasis: Color { FMColor.infoEmphasis.color }

    /// FMColor.border
    public static var fmBorder: Color { FMColor.border.color }

    /// FMColor.input
    public static var fmInput: Color { FMColor.input.color }

    /// FMColor.ring
    public static var fmRing: Color { FMColor.ring.color }

    /// FMColor.glassTint
    public static var fmGlassTint: Color { FMColor.glassTint.color }

    /// FMColor.glassRim
    public static var fmGlassRim: Color { FMColor.glassRim.color }

    /// FMColor.glassEdge
    public static var fmGlassEdge: Color { FMColor.glassEdge.color }

    /// FMColor.glassShadow
    public static var fmGlassShadow: Color { FMColor.glassShadow.color }
}

/// 圆角阶梯（基准 `--radius` = 10pt）。
/// 控件 10 / 卡片 14 / 弹窗 18 是常用三档，其余按倍数推导。
public enum FMRadius {
    /// `--radius-sm` = 10pt × 0.6 = 6.00pt
    public static let sm: CGFloat = 6

    /// `--radius-md` = 10pt × 0.8 = 8.00pt
    public static let md: CGFloat = 8

    /// `--radius-lg` = 10pt × 1 = 10.00pt
    public static let lg: CGFloat = 10

    /// `--radius-xl` = 10pt × 1.4 = 14.00pt
    public static let xl: CGFloat = 14

    /// `--radius-2xl` = 10pt × 1.8 = 18.00pt
    public static let xx: CGFloat = 18

    /// `--radius-3xl` = 10pt × 2.2 = 22.00pt
    public static let xxx: CGFloat = 22

    /// `--radius-4xl` = 10pt × 2.6 = 26.00pt
    public static let xxxx: CGFloat = 26
}

/// 两层阴影：贴边的 contact + 弥散的 ambient。亮色暖调，暗色归零。
public enum FMShadow {
    /// `--shadow-xs`，暗色下三层全部归零（层级改由表面明度表达）
    public static let xs = FMShadowToken(
        light: [
            FMShadowLayer(x: 0, y: 1, blur: 2, spread: 0, rgba: FMRGBA(red: 54, green: 44, blue: 36, alpha: 0.045))
        ],
        dark: [
            FMShadowLayer(x: 0, y: 0, blur: 0, spread: 0, rgba: FMRGBA(red: 0, green: 0, blue: 0, alpha: 0))
        ]
    )

    /// `--shadow-sm`，暗色下三层全部归零（层级改由表面明度表达）
    public static let sm = FMShadowToken(
        light: [
            FMShadowLayer(x: 0, y: 1, blur: 2, spread: 0, rgba: FMRGBA(red: 54, green: 44, blue: 36, alpha: 0.05)),
            FMShadowLayer(x: 0, y: 2, blur: 6, spread: -2, rgba: FMRGBA(red: 54, green: 44, blue: 36, alpha: 0.06))
        ],
        dark: [
            FMShadowLayer(x: 0, y: 0, blur: 0, spread: 0, rgba: FMRGBA(red: 0, green: 0, blue: 0, alpha: 0))
        ]
    )

    /// `--shadow-md`，暗色下三层全部归零（层级改由表面明度表达）
    public static let md = FMShadowToken(
        light: [
            FMShadowLayer(x: 0, y: 1, blur: 2, spread: 0, rgba: FMRGBA(red: 54, green: 44, blue: 36, alpha: 0.05)),
            FMShadowLayer(x: 0, y: 6, blur: 16, spread: -6, rgba: FMRGBA(red: 54, green: 44, blue: 36, alpha: 0.1))
        ],
        dark: [
            FMShadowLayer(x: 0, y: 0, blur: 0, spread: 0, rgba: FMRGBA(red: 0, green: 0, blue: 0, alpha: 0))
        ]
    )

    /// `--shadow-lg`，暗色下三层全部归零（层级改由表面明度表达）
    public static let lg = FMShadowToken(
        light: [
            FMShadowLayer(x: 0, y: 1, blur: 3, spread: 0, rgba: FMRGBA(red: 54, green: 44, blue: 36, alpha: 0.06)),
            FMShadowLayer(x: 0, y: 16, blur: 40, spread: -12, rgba: FMRGBA(red: 54, green: 44, blue: 36, alpha: 0.18))
        ],
        dark: [
            FMShadowLayer(x: 0, y: 0, blur: 0, spread: 0, rgba: FMRGBA(red: 0, green: 0, blue: 0, alpha: 0))
        ]
    )
}

/// 动效：时长三档 + 曲线三条。
public enum FMMotion {
    /// 交互反馈（hover、按压、开关）：`--duration-fast`
    public static let feedback = FMDuration(milliseconds: 120)

    /// 浮层（菜单、popover、tooltip）：`--duration-overlay`
    public static let overlay = FMDuration(milliseconds: 160)

    /// 表面（弹窗、抽屉、页面入场）：`--duration-surface`
    public static let surface = FMDuration(milliseconds: 220)

    /// 长尾减速，入场：`--ease-out-expo`
    public static let expo = FMCurve(x1: 0.16, y1: 1, x2: 0.3, y2: 1)

    /// KOSX 签名曲线，默认用它：`--ease-signal`
    public static let signal = FMCurve(x1: 0.22, y1: 1, x2: 0.36, y2: 1)

    /// 微小弹跳，只给 <140ms 的小元素：`--ease-spring`
    public static let spring = FMCurve(x1: 0.34, y1: 1.56, x2: 0.64, y2: 1)
}

/// 玻璃材质参数（docs/liquid-glass-design.md）。原生端对应 .ultraThinMaterial + 这层 tint。
public enum FMGlass {
    /// `--glass-blur`：backdrop 模糊半径
    public static let blur: CGFloat = 18
    /// `--glass-saturate`：backdrop 饱和度
    public static let saturate: Double = 1.5
}

#if os(macOS)
extension NSColor {
    /// FMRGBA.platform → SwiftUI Color。
    fileprivate var swiftUIColor: Color { Color(nsColor: self) }
}
#else
extension UIColor {
    /// FMRGBA.platform → SwiftUI Color。
    fileprivate var swiftUIColor: Color { Color(self) }
}
#endif
