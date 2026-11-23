#if os(macOS)
import FlareMoCore
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
///
/// 数据全部来自 `FMAppModel`（本地库的响应式视图），这个视图自己不发请求、
/// 也不缓存数据；所有改变都写成对本地库的写，UI 由 ValueObservation 推回来。
public struct FMWorkspaceRoot: View {
    @State private var selection: FMSidebarSection = .records
    @State private var composerText = ""
    @State private var sidebarVisible = true
    @State private var composerFocusSignal = 0
    @FocusState private var searchFocused: Bool

    private let model: FMAppModel

    public init(model: FMAppModel) {
        self.model = model
    }

    public var body: some View {
        GeometryReader { proxy in
            let sidebarSpace = sidebarVisible
                ? FMWorkspaceMetrics.frameGutter
                    + FMWorkspaceMetrics.sidebarWidth
                    + FMWorkspaceMetrics.resizerWidth
                : 0
            let available = proxy.size.width - sidebarSpace
            let contentWidth = min(FMWorkspaceMetrics.contentMaxWidth, max(320, available))
            let groupWidth = sidebarSpace + contentWidth
            let leading = max(0, (proxy.size.width - groupWidth) / 2)

            HStack(spacing: 0) {
                if sidebarVisible {
                    Color.clear.frame(width: FMWorkspaceMetrics.frameGutter)
                    FMSidebar(
                        selection: $selection,
                        stats: model.stats,
                        tags: model.tags
                    )
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
        // 菜单命令在这里落地：菜单只负责写 pendingCommand，视图负责真的执行。
        .onChange(of: model.pendingCommand) { _, command in
            guard let command else { return }
            switch command {
            case .focusComposer:
                model.closeDetail()
                model.searchQuery = ""
                composerFocusSignal += 1
            case .focusSearch:
                model.closeDetail()
                searchFocused = true
            case .syncNow:
                _Concurrency.Task { await model.sync.syncNow() }
            }
            model.consumeCommand(command)
        }
        // 启动即恢复上次的连接（Keychain 里有凭据就进入可同步状态）。
        .task { await model.sync.restoreSession() }
    }

    // MARK: 内容列

    private func contentColumn(width: CGFloat) -> some View {
        VStack(spacing: 0) {
            pageHeader

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if !model.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        searchResults
                    } else if let openMemo = model.openMemo {
                        FMMemoDetailView(
                            memo: openMemo,
                            comments: model.openMemoComments,
                            onClose: { model.closeDetail() },
                            onTogglePin: { model.setPinned(openMemo.id, pinned: !openMemo.isPinned) },
                            onDelete: {
                                model.deleteMemo(openMemo.id)
                                model.closeDetail()
                            },
                            onAddComment: { model.addComment($0) },
                            onTagClick: { tag in
                                model.closeDetail()
                                model.searchQuery = "#" + tag
                            }
                        )
                    } else {
                        FMComposer(text: $composerText, focusSignal: composerFocusSignal) {
                            send()
                        }

                        if let failure = model.openFailure {
                            FMStoreFailureNotice(message: failure) {
                                model.refresh()
                            }
                        } else if model.memos.isEmpty {
                            FMMemoTimelineEmptyState()
                        } else {
                            FMMemoTimeline(
                                memos: model.memos,
                                onTogglePin: { memo in
                                    model.setPinned(memo.id, pinned: !memo.isPinned)
                                },
                                onDelete: { memo in
                                    model.deleteMemo(memo.id)
                                },
                                onOpen: { memo in
                                    model.openDetail(memoID: memo.id)
                                }
                            )
                        }
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
        guard model.createMemo(content: composerText) else { return }
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

            if model.pendingOutboxCount > 0 {
                Text("\(model.pendingOutboxCount) 条待同步")
                    .font(.system(size: 11).monospacedDigit())
                    .foregroundStyle(FMColor.mutedForeground.color)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background {
                        Capsule().fill(FMColor.muted.color.opacity(0.7))
                    }
                    .accessibilityLabel("\(model.pendingOutboxCount) 条待同步")
            }

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
            TextField("搜索", text: searchBinding)
                .textFieldStyle(.plain)
                .focused($searchFocused)
                .accessibilityLabel("搜索记录")
                .font(.system(size: 12.5))
                .foregroundStyle(FMColor.foreground.color)
            if !model.searchQuery.isEmpty {
                Button {
                    model.searchQuery = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(FMColor.mutedForeground.color)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("清空搜索")
            }
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

extension FMWorkspaceRoot {
    /// `model` 是引用类型（@Observable），要手动做 Binding 才能双向绑到输入框。
    fileprivate var searchBinding: Binding<String> {
        Binding(get: { model.searchQuery }, set: { model.searchQuery = $0 })
    }

    /// 搜索结果。本地 FTS 命中即出，不需要网络；<3 字符由 MemoStore 自动降级 LIKE。
    fileprivate var searchResults: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(model.searchResults.isEmpty ? "没有匹配的记录" : "\(model.searchResults.count) 条结果")
                .font(.system(size: 12))
                .foregroundStyle(FMColor.mutedForeground.color)
            ForEach(model.searchResults) { memo in
                FMMemoCard(
                    memo: memo,
                    onTogglePin: { model.setPinned(memo.id, pinned: !memo.isPinned) },
                    onDelete: { model.deleteMemo(memo.id) },
                    onOpen: { model.openDetail(memoID: memo.id) }
                )
            }
        }
    }
}

/// 本地库打不开时的错误态。
///
/// 为什么不做成空列表：空列表会让人以为数据丢了。这里明说"库有问题"并给重试。
struct FMStoreFailureNotice: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 13))
                Text("本地库打不开")
                    .font(.system(size: 14, weight: .medium))
            }
            .foregroundStyle(FMColor.destructive.color)

            Text(message)
                .font(.system(size: 12))
                .foregroundStyle(FMColor.mutedForeground.color)
                .textSelection(.enabled)

            Button("重试", action: onRetry)
                .buttonStyle(.bordered)
                .controlSize(.small)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: FMRadius.xl, style: .continuous)
                .fill(FMColor.card.color)
        }
    }
}
#endif
