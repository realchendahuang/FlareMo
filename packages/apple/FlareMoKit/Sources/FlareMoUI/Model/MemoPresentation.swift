import FlareMoDesign
import SwiftUI

/// 加载本地库之前，列表与编辑器先吃这一层展示模型。
///
/// 为什么要在 UI 里留一层：GRDB 的 `Memo` 是存储模型（带 embedding 状态、
/// team、payload 等一堆 UI 不关心的列）。界面只认展示模型，这样存储层改列
/// 不会波及视图，预览与快照测试也不需要建库。
public struct MemoPresentation: Identifiable, Hashable, Sendable {
    public let id: String
    public let content: String
    public let createdAt: Date
    public let tags: [String]
    public let isPinned: Bool
    public let commentCount: Int
    /// 正文里的附件占位（v1 只显示占位，不内联图片）
    public let hasAttachment: Bool

    public init(
        id: String,
        content: String,
        createdAt: Date,
        tags: [String] = [],
        isPinned: Bool = false,
        commentCount: Int = 0,
        hasAttachment: Bool = false
    ) {
        self.id = id
        self.content = content
        self.createdAt = createdAt
        self.tags = tags
        self.isPinned = isPinned
        self.commentCount = commentCount
        self.hasAttachment = hasAttachment
    }

    /// 列表里显示的第一行（flomo 的速记没有标题，第一行就是它的"标题"）。
    public var firstLine: String {
        content.split(separator: "\n", omittingEmptySubsequences: true)
            .first.map(String.init) ?? ""
    }

    /// 去掉第一行之后的剩余正文。
    public var remainder: String {
        var lines = content.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard !lines.isEmpty else { return "" }
        lines.removeFirst()
        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// 时间显示。flomo 的规则：今天显示时分，今年显示月日，跨年补年份。
public enum MemoTimeLabel {
    public static func string(for date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_Hans_CN")
        if calendar.isDateInToday(date) {
            formatter.dateFormat = "HH:mm"
            return formatter.string(from: date)
        }
        if calendar.isDate(date, equalTo: now, toGranularity: .year) {
            formatter.dateFormat = "M月d日"
            return formatter.string(from: date)
        }
        formatter.dateFormat = "yyyy年M月d日"
        return formatter.string(from: date)
    }
}
