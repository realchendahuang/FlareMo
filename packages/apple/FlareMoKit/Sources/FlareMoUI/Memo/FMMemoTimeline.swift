import FlareMoDesign
import SwiftUI

/// 速记时间线：自下而上「今天 → 更早」的连续列表。
///
/// v1 用 `LazyVStack`；等本地库接上之后换成 `ScrollView` + 分页游标 + 列表锚点恢复，
/// 结构不用改。
public struct FMMemoTimeline: View {
    private let memos: [MemoPresentation]
    private let onTogglePin: ((MemoPresentation) -> Void)?
    private let onDelete: ((MemoPresentation) -> Void)?
    private let onOpen: ((MemoPresentation) -> Void)?

    public init(
        memos: [MemoPresentation],
        onTogglePin: ((MemoPresentation) -> Void)? = nil,
        onDelete: ((MemoPresentation) -> Void)? = nil,
        onOpen: ((MemoPresentation) -> Void)? = nil
    ) {
        self.memos = memos
        self.onTogglePin = onTogglePin
        self.onDelete = onDelete
        self.onOpen = onOpen
    }

    public var body: some View {
        LazyVStack(alignment: .leading, spacing: FMWorkspaceMetrics.cardSpacing) {
            ForEach(Array(memos.enumerated()), id: \.element.id) { index, memo in
                FMMemoCard(
                    memo: memo,
                    index: index,
                    onTogglePin: onTogglePin.map { action in { action(memo) } },
                    onDelete: onDelete.map { action in { action(memo) } },
                    onOpen: onOpen.map { action in { action(memo) } }
                )
                    .transition(.opacity.combined(with: .offset(y: 6)))
                    .animation(
                        FMAnimationPolicy.animation(FMDuration(milliseconds: 200), curve: FMMotion.expo)
                            .delay(FMWorkspaceMetrics.entranceDelay(index: index)),
                        value: memos.count
                    )
            }
        }
    }
}

/// 空状态：还没有任何速记时显示。
///
/// 提示文案按平台分：桌面端输入框在页面上方、用 ⌘↩ 保存；
/// 手机端输入框吸在底部、用回车发送。同一句话硬套到两端就是错的。
public struct FMMemoTimelineEmptyState: View {
    public init() {}

    public var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "square.and.pencil")
                .font(.system(size: 26, weight: .light))
                .foregroundStyle(FMColor.mutedForeground.color.opacity(0.6))
            Text("还没有记录")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(FMColor.foreground.color.opacity(0.8))
            Text(hint)
                .font(.system(size: 13))
                .foregroundStyle(FMColor.mutedForeground.color)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 64)
        .accessibilityElement(children: .combine)
    }

    private var hint: String {
        #if os(macOS)
            "在上面的输入框里写点什么，⌘↩ 保存"
        #else
            "在下面的输入框里写点什么，回车发送"
        #endif
    }
}
