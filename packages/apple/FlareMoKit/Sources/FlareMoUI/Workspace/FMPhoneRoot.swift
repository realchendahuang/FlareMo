import FlareMoDesign
import SwiftUI

/// 移动端根视图。
///
/// 和桌面不是同一套布局，是同一套设计语言：
/// 手机上「打开就写」是唯一重要的路径，所以输入框常驻吸底、时间线在它上面滚动，
/// 侧栏、多窗口、快捷键这些桌面概念不往下搬（搬下去只会变成缩小版网页）。
public struct FMPhoneRoot: View {
    @State private var composerText = ""
    @State private var settingsPresented = false
    /// 详情页导航路径（存 memo id）。
    @State private var path: [String] = []
    /// 全屏编辑器（写长内容用；吸底输入框只负责一句话）。
    @State private var composePresented = false
    @State private var searchPresented = false

    private let model: FMAppModel

    public init(model: FMAppModel) {
        self.model = model
    }

    public var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                header
                timeline
            }
            .navigationDestination(for: String.self) { memoID in
                memoDetail(for: memoID)
            }
        }
        // 输入条走 safeAreaInset 而不是塞进 VStack：
        // 这样它会自己躲开 Home Indicator，键盘弹起时也由系统负责抬升。
        .safeAreaInset(edge: .bottom, spacing: 0) {
            composerBar
        }
        .background(FMColor.background.color)
        .fmPaperGrain()
        .sheet(isPresented: $settingsPresented) {
            NavigationStack {
                FMSettingsView(sync: model.sync)
                    .navigationTitle("设置")
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("完成") { settingsPresented = false }
                        }
                    }
            }
            .frame(minHeight: 460)
        }
        .task { await model.sync.restoreSession() }
        #if DEBUG
            // 联调/截图用：启动参数 `-FLAREMO_OPEN_COMPOSE` 直接打开展开态编辑器。
            .onAppear {
                if ProcessInfo.processInfo.arguments.contains("-FLAREMO_OPEN_COMPOSE") {
                    composePresented = true
                }
                if ProcessInfo.processInfo.arguments.contains("-FLAREMO_OPEN_SEARCH") {
                    searchPresented = true
                }
            }
        #endif
        .sheet(isPresented: $searchPresented) {
            NavigationStack {
                FMSearchSheet(model: model) { memo in
                    searchPresented = false
                    model.openDetail(memoID: memo.id)
                    path.append(memo.id)
                }
                .navigationTitle("搜索")
                #if os(iOS)
                    .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("完成") { searchPresented = false }
                    }
                }
            }
        }
        #if os(iOS)
            .fullScreenCover(isPresented: $composePresented) {
                FMComposeSheet(text: $composerText) {
                    composePresented = false
                    send()
                }
            }
        #endif
    }

    // MARK: 详情

    @ViewBuilder
    private func memoDetail(for memoID: String) -> some View {
        if let memo = model.openMemo {
            FMMemoDetailView(
                memo: memo,
                comments: model.openMemoComments,
                onClose: {
                    model.closeDetail()
                    if !path.isEmpty { path.removeLast() }
                },
                onTogglePin: { model.setPinned(memo.id, pinned: !memo.isPinned) },
                onDelete: {
                    model.deleteMemo(memo.id)
                    model.closeDetail()
                    if !path.isEmpty { path.removeLast() }
                },
                onAddComment: { model.addComment($0) }
            )
            .padding(.horizontal, 16)
            .background(FMColor.background.color)
            .fmPaperGrain()
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
        } else {
            Color.clear
        }
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

            HStack(spacing: 4) {
                Button {
                    searchPresented = true
                } label: {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 15))
                        .foregroundStyle(FMColor.mutedForeground.color)
                        .frame(width: 30, height: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("搜索")

                Button {
                    settingsPresented = true
                } label: {
                    Image(systemName: "gearshape")
                        .font(.system(size: 15))
                        .foregroundStyle(FMColor.mutedForeground.color)
                        .frame(width: 30, height: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("设置")
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 48)
    }

    // MARK: 时间线

    private var timeline: some View {
        ScrollView {
            if model.memos.isEmpty {
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
                        path.append(memo.id)
                    }
                )
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
                Button {
                    composePresented = true
                } label: {
                    Image(systemName: "square.and.pencil")
                        .font(.system(size: 15))
                        .foregroundStyle(FMColor.mutedForeground.color)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("展开全屏编辑")

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
        guard model.createMemo(content: composerText) else { return }
        composerText = ""
    }
}
