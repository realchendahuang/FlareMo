import FlareMoDesign
import SwiftUI

/// 一张速记卡片。
///
/// 结构照 Web 端 `apps/web/src/components/memo-card.tsx`：
/// `paper` 纸面（噪点 + 顶边高光）+ `rounded-xl`(14) + `border-border/60`
/// + `bg-card` + `px-4 py-3.5` + `shadow-xs`，置顶用 3pt 内嵌渐变条而不是粗边框。
public struct FMMemoCard: View {
    private let memo: MemoPresentation
    private let index: Int
    private let onTogglePin: (() -> Void)?
    private let onDelete: (() -> Void)?
    private let onOpen: (() -> Void)?

    @State private var isHovering = false
    @Environment(\.colorScheme) private var colorScheme

    public init(
        memo: MemoPresentation,
        index: Int = 0,
        onTogglePin: (() -> Void)? = nil,
        onDelete: (() -> Void)? = nil,
        onOpen: (() -> Void)? = nil
    ) {
        self.memo = memo
        self.index = index
        self.onTogglePin = onTogglePin
        self.onDelete = onDelete
        self.onOpen = onOpen
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: FMWorkspaceMetrics.cardInnerSpacing) {
            header
            contentText
            if memo.hasAttachment {
                attachmentPlaceholder
            }
        }
        .padding(.horizontal, FMWorkspaceMetrics.cardPaddingHorizontal)
        .padding(.vertical, FMWorkspaceMetrics.cardPaddingVertical)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: FMRadius.xl, style: .continuous)
                .fill(FMColor.card.color)
                .fmPaperGrain()
        }
        .overlay {
            RoundedRectangle(cornerRadius: FMRadius.xl, style: .continuous)
                .strokeBorder(
                    isHovering
                        ? FMColor.border.color.opacity(0.9)
                        : FMColor.border.color.opacity(0.6),
                    lineWidth: 1
                )
        }
        .overlay(alignment: .leading) {
            if memo.isPinned {
                pinBar
            }
        }
        .fmShadow(FMShadow.xs)
        .onHover { isHovering = $0 }
        .contentShape(Rectangle())
        .onTapGesture { onOpen?() }
        .animation(
            FMAnimationPolicy.animation(FMMotion.feedback),
            value: isHovering
        )
    }

    // MARK: 置顶条

    private var pinBar: some View {
        Capsule(style: .continuous)
            .fill(
                LinearGradient(
                    colors: [FMColor.brand400.color, FMColor.brandCoral.color],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .frame(width: 3)
            .padding(.vertical, 14)
            .padding(.leading, 0)
            .accessibilityHidden(true)
    }

    // MARK: 头部

    private var header: some View {
        HStack(spacing: 8) {
            Text(MemoTimeLabel.string(for: memo.createdAt))
                .font(.system(size: 12).monospacedDigit())
                .foregroundStyle(FMColor.mutedForeground.color)

            ForEach(memo.tags, id: \.self) { tag in
                Text(tag)
                    .font(.system(size: 12))
                    .foregroundStyle(FMColor.primary.color.opacity(0.85))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background {
                        RoundedRectangle(cornerRadius: FMRadius.sm, style: .continuous)
                            .fill(FMColor.primary.color.opacity(0.08))
                    }
            }

            Spacer(minLength: 0)

            if isHovering {
                actionRow
            } else if memo.commentCount > 0 {
                commentBadge
            }
        }
        .frame(height: 18)
    }

    /// 只显示真的接上了的能力：置顶与删除走本地库，评论功能还没做就不放按钮。
    @ViewBuilder
    private var actionRow: some View {
        HStack(spacing: 2) {
            if let onTogglePin {
                cardAction(
                    "pin",
                    label: memo.isPinned ? "取消置顶" : "置顶",
                    action: onTogglePin
                )
            }
            if let onDelete {
                cardAction("trash", label: "删除", action: onDelete)
            }
        }
    }

    private func cardAction(
        _ systemImage: String,
        label: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 12))
                .foregroundStyle(FMColor.mutedForeground.color)
                .frame(width: 22, height: 18)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private var commentBadge: some View {
        HStack(spacing: 3) {
            Image(systemName: "bubble.left")
                .font(.system(size: 11))
            Text("\(memo.commentCount)")
                .font(.system(size: 11).monospacedDigit())
        }
        .foregroundStyle(FMColor.mutedForeground.color)
        .accessibilityLabel("\(memo.commentCount) 条评论")
    }

    // MARK: 正文

    private var contentText: some View {
        Text(attributedContent)
            .font(.system(size: 15))
            .lineSpacing(28 - 15 * 1.2)
            .foregroundStyle(FMColor.cardForeground.color)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// v1 的行内 Markdown：加粗、斜体、行内代码、删除线、链接。
    /// 块级渲染（标题、列表、引用、代码块）等接 `FlareMoMarkdown` 的块模型后再做，
    /// 现在的按键是「先把一屏看对」。
    private var attributedContent: AttributedString {
        var options = AttributedString.MarkdownParsingOptions()
        options.interpretedSyntax = .inlineOnlyPreservingWhitespace
        return (try? AttributedString(markdown: memo.content, options: options))
            ?? AttributedString(memo.content)
    }

    // MARK: 附件占位

    private var attachmentPlaceholder: some View {
        HStack(spacing: 6) {
            Image(systemName: "photo")
                .font(.system(size: 12))
            Text("附件")
                .font(.system(size: 12))
        }
        .foregroundStyle(FMColor.mutedForeground.color)
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background {
            RoundedRectangle(cornerRadius: FMRadius.md, style: .continuous)
                .fill(FMColor.muted.color.opacity(0.6))
        }
        .accessibilityLabel("含附件")
    }
}
