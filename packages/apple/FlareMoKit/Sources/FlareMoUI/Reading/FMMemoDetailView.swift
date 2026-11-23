import FlareMoDesign
import FlareMoMarkdown
import SwiftUI

/// 速记详情页：正文 + 评论。
///
/// 为什么详情不放在卡片里展开：速记的价值在「重读」，重读需要一段安静的版面
/// （正文完整、评论在下面、没有列表里的噪音）。列表卡片只负责扫读。
public struct FMMemoDetailView: View {
    private let memo: MemoPresentation
    private let comments: [MemoPresentation]
    private let onClose: () -> Void
    private let onTogglePin: () -> Void
    private let onDelete: () -> Void
    private let onAddComment: (String) -> Void
    /// 正文里点 `#标签`。`nil` 时标签是纯文字（不挂点击）。
    /// 路由由 Workspace 决定：通常是「关掉详情 → 用 `#标签` 填搜索框」。
    private let onTagClick: ((String) -> Void)?

    @State private var commentDraft = ""
    @FocusState private var commentFocused: Bool

    public init(
        memo: MemoPresentation,
        comments: [MemoPresentation],
        onClose: @escaping () -> Void,
        onTogglePin: @escaping () -> Void = {},
        onDelete: @escaping () -> Void = {},
        onAddComment: @escaping (String) -> Void = { _ in },
        onTagClick: ((String) -> Void)? = nil
    ) {
        self.memo = memo
        self.comments = comments
        self.onClose = onClose
        self.onTogglePin = onTogglePin
        self.onDelete = onDelete
        self.onAddComment = onAddComment
        self.onTagClick = onTagClick
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                memoBody
                if let tags = memo.tags.isEmpty ? nil : memo.tags {
                    tagRow(tags)
                }
                Divider().overlay(FMColor.border.color.opacity(0.5))
                commentSection
            }
            .padding(.top, 4)
            .padding(.bottom, 48)
        }
    }

    // MARK: 头部

    private var header: some View {
        HStack(spacing: 8) {
            Button(action: onClose) {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 11, weight: .medium))
                    Text("记录")
                        .font(.system(size: 12.5))
                }
                .foregroundStyle(FMColor.mutedForeground.color)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("返回列表")

            Spacer(minLength: 0)

            Text(MemoTimeLabel.string(for: memo.createdAt))
                .font(.system(size: 12).monospacedDigit())
                .foregroundStyle(FMColor.mutedForeground.color)

            Menu {
                Button(memo.isPinned ? "取消置顶" : "置顶", action: onTogglePin)
                Button("删除", role: .destructive, action: onDelete)
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 12))
                    .foregroundStyle(FMColor.mutedForeground.color)
                    .frame(width: 24, height: 20)
                    .contentShape(Rectangle())
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .accessibilityLabel("更多操作")
        }
        .frame(height: 24)
    }

    // MARK: 正文

    private var memoBody: some View {
        // 阅读态走块模型：标题/列表/引用/代码块/分隔线/待办都按块渲染，
        // 不是把 Markdown 当纯文本行内处理。
        FMBlockView(markdown: memo.content, onTagClick: onTagClick)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func tagRow(_ tags: [String]) -> some View {
        HStack(spacing: 6) {
            ForEach(tags, id: \.self) { tag in
                Button {
                    onTagClick?(tag)
                } label: {
                    Text(tag)
                        .font(.system(size: 12))
                        .foregroundStyle(FMColor.primary.color.opacity(0.9))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background {
                            RoundedRectangle(cornerRadius: FMRadius.sm, style: .continuous)
                                .fill(FMColor.primary.color.opacity(0.08))
                        }
                }
                .buttonStyle(.plain)
                .disabled(onTagClick == nil)
                .accessibilityLabel("按标签 \(tag) 搜索")
            }
        }
    }

    // MARK: 评论

    private var commentSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(comments.isEmpty ? "还没有评论" : "\(comments.count) 条评论")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(FMColor.mutedForeground.color)

            ForEach(comments) { comment in
                VStack(alignment: .leading, spacing: 4) {
                    Text(MemoTimeLabel.string(for: comment.createdAt))
                        .font(.system(size: 11).monospacedDigit())
                        .foregroundStyle(FMColor.mutedForeground.color)
                    Text(comment.content)
                        .font(.system(size: 14))
                        .foregroundStyle(FMColor.foreground.color)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background {
                    RoundedRectangle(cornerRadius: FMRadius.lg, style: .continuous)
                        .fill(FMColor.secondary.color.opacity(0.45))
                }
            }

            commentComposer
        }
    }

    private var commentComposer: some View {
        HStack(spacing: 8) {
            TextField("写条评论…", text: $commentDraft, axis: .vertical)
                .textFieldStyle(.plain)
                .font(.system(size: 14))
                .lineLimit(1...4)
                .focused($commentFocused)
                .onSubmit(sendComment)

            Button(action: sendComment) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(
                        canSendComment
                            ? FMColor.primary.color
                            : FMColor.mutedForeground.color.opacity(0.5)
                    )
            }
            .buttonStyle(.plain)
            .disabled(!canSendComment)
            .accessibilityLabel("发送评论")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background {
            RoundedRectangle(cornerRadius: FMRadius.lg, style: .continuous)
                .fill(FMColor.card.color)
                .overlay {
                    RoundedRectangle(cornerRadius: FMRadius.lg, style: .continuous)
                        .strokeBorder(FMColor.border.color.opacity(0.7), lineWidth: 1)
                }
        }
    }

    private var canSendComment: Bool {
        !commentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func sendComment() {
        guard canSendComment else { return }
        onAddComment(commentDraft)
        commentDraft = ""
    }
}
