import CoreGraphics
import SwiftUI

/// 纸纹（Paper grain）。
///
/// Web 端用一段约 400 字节的内联 SVG `feTurbulence` 噪点铺在页面上，亮色约 6%
/// 暖墨、暗色是极淡的亮点。原生端不能执行 SVG 滤镜，所以用 CoreGraphics 生成
/// 一张 96×96 的确定性噪点图（同一次运行内只生成一次，约 36KB 内存），
/// 以极低不透明度叠在纸面上。
///
/// 确定性很重要：如果用 `Int.random`，每次启动纹理都不一样，快照测试也没法比对。
public enum FMPaper {
    /// 噪点图边长（pt）。96 在 Retina 下铺开没有可见重复感，又足够便宜。
    static let tileSide = 96

    /// 亮色模式下纸纹的不透明度（对应 `--paper-grain` 里 0.06 的 alpha 矩阵）。
    public static let lightOpacity: Double = 0.06

    /// 暗色模式下纸纹的不透明度（极淡的亮点，约 0.035）。
    public static let darkOpacity: Double = 0.035

    /// 亮色纸面顶边的高光（`--paper-edge`: inset 0 1px 0 oklch(1 0 0 / 0.7)）。
    public static let lightEdgeHighlight: Double = 0.7

    /// 暗色纸面顶边高光（0.05）。
    public static let darkEdgeHighlight: Double = 0.05
}

/// 确定性噪点纹理：同一进程内只生成一次。
///
/// 用 xorshift32 而不是 `SystemRandomNumberGenerator`，保证跨进程、跨机器一致，
/// 快照测试才有意义。
@MainActor
public enum FMNoiseTexture {
    private static var cachedImage: CGImage?

    public static var image: CGImage {
        if let cachedImage { return cachedImage }
        let side = FMPaper.tileSide
        var pixels = [UInt8](repeating: 0, count: side * side)
        var state: UInt32 = 0x9E37_79B9
        for index in 0..<pixels.count {
            // xorshift32
            state ^= state << 13
            state ^= state >> 17
            state ^= state << 5
            // 收敛到中灰附近：纸纹是「几乎看不见的颗粒」，不是黑白噪点
            pixels[index] = UInt8(110 + Int(state % 40))
        }

        let colorSpace = CGColorSpaceCreateDeviceGray()
        let context = CGContext(
            data: &pixels,
            width: side,
            height: side,
            bitsPerComponent: 8,
            bytesPerRow: side,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        )
        if let made = context?.makeImage() {
            cachedImage = made
            return made
        }

        // 理论上不会走到这里（96×96 灰度上下文创建失败）。兜底给一张 1×1 灰图，
        // 界面退化成没有纹理但不会崩。
        var fallbackPixel: UInt8 = 128
        let fallback = CGContext(
            data: &fallbackPixel,
            width: 1,
            height: 1,
            bitsPerComponent: 8,
            bytesPerRow: 1,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        )?.makeImage()
        cachedImage = fallback
        return fallback!
    }
}

public extension View {
    /// 铺一层纸纹。`blendMode` 用 multiply（亮色，压暗成暖墨）或 screen（暗色，提亮成亮点）。
    @ViewBuilder
    func fmPaperGrain(_ intensity: Double = 1) -> some View {
        self.overlay {
            FMGrainOverlay(intensity: intensity)
        }
    }
}

private struct FMGrainOverlay: View {
    let intensity: Double
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let opacity = (colorScheme == .dark ? FMPaper.darkOpacity : FMPaper.lightOpacity) * intensity
        Image(decorative: FMNoiseTexture.image, scale: 1)
            .resizable(resizingMode: .tile)
            .blendMode(colorScheme == .dark ? .screen : .multiply)
            .opacity(opacity)
            .allowsHitTesting(false)
            // 无障碍：纯装饰，VoiceOver 必须跳过
            .accessibilityHidden(true)
    }
}
