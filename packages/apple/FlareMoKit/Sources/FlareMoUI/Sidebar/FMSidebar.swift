import FlareMoDesign
import SwiftUI

/// 主侧栏（flomo 的左侧轨道）。
///
/// 结构对齐 Web 端 `apps/web/src/components/flaremo-explorer.tsx`：
/// 顶部统计三格 → 导航行（记录 / 回顾 / 待办 / 文章）→ 标签区 → 底部用户。
/// 行样式严格照 `nav-item-styles.ts`：未激活是安静的墨色，激活态是一张抬起的纸片
/// （card 面色 + 发丝环 + xs 阴影，图标转 ember），绝不用实心大橙块。
public struct FMSidebar: View {
    @Binding private var selection: FMSidebarSection
    private let stats: FMSidebarStats
    private let tags: [String]
    private let userName: String

    public init(
        selection: Binding<FMSidebarSection>,
        stats: FMSidebarStats = .placeholder,
        tags: [String] = [],
        userName: String = "我"
    ) {
        _selection = selection
        self.stats = stats
        self.tags = tags
        self.userName = userName
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            logo
                .padding(.horizontal, FMWorkspaceMetrics.navRowPaddingHorizontal)
                .padding(.top, 14)
                .padding(.bottom, 12)

            statsRow
                .padding(.horizontal, FMWorkspaceMetrics.navRowPaddingHorizontal)
                .padding(.bottom, 14)

            navRows

            if !tags.isEmpty {
                tagSection
            }

            Spacer(minLength: 12)

            userRow
        }
        .frame(width: FMWorkspaceMetrics.sidebarWidth, alignment: .leading)
        .frame(maxHeight: .infinity)
    }

    // MARK: 品牌

    private var logo: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .fill(brandGradient)
                .frame(width: 22, height: 22)
                .overlay {
                    Image(systemName: "flame.fill")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.white)
                }
                .accessibilityHidden(true)

            Text("FlareMo")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(FMColor.foreground.color)
                .tracking(0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("FlareMo")
    }

    private var brandGradient: LinearGradient {
        LinearGradient(
            colors: [FMColor.brand400.color, FMColor.brandCoral.color],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    // MARK: 统计

    private var statsRow: some View {
        HStack(spacing: 0) {
            statCell(value: stats.recordCount, label: "记录")
            divider
            statCell(value: stats.tagCount, label: "标签")
            divider
            statCell(value: stats.streakDays, label: "连续天数")
        }
        .padding(.vertical, 10)
        .background {
            RoundedRectangle(cornerRadius: FMRadius.lg, style: .continuous)
                .fill(FMColor.secondary.color.opacity(0.5))
        }
        .accessibilityElement(children: .contain)
    }

    private func statCell(value: Int, label: String) -> some View {
        VStack(spacing: 2) {
            Text("\(value)")
                .font(.system(size: 17, weight: .semibold).monospacedDigit())
                .foregroundStyle(FMColor.foreground.color)
            Text(label)
                .font(.system(size: 11))
                .foregroundStyle(FMColor.mutedForeground.color)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label) \(value)")
    }

    private var divider: some View {
        Rectangle()
            .fill(FMColor.border.color.opacity(0.6))
            .frame(width: 1, height: 22)
    }

    // MARK: 导航

    private var navRows: some View {
        VStack(spacing: 2) {
            // 只列真的能切的分区：回顾 / 待办 / 文章还没做，
            // 列出来点进去还是时间线，属于「点了没反应」，先不显示。
            ForEach(FMSidebarSection.visible) { section in
                FMNavRow(
                    title: section.title,
                    systemImage: section.systemImage,
                    isActive: selection == section
                ) {
                    selection = section
                }
            }
        }
        .padding(.horizontal, FMWorkspaceMetrics.navRowPaddingHorizontal)
    }

    // MARK: 标签

    private var tagSection: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("标签")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(FMColor.mutedForeground.color)
                .padding(.horizontal, FMWorkspaceMetrics.navRowPaddingHorizontal)
                .padding(.top, 18)
                .padding(.bottom, 6)

            ForEach(tags, id: \.self) { tag in
                FMNavRow(title: tag, systemImage: "number", isActive: false) {}
            }
        }
        .padding(.horizontal, FMWorkspaceMetrics.navRowPaddingHorizontal)
    }

    // MARK: 用户

    private var userRow: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(FMColor.secondary.color)
                .frame(width: 22, height: 22)
                .overlay {
                    Text(String(userName.prefix(1)))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(FMColor.mutedForeground.color)
                }
            Text(userName)
                .font(.system(size: 13.5))
                .foregroundStyle(FMColor.foreground.color.opacity(0.7))
            Spacer()
        }
        .padding(.horizontal, FMWorkspaceMetrics.navRowPaddingHorizontal)
        .padding(.bottom, 14)
    }
}

