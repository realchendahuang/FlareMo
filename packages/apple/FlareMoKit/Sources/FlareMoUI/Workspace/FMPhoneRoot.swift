import FlareMoDesign
import SwiftUI

/// 移动端根视图。
///
/// 和桌面不是同一套布局，是同一套设计语言：
/// 手机上「打开就写」是唯一重要的路径，所以输入框常驻吸底、时间线在它上面滚动，
/// 侧栏、多窗口、快捷键这些桌面概念不往下搬（搬下去只会变成缩小版网页）。
public struct FMPhoneRoot: View {
    @State private var composerText = ""
    @State private var memos: [MemoPresentation]

    public init(memos: [MemoPresentation] = []) {
        _memos = State(initialValue: memos)
    }

    public var body: some View {
        VStack(spacing: 0) {
            header
            timeline
        }
        // 输入条走 safeAreaInset 而不是塞进 VStack：
        // 这样它会自己躲开 Home Indicator，键盘弹起时也由系统负责抬升。
        .safeAreaInset(edge: .bottom, spacing: 0) {
            composerBar
        }
        .background(FMColor.background.color)
        .fmPaperGrain()
    }

    // MARK: 页头

    private var header: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [FMColor.brand400.color, FMColor.brandCoral.color],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: 20, height: 20)
                .overlay {
                    Image(systemName: "flame.fill")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.white)
                }
                .accessibilityHidden(true)

            Text("FlareMo")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(FMColor.foreground.color)

            Spacer(minLength: 0)

            Image(systemName: "magnifyingglass")
                .font(.system(size: 15))
                .foregroundStyle(FMColor.mutedForeground.color)
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
                .accessibilityLabel("搜索")
        }
        .padding(.horizontal, 16)
        .frame(height: 48)
    }

    // MARK: 时间线

    private var timeline: some View {
        ScrollView {
            if memos.isEmpty {
                FMMemoTimelineEmptyState()
            } else {
                FMMemoTimeline(memos: memos)
                    .padding(.horizontal, 16)
                    .padding(.top, 4)
            }
        }
        .frame(maxHeight: .infinity)
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: 吸底输入

    private var composerBar: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(FMColor.border.color.opacity(0.5))
                .frame(height: 0.5)

            HStack(spacing: 10) {
                TextField("记点什么…", text: $composerText, axis: .vertical)
                    .font(.system(size: 15))
                    .lineLimit(1...4)
                    .textFieldStyle(.plain)
                    .foregroundStyle(FMColor.foreground.color)

                Button(action: send) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(hasContent ? Color.white : FMColor.mutedForeground.color)
                        .frame(width: 30, height: 30)
                        .background {
                            Circle().fill(
                                hasContent
                                    ? AnyShapeStyle(
                                        LinearGradient(
                                            colors: [FMColor.brand400.color, FMColor.brandCoral.color],
                                            startPoint: .top,
                                            endPoint: .bottom
                                        )
                                    )
                                    : AnyShapeStyle(FMColor.muted.color)
                            )
                        }
                }
                .buttonStyle(.plain)
                .disabled(!hasContent)
                .accessibilityLabel("发送")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(FMColor.card.color.opacity(0.92))
    }

    private var hasContent: Bool {
        !composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func send() {
        let trimmed = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        memos.insert(
            MemoPresentation(id: UUID().uuidString, content: trimmed, createdAt: .now),
            at: 0
        )
        composerText = ""
    }
}
