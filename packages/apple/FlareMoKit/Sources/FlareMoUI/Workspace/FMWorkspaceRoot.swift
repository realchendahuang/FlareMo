import FlareMoDesign
import SwiftUI

/// 工作区根视图：flomo 式框架。
///
/// 布局（与 Web 端 `workspace-shell.tsx` 同一套数学）：
/// ```
/// [10pt 留白 | 侧栏 312 | 8pt 拖拽条 | 内容列 640 | 留白]
/// ```
/// 整组居中（`offset = max(0, (窗口宽 - 组宽) / 2)`），所以窗口变宽时侧栏不会
/// 飘到最左边、内容列也不会跟着变宽——这是 flomo 那种"纸页居中"的手感来源。
public struct FMWorkspaceRoot: View {
    @State private var selection: FMSidebarSection = .records
    @State private var composerText: String = ""
    @State private var memos: [MemoPresentation]
    @State private var sidebarVisible = true

    private let stats: FMSidebarStats
    private let tags: [String]

    public init(
        memos: [MemoPresentation] = [],
        stats: FMSidebarStats = .placeholder,
        tags: [String] = []
    ) {
        _memos = State(initialValue: memos)
        self.stats = stats
        self.tags = tags
    }

    public var body: some View {
        GeometryReader { proxy in
            // 组宽 = 留白 + 侧栏 + 拖拽条 + 内容列；整组居中。
            // 内容列锁死宽度（不是 maxWidth），否则 ScrollView 会被 HStack 压扁。
            let sidebarSpace = sidebarVisible
                ? FMWorkspaceMetrics.frameGutter
                    + FMWorkspaceMetrics.sidebarWidth
                    + FMWorkspaceMetrics.resizerWidth
                : 0
            let available = proxy.size.width - sidebarSpace
            let contentWidth = min(
                FMWorkspaceMetrics.contentMaxWidth,
                max(320, available)
            )
            let groupWidth = sidebarSpace + contentWidth
            let leading = max(0, (proxy.size.width - groupWidth) / 2)

            HStack(spacing: 0) {
                if sidebarVisible {
                    Color.clear.frame(width: FMWorkspaceMetrics.frameGutter)
                    FMSidebar(selection: $selection, stats: stats, tags: tags)
                    Color.clear.frame(width: FMWorkspaceMetrics.resizerWidth)
                }
                contentColumn(width: contentWidth)
                Spacer(minLength: 0)
            }
            .padding(.leading, leading)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
        .background(FMColor.background.color)
        .fmPaperGrain()
        .animation(FMAnimationPolicy.animation(FMWorkspaceMetrics.sidebarMotion), value: sidebarVisible)
        .frame(minWidth: 780, minHeight: 520)
    }

    // MARK: 内容列

    private func contentColumn(width: CGFloat) -> some View {
        VStack(spacing: 0) {
            pageHeader

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    FMComposer(text: $composerText) {
                        send()
                    }

                    if memos.isEmpty {
                        FMMemoTimelineEmptyState()
                    } else {
                        FMMemoTimeline(memos: memos)
                    }
                }
                .padding(.bottom, 64)
            }
            .frame(maxHeight: .infinity)
        }
        .frame(width: width)
        .frame(maxHeight: .infinity)
    }

    private func send() {
        let trimmed = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let memo = MemoPresentation(
            id: UUID().uuidString,
            content: trimmed,
            createdAt: .now
        )
        memos.insert(memo, at: 0)
        composerText = ""
    }

    // MARK: 页头（h-14 吸顶工具栏）

    private var pageHeader: some View {
        HStack(spacing: 10) {
            Button {
                sidebarVisible.toggle()
            } label: {
                Image(systemName: "sidebar.leading")
                    .font(.system(size: 13))
                    .foregroundStyle(FMColor.mutedForeground.color)
                    .frame(width: 26, height: 26)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(sidebarVisible ? "隐藏侧栏" : "显示侧栏")

            Text(selection.title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(FMColor.foreground.color)

            Spacer(minLength: 8)

            searchField
        }
        .padding(.horizontal, 2)
        .frame(height: 56)
        .frame(maxWidth: .infinity)
    }

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11))
                .foregroundStyle(FMColor.mutedForeground.color)
            Text("搜索")
                .font(.system(size: 12.5))
                .foregroundStyle(FMColor.mutedForeground.color.opacity(0.9))
            Spacer(minLength: 0)
            Text("⌘K")
                .font(.system(size: 10.5).monospacedDigit())
                .foregroundStyle(FMColor.mutedForeground.color.opacity(0.7))
        }
        .padding(.horizontal, 8)
        .frame(width: 168, height: 28)
        .background {
            RoundedRectangle(cornerRadius: FMRadius.md, style: .continuous)
                .fill(FMColor.secondary.color.opacity(0.55))
        }
        .accessibilityLabel("搜索")
    }
}
