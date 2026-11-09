//
//  FMReadingMetrics.swift
//  FlareMoUI
//
//  职责：阅读态（详情页 / 回顾 / 卡片展开）的排版档位、块间距与取色。
//
//  数字不是新发明的，全部对齐 Web 端 `apps/web/src/index.css` 的 `.memo-markdown`：
//  - 正文 15pt / 行高 28（`text-[15px] leading-7`）；
//  - 块间距 12（`> * + *` 的 `mt-3`），段落之间 4（`p + p` 的 `mt-1`）；
//  - 标题 h1/h2/h3 = `text-xl`/`text-lg`/`text-base`，原生端取 20/17/16 —— 其中
//    17 与 `FMEditorStyler.headingSize` 完全一致，保证「写的时候」和「读的时候」
//    是同一套层级，不会同一条记录在编辑态 17pt、发出后变 18pt；
//  - 列表项之间 4（`li + li` 的 `mt-1`）；
//  - 引用竖线、颜色见 `FMReadingPalette`。
//
//  颜色一律走 `FlareMoDesign` 的 token（`FMColor.*`），不写裸色值；和编辑器
//  `FMEditorStyler` 用同一批 token，同一个文件在编辑态和阅读态不该换色。
//

import FlareMoDesign
import FlareMoMarkdown
import SwiftUI

/// 阅读态的排版档位与间距。
public enum FMReadingMetrics {
    // MARK: 排版

    /// 正文：15 / 28（`FMTypography.body`，即 Web 的笔记正文规格）。
    public static let body = FMTypography.body

    /// 标题 1：20pt semibold（Web `text-xl`）。
    public static let heading1 = FMTextStyle(size: 20, weight: .semibold, lineHeight: 28, trackingEm: -0.02)

    /// 标题 2：17pt semibold。17 不是排版阶梯里的独立档位，而是沿用
    /// `FMEditorStyler.headingSize(level: 2)` 的原生端取值（Web 是 `text-lg` 18）。
    public static let heading2 = FMTextStyle(size: 17, weight: .semibold, lineHeight: 26, trackingEm: -0.015)

    /// 标题 3：16pt semibold（Web `text-base`）。
    public static let heading3 = FMTextStyle(size: 16, weight: .semibold, lineHeight: 24)

    /// 标题 4–6：退化成正文加粗（备忘录里 4–6 级极少见，不值得再开档位）。
    public static let headingFallback = FMTextStyle(size: 15, weight: .semibold, lineHeight: 28)

    /// 代码：字号取 `FMTypography.monospace` 的 13 / 20。
    public static let code = FMTypography.monospace

    /// 代码块字体。`FMTextStyle.font` 只给字号字重、不带等宽设计，
    /// 这里显式要 `design: .monospaced`（字号仍来自 token 的 13）。
    public static let codeFont = Font.system(size: FMTypography.monospace.size, design: .monospaced)

    /// 标题层级 → 排版样式；4 级以下退化为正文加粗。
    public static func heading(level: Int) -> FMTextStyle {
        switch level {
        case 1: return heading1
        case 2: return heading2
        case 3: return heading3
        default: return headingFallback
        }
    }

    // MARK: 间距

    /// 块与块之间（Web `.memo-markdown > * + *` 的 `mt-3`）。
    public static let blockSpacing: CGFloat = 12

    /// 相邻段落之间（Web `p + p` 的 `mt-1`）——比普通块间距小，读起来才连成一段。
    public static let paragraphSpacing: CGFloat = 4

    /// 列表项之间（Web `li + li` 的 `mt-1`）。
    public static let listItemSpacing: CGFloat = 4

    /// 块之前要留的白。第一个块不留白。
    public static func spacing(previous: FMBlock?, current: FMBlock) -> CGFloat {
        guard let previous else { return 0 }
        if isParagraph(previous), isParagraph(current) { return paragraphSpacing }
        return blockSpacing
    }

    private static func isParagraph(_ block: FMBlock) -> Bool {
        if case .paragraph = block { return true }
        return false
    }

    // MARK: 结构件

    /// 引用：左侧竖线宽 3（Lead 指定；Web 是 `border-s-2` + `ps-4`）。
    public static let quoteBarWidth: CGFloat = 3
    /// 引用的竖线与文字间距（Web `ps-4` = 16）。
    public static let quoteBarSpacing: CGFloat = 16