/// 侧栏统计。
public struct FMSidebarStats: Hashable, Sendable {
    public let recordCount: Int
    public let tagCount: Int
    public let streakDays: Int

    public init(recordCount: Int, tagCount: Int, streakDays: Int) {
        self.recordCount = recordCount
        self.tagCount = tagCount
        self.streakDays = streakDays
    }

    public static let placeholder = FMSidebarStats(recordCount: 0, tagCount: 0, streakDays: 0)
}

/// 侧栏导航分区。
public enum FMSidebarSection: String, CaseIterable, Identifiable, Sendable {
    /// 侧栏当前真的可用的分区。每实现一个就往这里加一个。
    public static var visible: [FMSidebarSection] { [.records] }

    case records
    case review
    case todos
    case articles

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .records: "记录"
        case .review: "回顾"
        case .todos: "待办"
        case .articles: "文章"
        }
    }

    public var systemImage: String {
        switch self {
        case .records: "square.stack"
        case .review: "calendar"
        case .todos: "checkmark.circle"
        case .articles: "doc.text"
        }
    }
}

/// 单条导航行。样式照 `nav-item-styles.ts` 的 NAV_ITEM / NAV_ACTIVE。
struct FMNavRow: View {
    let title: String
    let systemImage: String
    let isActive: Bool
    let action: () -> Void

    @State private var isHovering = false
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Button(action: action) {
            HStack(spacing: FMWorkspaceMetrics.navRowIconSpacing) {
                Image(systemName: systemImage)
                    .font(.system(size: FMWorkspaceMetrics.navIconSize, weight: .regular))
                    .frame(width: FMWorkspaceMetrics.navIconSize, height: FMWorkspaceMetrics.navIconSize)
                    .foregroundStyle(isActive ? FMColor.primary.color : FMColor.mutedForeground.color)
                Text(title)
                    .font(.system(size: 13.5, weight: isActive ? .medium : .regular))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .foregroundStyle(
                        isActive ? FMColor.foreground.color : FMColor.foreground.color.opacity(0.7)
                    )
                Spacer(minLength: 0)
            }
            .padding(.horizontal, FMWorkspaceMetrics.navRowPaddingHorizontal)
            .frame(height: FMWorkspaceMetrics.navRowHeight)
            .background(background)
            .clipShape(RoundedRectangle(cornerRadius: FMRadius.lg, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .accessibilityLabel(title)
        .accessibilityAddTraits(isActive ? [.isSelected] : [])
    }

    @ViewBuilder
    private var background: some View {
        if isActive {
            RoundedRectangle(cornerRadius: FMRadius.lg, style: .continuous)
                .fill(colorScheme == .dark ? FMColor.muted.color : FMColor.card.color)
                .overlay {
                    RoundedRectangle(cornerRadius: FMRadius.lg, style: .continuous)
                        .strokeBorder(
                            FMColor.border.color.opacity(colorScheme == .dark ? 1 : 0.7),
                            lineWidth: 1
                        )
                }
        } else if isHovering {
            RoundedRectangle(cornerRadius: FMRadius.lg, style: .continuous)
                .fill(FMColor.muted.color.opacity(0.7))
        } else {
            Color.clear
        }
    }
}
