import SwiftUI

/// 把 CSS 的两层阴影 token 落到 SwiftUI 上。
///
/// 两处保真度取舍，别当成 bug：
/// 1. **blur 折算**：CSS 的 `blur` 大约是高斯模糊半径的两倍，SwiftUI 的 `radius`
///    更接近可见扩散范围，经验比值为 0.5，所以 `radius = blur / 2`。
/// 2. **spread**：SwiftUI 没有 spread 参数。负 spread（内缩）用「减小 radius」近似，
///    正 spread 用「增大 radius」近似——两者都在改软边的宽度。
///    视觉上足够接近，但不要拿它做像素级对齐。
private func swiftUIRadius(for layer: FMShadowLayer) -> CGFloat {
    max(0, layer.blur / 2 + layer.spread / 2)
}

public extension View {
    /// 应用亮/暗成对的阴影 token。暗色下 token 里是零 alpha，等价于无阴影——
    /// 这是设计决定（暗色层级靠表面明度阶梯 + 发丝线），不是缺失。
    func fmShadow(_ token: FMShadowToken) -> some View {
        modifier(FMShadowViewModifier(token: token))
    }
}

private struct FMShadowViewModifier: ViewModifier {
    let token: FMShadowToken
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        let layers = token.layers(for: colorScheme).filter { $0.rgba.alpha > 0 }
        switch layers.count {
        case 0:
            content
        case 1:
            content.shadow(
                color: layers[0].color,
                radius: swiftUIRadius(for: layers[0]),
                x: layers[0].x,
                y: layers[0].y
            )
        default:
            content
                .shadow(
                    color: layers[0].color,
                    radius: swiftUIRadius(for: layers[0]),
                    x: layers[0].x,
                    y: layers[0].y
                )
                .shadow(
                    color: layers[1].color,
                    radius: swiftUIRadius(for: layers[1]),
                    x: layers[1].x,
                    y: layers[1].y
                )
        }
    }
}