    /// 代码块圆角（`FMRadius.md` = 8，Lead 指定）。
    public static let codeBlockRadius = FMRadius.md
    /// 代码块内边距（Lead 指定 10；Web 的 `p-4` 是 16，原生端稍收一点更贴纸面）。
    public static let codeBlockPadding: CGFloat = 10

    /// 分隔线线宽。用 1pt 而不是 1/scale：抓屏/快照在不同 Retina 倍率下都是同一像素数。
    public static let dividerWidth: CGFloat = 1
    /// 分隔线上下额外留白（在此之外还有块间距）。
    public static let dividerInset: CGFloat = 4

    /// 无序列表的项目符号列宽。正文 15pt 下 `•` 约 6pt，留 9 让首字起点稳定。
    public static let bulletWidth: CGFloat = 9
    /// 列表标记与正文的间距（Web `ps-6` 里序号右缘到正文的间隙）。
    public static let listMarkerSpacing: CGFloat = 8

    /// 有序列表序号列宽：按最大序号位数算，保证所有行正文起点相同、序号右对齐。
    public static func orderedMarkerWidth(count: Int) -> CGFloat {
        let digits = CGFloat(String(max(count, 1)).count)
        // 宽度要容得下「数字 + 句点」：只按数字位算的话 "1." 会折成两行，
        // 视觉上变成数字在上、句点掉到下一行（这个坑真踩到过）。
        return max(bulletWidth, digits * 9 + 9)
    }

    /// 待办复选框边长（Web `size-[15px]`）。
    public static let todoBoxSize: CGFloat = 15
    /// 待办复选框圆角（Web `rounded-[4px]`）。
    public static let todoBoxRadius: CGFloat = 4
    /// 待办复选框描边（Web `border-[1.5px]`）。
    public static let todoBoxBorder: CGFloat = 1.5
    /// 复选框相对正文首行顶部的偏移：正文行高 28，盒子 15，居中即 (28-15)/2。
    public static let todoBoxTopInset: CGFloat = (body.lineHeight - todoBoxSize) / 2
}

/// 阅读态取色。
///
/// 独立成 struct 而不是在 View 里散着写 `FMColor.x.color`：
/// 1. 单一出处，改一处全变；
/// 2. 单测可以注入固定色（`.red` 之类）断言属性字符串的颜色，不必比较动态 token。
///
/// 取值与编辑器 `FMEditorStyler` 对齐（链接/标签/行内代码都是 `brand500`，
/// 删除线是 `mutedForeground`），这样同一条记录在编辑态和阅读态颜色一致。
/// Web 端标签是灰底 chip、链接用 `brand-600/300` 并按亮暗切换；原生端 AttributedString
/// 画不出圆角 chip 且编辑器已统一用 `brand500`，所以这里选择「与编辑器一致」，
/// 差异记录在 `FMBlockView` 的文件头注释里。
struct FMReadingPalette: Equatable {
    let body: Color
    let secondary: Color
    let inlineCode: Color
    let link: Color
    let tag: Color
    let strikethrough: Color
    let quoteBar: Color
    let codeBackground: Color
    let codeBorder: Color
    let divider: Color
    let listMarker: Color
    let todoBorder: Color
    let todoCheckedFill: Color
    let todoCheckmark: Color
    let todoUncheckedFill: Color

    /// 跟随系统外观的 token 取色（`FMColorToken.color` 自带亮暗解析）。
    static var standard: FMReadingPalette {
        FMReadingPalette(
            body: FMColor.foreground.color,
            secondary: FMColor.mutedForeground.color,
            inlineCode: FMColor.brand500.color,
            link: FMColor.brand500.color,
            tag: FMColor.brand500.color,
            strikethrough: FMColor.mutedForeground.color,
            quoteBar: FMColor.primary.color.opacity(0.45),
            codeBackground: FMColor.card.color,
            codeBorder: FMColor.border.color.opacity(0.6),
            divider: FMColor.border.color.opacity(0.6),
            listMarker: FMColor.mutedForeground.color.opacity(0.7),
            todoBorder: FMColor.mutedForeground.color.opacity(0.45),
            todoCheckedFill: FMColor.primary.color,
            todoCheckmark: FMColor.primaryForeground.color,
            todoUncheckedFill: FMColor.card.color
        )
    }
}
