import AppKit
import SwiftUI

/// 快照测试的骨架。
///
/// 为什么不存 PNG 基线：二进制文件进仓库会越来越大、review 时看不见、冲突了没法合。
/// 这里把渲染结果降采样成 24×24 的灰度指纹（576 字节），再用 base64 存进源码——
/// 足够抓住「布局塌了 / 颜色错了 / 少了一块」这类回归，又不至于被抗锯齿噪声左右。
///
/// 只比平均绝对差，不比逐字节相等：同一台机器上字体渲染是稳定的，
/// 但换了 macOS 版本会有细微波纹，硬相等会变成每天都要重新录基线。
enum SnapshotHarness {
    /// 降采样后的边长。24 意味着一个格子约等于 30pt 宽的区域。
    static let side = 24
    /// 允许的平均通道差（0–255）。3 大约是 1.2%，肉眼不可见，但布局错位、颜色改动一定超。
    static let tolerance = 3.0

    /// 把视图渲染成图片。尺寸必须显式给：`NSHostingView` 会按内容的
    /// ideal/min 尺寸排版，只设 frame 不够。
    @MainActor
    static func render(_ view: some View, size: CGSize, appearance: NSAppearance.Name = .aqua) -> NSImage? {
        let sized = view.frame(width: size.width, height: size.height)
        let hosting = NSHostingView(rootView: AnyView(sized))
        hosting.frame = CGRect(origin: .zero, size: size)
        hosting.appearance = NSAppearance(named: appearance)
        hosting.layoutSubtreeIfNeeded()

        guard let rep = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else { return nil }
        hosting.cacheDisplay(in: hosting.bounds, to: rep)
        let image = NSImage(size: size)
        image.addRepresentation(rep)
        return image
    }

    /// 降采样成 **RGB** 指纹（不是灰度）。
    ///
    /// 一开始用的是灰度，结果「品牌色改成灰色」这种回归完全抓不到——
    /// 亮度一样，指纹一样。多存两个通道只多 700 字节，换来颜色敏感性，值。
    static func fingerprint(_ image: NSImage) -> [UInt8] {
        guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            return []
        }
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let context = CGContext(
            data: &pixels,
            width: side,
            height: side,
            bitsPerComponent: 8,
            bytesPerRow: side * 4,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return [] }
        // 用插值（而不是最近邻）降采样：一两个像素的差异会被平均掉，
        // 真正的结构变化才会留下。
        context.interpolationQuality = .high
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: side, height: side))
        // 丢掉 alpha 通道：背景永远是背景色，留着只会稀释差异。
        var rgb = [UInt8]()
        rgb.reserveCapacity(side * side * 3)
        for index in stride(from: 0, to: pixels.count, by: 4) {
            rgb.append(pixels[index])
            rgb.append(pixels[index + 1])
            rgb.append(pixels[index + 2])
        }
        return rgb
    }

    static func encode(_ fingerprint: [UInt8]) -> String {
        Data(fingerprint).base64EncodedString()
    }

    static func decode(_ base64: String) -> [UInt8] {
        Array(Data(base64Encoded: base64) ?? Data())
    }

    /// 平均绝对差（0–255）。
    static func difference(_ lhs: [UInt8], _ rhs: [UInt8]) -> Double {
        guard lhs.count == rhs.count, !lhs.isEmpty else { return .infinity }
        var total = 0
        for index in lhs.indices {
            total += abs(Int(lhs[index]) - Int(rhs[index]))
        }
        return Double(total) / Double(lhs.count)
    }

    /// 记录模式：写基线时不用手抄 base64，`FLAREMO_RECORD_SNAPSHOTS=1 make test`
    /// 会把每个快照的 base64 打出来，复制到 `SnapshotBaselines` 里即可。
    static var isRecording: Bool {
        ProcessInfo.processInfo.environment["FLAREMO_RECORD_SNAPSHOTS"] == "1"
    }
}
