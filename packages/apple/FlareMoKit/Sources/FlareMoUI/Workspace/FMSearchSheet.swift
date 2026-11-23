import FlareMoDesign
import SwiftUI

/// 搜索面板。
///
/// 手机上空间窄，搜索放成整屏面板比塞进页头更合适（页头那点宽度连关键词都打不全）。
/// 桌面上搜索框本来就在页头，用不上这个面板——所以它是给移动端准备的，
/// 但实现本身没有平台分支，macOS 也能直接复用。
public struct FMSearchSheet: View {
    private let model: FMAppModel
    private let onOpen: (MemoPresentation) -> Void

    @FocusState private var fieldFocused: Bool

    public init(model: FMAppModel, onOpen: @escaping (MemoPresentation) -> Void = { _ in }) {
        self.model = model
        self.onOpen = onOpen
    }

    public var body: some View {
        VStack(spacing: 0) {
            searchBar
            Rectangle()
                .fill(FMColor.border.color.opacity(0.5))
                .frame(height: 0.5)

            if trimmedQuery.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 22, weight: .light))
                        .foregroundStyle(FMColor.mutedForeground.color.opacity(0.6))
                    Text("搜索记录、标签或待办")
                        .font(.system(size: 13))
                        .foregroundStyle(FMColor.mutedForeground.color)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.top, 60)
            } else if model.searchResults.isEmpty {
                Text("没有匹配的记录")
                    .font(.system(size: 13))
                    .foregroundStyle(FMColor.mutedForeground.color)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(.top, 60)
            } else {
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(model.searchResults) { memo in
                            FMMemoCard(
                                memo: memo,
                                onTogglePin: {
                                    model.setPinned(memo.id, pinned: !memo.isPinned)
                                },
                                onDelete: {
                                    model.deleteMemo(memo.id)
                                },
                                onOpen: { onOpen(memo) }
                            )
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
            }
        }
        .background(FMColor.background.color)
        .task { fieldFocused = true }
    }

    private var trimmedQuery: String {
        model.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13))
                .foregroundStyle(FMColor.mutedForeground.color)
                .accessibilityHidden(true)

            TextField(
                "搜索",
                text: Binding(
                    get: { model.searchQuery },
                    set: { model.searchQuery = $0 }
                )
            )
            .textFieldStyle(.plain)
            .font(.system(size: 15))
            .focused($fieldFocused)
            .submitLabel(.search)
            .accessibilityLabel("搜索记录")

            if !model.searchQuery.isEmpty {
                Button {
                    model.searchQuery = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(FMColor.mutedForeground.color)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("清空搜索")
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 48)
    }
}
