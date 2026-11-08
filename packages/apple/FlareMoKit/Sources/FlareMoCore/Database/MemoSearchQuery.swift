import Foundation

/// 本文件负责：本地搜索的查询语法解析 —— 与服务端
/// `packages/contracts/src/search-query.ts` 的 `parseMemoSearchQuery` **同一条规则**。
///
/// docs/native-clients.md §7.4「搜索语义一致性」要求三处同构，其中第 3 条：
/// 「中英混排 + 标签/`has:attachment` 等操作符：操作符解析复用
/// `packages/contracts/search-query.ts` 的规则，两端实现同一份语法」。
///
/// 规则（逐条照抄服务端）：
/// - 空白分词；
/// - `has:attachment` / `is:pinned` → 过滤条件；
/// - `before:YYYY-MM-DD` / `after:YYYY-MM-DD` → **UTC** 创建日期区间
///   （after 含当天、before 不含当天，语义见服务端 `toUtcDayStart`）；
/// - `in:timeline|archive|trash` → 搜索范围；
/// - 其余（含写错的操作符）一律当搜索文本，保持向后兼容。
public struct MemoSearchQuery: Sendable, Hashable, Codable {
    /// 原始输入（诊断与 UI 回显用）。
    public var raw: String
    /// 去掉操作符后剩余的可搜索文本。
    public var text: String
    public var hasAttachment: Bool
    public var isPinned: Bool
    /// `YYYY-MM-DD`（UTC，含当天）。
    public var after: String?
    /// `YYYY-MM-DD`（UTC，不含当天）。
    public var before: String?
    public var scope: MemoSearchScope?

    public init(raw: String = "", text: String = "", hasAttachment: Bool = false,
                isPinned: Bool = false, after: String? = nil, before: String? = nil,
                scope: MemoSearchScope? = nil) {
        self.raw = raw
        self.text = text
        self.hasAttachment = hasAttachment
        self.isPinned = isPinned
        self.after = after
        self.before = before
        self.scope = scope
    }

    /// 解析用户输入。与服务端一样：非法/写错的操作符退回为普通搜索文本。
    public static func parse(_ input: String) -> MemoSearchQuery {
        var query = MemoSearchQuery(raw: input)
        var textTerms: [String] = []
        for term in input.split(whereSeparator: { $0.isWhitespace }) {
            let term = String(term)
            let normalized = term.lowercased()
            if normalized == "has:attachment" {
                query.hasAttachment = true
                continue
            }
            if normalized == "is:pinned" {
                query.isPinned = true
                continue
            }
            if normalized.hasPrefix("before:") {
                let candidate = String(term.dropFirst("before:".count))
                if !candidate.isEmpty, Self.isValidUTCDate(candidate) {
                    query.before = candidate
                    continue
                }
            }
            if normalized.hasPrefix("after:") {
                let candidate = String(term.dropFirst("after:".count))
                if !candidate.isEmpty, Self.isValidUTCDate(candidate) {
                    query.after = candidate
                    continue
                }
            }
            if normalized.hasPrefix("in:") {
                let candidate = normalized.dropFirst("in:".count)
                if let scope = MemoSearchScope(rawValue: String(candidate)) {
                    query.scope = scope
                    continue
                }
            }
            textTerms.append(term)
        }
        query.text = textTerms.joined(separator: " ")
        return query
    }

    public var isEmpty: Bool {
        text.isEmpty && !hasAttachment && !isPinned && after == nil && before == nil && scope == nil
    }

    /// 是否含过滤条件（决定要不要走搜索专用 SQL，而不是普通列表）。
    public var hasFilters: Bool {
        hasAttachment || isPinned || after != nil || before != nil
    }

    /// `YYYY-MM-DD` 是否是真实存在的 UTC 日期（拒绝 `2026-02-31`）。
    static func isValidUTCDate(_ value: String) -> Bool {
        guard value.count == 10 else { return false }
        guard ISOTimestamp(validating: value + "T00:00:00.000Z") != nil else { return false }
        return true
    }
}

/// 搜索范围；与 `parseMemoSearchQuery` 的 `in:` 取值一致，映射到 D1 的 `status`。
public enum MemoSearchScope: String, Sendable, Hashable, Codable, CaseIterable {
    case timeline
    case archive
    case trash

    /// 对应 D1 `memos.status`（`packages/domain/src/memos-query.ts`
    /// `memoSearchScopeToState`）。
    public var status: MemoStatus {
        switch self {
        case .timeline: .normal
        case .archive: .archived
        case .trash: .trashed
        }
    }
}
