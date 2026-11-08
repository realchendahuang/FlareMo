import Foundation
import GRDB

/// 本文件负责：memos 的**访问入口** —— 列表分页、单条、新建、更新、软删、恢复、
/// 置顶、搜索，以及交给 UI 的 `ValueObservation`。
///
/// 设计取舍（docs/native-clients.md §7.7）：
///
/// 1. **本地优先、事务内写 outbox**：每个用户动作在同一个事务里写实体 + outbox
///    （+ FTS 触发器跟随），提交后立即返回，UI 通过观察立刻刷新；网络由同步层
///    之后搬运。因此本类型**从不发网络请求**，导航与页面渲染只查本地库。
/// 2. **搜索语义对齐服务端**（§5.4 / §7.4）：
///    - 文本 ≥3 字符（Unicode scalar 计数）走本地 FTS5 trigram；
///    - <3 字符（中文两字是典型场景）降级 `LIKE %关键词%` —— trigram 对 1–2 字符
///      无法召回，这是 M1 验收项「中文两字搜索正确」；
///    - 操作符（`has:attachment` / `is:pinned` / `before:` / `after:` /
///      `in:`）解析规则照抄 `packages/contracts/src/search-query.ts`；
///    - 有搜索词且没有显式范围时，搜索范围是「时间线 + 归档」，与 D1 的
///      `listMemosForViewer` 一致。
/// 3. **评论不是时间线条目**：评论是 memos 行 + comment 关系，所有列表/搜索都
///    用 `NOT EXISTS (... type='comment')` 排除（对齐服务端 `notComment()`），
///    评论通过 `comments(for:)` 单独读。
/// 4. **排序与分页**：`pinned DESC, created_at DESC, id DESC` + keyset 游标
///    `(pinned, created_at, id)`，与 D1 的 `memos_user_status_pinned_created_id_idx`
///    排序、`decodePageToken` 语义一致；`id` 是 UUIDv7，天然时间有序，同毫秒
///    并列也能稳定分页（§7.7「同毫秒用 (updated_at, id) 兜底」的同理）。
public struct MemoStore: Sendable {
    public let database: AppDatabase
    /// 当前登录用户在服务端的 `users.id`。本地库是「当前用户可见的那一份」，
    /// 查询不再按 user_id 过滤（团队空间的作者 id ≠ 当前用户）；这个值只用于
    /// 新建行时填写 `user_id` 与 outbox。
    public let userId: String

    public init(database: AppDatabase, userId: String) {
        self.database = database
        self.userId = userId
    }

    /// 服务端 `createMemoSchema.source` 允许任意 ≤64 字符字符串，默认 `web`。
    /// Apple 端统一写 `apple`，便于服务端按来源统计（与服务端约定待 M0 确认）。
    public static let defaultSource = "apple"
    /// 服务端 `createMemoSchema.content` 的上限（100_000 字符）。
    public static let maxContentLength = 100_000

    // MARK: - 读：单条 / 列表 / 搜索 / 评论

    public func memo(id: String) throws -> Memo? {
        try database.read { db in try Memo.fetchOne(db, key: id) }
    }

    /// 列表分页（时间线 / 归档 / 回收站）。
    public func list(
        scope: MemoListScope = .timeline,
        limit: Int = 50,
        after cursor: MemoPageCursor? = nil
    ) throws -> MemoPage {
        try database.read { db in
            try listInDatabase(db, scope: scope, limit: limit, after: cursor)
        }
    }

    /// 某个 scope 的总条数（不含评论）。
    public func count(scope: MemoListScope = .timeline) throws -> Int {
        try database.read { db in
            try Int.fetchOne(
                db,
                sql: """
                    SELECT COUNT(*) FROM memos m
                    WHERE m.status = :status AND \(Self.notCommentCondition(alias: "m"))
                    """,
                arguments: ["status": scope.status.rawValue]) ?? 0
        }
    }

    /// 搜索入口（字符串形态，内部按 `MemoSearchQuery.parse` 解析操作符）。
    public func search(
        _ input: String,
        limit: Int = 50,
        after cursor: MemoPageCursor? = nil
    ) throws -> MemoPage {
        try search(MemoSearchQuery.parse(input), limit: limit, after: cursor)
    }

    /// 搜索入口（已解析的查询）。
    public func search(
        _ query: MemoSearchQuery,
        limit: Int = 50,
        after cursor: MemoPageCursor? = nil
    ) throws -> MemoPage {
        try database.read { db in
            try searchInDatabase(db, query: query, limit: limit, after: cursor)
        }
    }

    /// 某条 memo 下的评论（按时间正序）：评论 = memos 行 + comment 关系。
    public func comments(for memoID: String) throws -> [Memo] {
        try database.read { db in
            try Memo.fetchAll(
                db,
                sql: """
                    SELECT m.* FROM memos m
                    JOIN memo_relations r ON r.memo_id = m.id
                    WHERE r.related_memo_id = ? AND r.type = 'comment'
                    ORDER BY m.created_at ASC, m.id ASC
                    """,
                arguments: [memoID])
        }
    }

    // MARK: - 写：新建 / 更新 / 软删 / 恢复 / 置顶

    /// 新建 memo：客户端生成 UUIDv7 id，同一个事务里写实体 + outbox。
    ///
    /// `client_id` = 本地 id = outbox 幂等键：服务端 `POST /api/app/memos` 按
    /// `payload.client_id` 幂等，离线重放不会重复建（§4.1 / §4.4）。
    @discardableResult
    public func create(
        content: String,
        payload: MemoPayload = .empty,
        visibility: MemoVisibility = .private,
        source: String = MemoStore.defaultSource,
        teamId: String? = nil,
        now: ISOTimestamp = .now()
    ) throws -> Memo {
        let trimmedContent = try Self.validatedContent(content)
        let id = UUIDv7.generateString()
        var memoPayload = payload
        if memoPayload.clientID == nil {
            memoPayload.clientID = id
        }
        let memo = Memo(
            id: id,
            userId: userId,
            teamId: teamId,
            content: trimmedContent,
            visibility: visibility,
            status: .normal,
            pinned: false,
            source: source,
            clientId: id,
            payload: memoPayload,
            createdAt: now,
            updatedAt: now,
            version: 1)

        var body: [String: JSONValue] = [
            // 服务端 M0 契约（§7.7 全局约定 1）：接受客户端 id，离线创建的行
            // 同步前就能被引用/排期/评论。
            "id": .string(memo.id),
            "content": .string(memo.content),
            "visibility": .string(memo.visibility.rawValue),
            "source": .string(memo.source),
            "client_id": .string(id),
            "payload": try JSONValue.encoding(memo.payload),
            "created_at": .string(memo.createdAt.string),
            "updated_at": .string(memo.updatedAt.string),
        ]
        if let teamId {
            body["team_id"] = .string(teamId)
        }

        let item = OutboxItem(
            id: UUIDv7.generateString(),
            op: .create,
            entity: .memo,
            entityId: memo.id,
            payload: body,
            idempotencyKey: id,
            createdAt: now)

        return try database.write { db in
            try memo.insert(db)
            try OutboxStore.enqueue(item, in: db)
            return memo
        }
    }

    /// 更新 memo 的若干字段（内容 / payload / 可见性 / 置顶）。
    ///
    /// 乐观锁：本地版本号 +1，outbox 里记下 `expected_version = 更新前的版本`
    /// （同步层用它发 `PATCH ... expected_version`；409 时 LWW 覆盖本地）。
    @discardableResult
    public func update(
        id: String,
        content: String? = nil,
        payload: MemoPayload? = nil,
        visibility: MemoVisibility? = nil,
        pinned: Bool? = nil,
        now: ISOTimestamp = .now()
    ) throws -> Memo {
        let trimmedContent = try content.map(Self.validatedContent)

        return try database.write { db in
            guard let existing = try Memo.fetchOne(db, key: id) else {
                throw MemoStoreError.memoNotFound(id)
            }
            var memo = existing
            var changes: [String: JSONValue] = [:]
            if let trimmedContent {
                memo.content = trimmedContent
                changes["content"] = .string(trimmedContent)
            }
            if let payload {
                memo.payload = payload
                changes["payload"] = try JSONValue.encoding(payload)
            }
            if let visibility {
                memo.visibility = visibility
                changes["visibility"] = .string(visibility.rawValue)
            }
            if let pinned {
                memo.pinned = pinned
                changes["pinned"] = .bool(pinned)
            }
            guard !changes.isEmpty else { return memo }

            memo.version = existing.version + 1
            memo.updatedAt = now
            try memo.update(db)
            try enqueueMemoUpdate(
                db: db, memo: memo, expectedVersion: existing.version,
                changes: changes, op: .update, now: now)
            return memo
        }
    }

    /// 置顶 / 取消置顶。
    @discardableResult
    public func setPinned(
        id: String, isPinned: Bool, now: ISOTimestamp = .now()
    ) throws -> Memo {
        try update(id: id, pinned: isPinned, now: now)
    }

    /// 软删（进回收站）：`status='trashed'` + `deleted_at`，版本 +1。
    /// 服务端同样是 tombstone（§4.1「软删天然是 tombstone」）。
    @discardableResult
    public func softDelete(id: String, now: ISOTimestamp = .now()) throws -> Memo {
        try database.write { db in
            guard let existing = try Memo.fetchOne(db, key: id) else {
                throw MemoStoreError.memoNotFound(id)
            }
            if existing.status == .trashed, existing.deletedAt != nil {
                return existing
            }
            var memo = existing
            memo.status = .trashed
            memo.deletedAt = now
            memo.version = existing.version + 1
            memo.updatedAt = now
            try memo.update(db)
            try enqueueMemoUpdate(
                db: db, memo: memo, expectedVersion: existing.version,
                changes: [
                    "status": .string(MemoStatus.trashed.rawValue),
                    "deleted_at": .string(now.string),
                ],
                op: .delete, now: now)
            return memo
        }
    }

    /// 从回收站恢复。
    @discardableResult
    public func restore(id: String, now: ISOTimestamp = .now()) throws -> Memo {
        try database.write { db in
            guard let existing = try Memo.fetchOne(db, key: id) else {
                throw MemoStoreError.memoNotFound(id)
            }
            if existing.status == .normal, existing.deletedAt == nil {
                return existing
            }
            var memo = existing
            memo.status = .normal
            memo.deletedAt = nil
            memo.version = existing.version + 1
            memo.updatedAt = now
            try memo.update(db)
            try enqueueMemoUpdate(
                db: db, memo: memo, expectedVersion: existing.version,
                changes: [
                    "status": .string(MemoStatus.normal.rawValue),
                    "deleted_at": .null,
                ],
                op: .update, now: now)
            return memo
        }
    }

    // MARK: - ValueObservation（UI 只订阅查询，导航不发网络请求）

    /// 观察一个列表（scope + 条数）。UI 用
    /// `observation.start(in: database.pool, scheduling: .immediate, onChange:)`
    /// 或 `observation.values(in: database.pool)`。
    public func observeList(
        scope: MemoListScope = .timeline,
        limit: Int = 50
    ) -> ValueObservation<ValueReducers.Fetch<[Memo]>> {
        let store = self
        return ValueObservation.tracking { db in
            try store.listInDatabase(db, scope: scope, limit: limit, after: nil).memos
        }
    }

    /// 观察单条 memo（nil = 本地已不存在；删除后导航层据此回退）。
    public func observeMemo(id: String) -> ValueObservation<ValueReducers.Fetch<Memo?>> {
        ValueObservation.tracking { db in
            try Memo.fetchOne(db, key: id)
        }
    }

    /// 观察搜索结果的实时变化（搜索框边输边出）。
    public func observeSearch(
        _ input: String,
        limit: Int = 50
    ) -> ValueObservation<ValueReducers.Fetch<[Memo]>> {
        let store = self
        let query = MemoSearchQuery.parse(input)
        return ValueObservation.tracking { db in
            try store.searchInDatabase(db, query: query, limit: limit, after: nil).memos
        }
    }

    // MARK: - 内部：SQL

    private static func validatedContent(_ content: String) throws -> String {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw MemoStoreError.emptyContent }
        guard trimmed.count <= maxContentLength else {
            throw MemoStoreError.contentTooLong(trimmed.count)
        }
        return trimmed
    }

    private func enqueueMemoUpdate(
        db: Database,
        memo: Memo,
        expectedVersion: Int,
        changes: [String: JSONValue],
        op: OutboxOp,
        now: ISOTimestamp
    ) throws {
        var payload = changes
        payload["expected_version"] = .int(expectedVersion)
        let item = OutboxItem(
            id: UUIDv7.generateString(),
            op: op,
            entity: .memo,
            entityId: memo.id,
            payload: payload,
            idempotencyKey: UUIDv7.generateString(),
            createdAt: now)
        try OutboxStore.enqueue(item, in: db)
    }

    private func listInDatabase(
        _ db: Database,
        scope: MemoListScope,
        limit: Int,
        after cursor: MemoPageCursor?
    ) throws -> MemoPage {
        let pageSize = Self.clampedPageSize(limit)
        var sql = """
            SELECT m.* FROM memos m
            WHERE m.status = :status
              AND \(Self.notCommentCondition(alias: "m"))
            """
        var arguments: [String: (any DatabaseValueConvertible)?] = [
            "status": scope.status.rawValue,
            "limit": pageSize + 1,
        ]
        if let cursor {
            sql += "\n  AND \(Self.cursorCondition(cursor))"
            arguments.merge(Self.cursorArguments(cursor)) { _, new in new }
        }
        sql += "\nORDER BY m.pinned DESC, m.created_at DESC, m.id DESC\nLIMIT :limit"
        let rows = try Memo.fetchAll(db, sql: sql, arguments: StatementArguments(arguments))
        return Self.page(from: rows, pageSize: pageSize)
    }

    private func searchInDatabase(
        _ db: Database,
        query: MemoSearchQuery,
        limit: Int,
        after cursor: MemoPageCursor?
    ) throws -> MemoPage {
        let pageSize = Self.clampedPageSize(limit)
        var sql = """
            SELECT m.* FROM memos m
            WHERE \(Self.notCommentCondition(alias: "m"))
            """
        var arguments: [String: (any DatabaseValueConvertible)?] = ["limit": pageSize + 1]

        // 范围：显式 `in:` 优先；否则按服务端规则「有查询词 → 时间线 + 归档」。
        if let scope = query.scope {
            sql += "\n  AND m.status = :status"
            arguments["status"] = scope.status.rawValue
        } else if !query.raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            sql += "\n  AND m.status IN ('normal', 'archived')"
        } else {
            sql += "\n  AND m.status = 'normal'"
        }

        if query.hasAttachment {
            sql += """

                  AND EXISTS (
                      SELECT 1 FROM attachments a
                      WHERE a.memo_id = m.id
                        AND a.deleted_at IS NULL
                        AND a.state = 'ready'
                  )
                """
        }
        if query.isPinned {
            sql += "\n  AND m.pinned = 1"
        }
        if let after = query.after {
            sql += "\n  AND m.created_at >= :createdAfter"
            arguments["createdAfter"] = after + "T00:00:00.000Z"
        }
        if let before = query.before {
            sql += "\n  AND m.created_at < :createdBefore"
            arguments["createdBefore"] = before + "T00:00:00.000Z"
        }

        var termIndex = 0
        for term in query.text.split(whereSeparator: { $0.isWhitespace }).map(String.init) {
            if database.ftsAvailable, Self.isFTSQueryable(term) {
                sql +=
                    "\n  AND m.rowid IN (SELECT rowid FROM memos_fts WHERE memos_fts MATCH :fts\(termIndex))"
                arguments["fts\(termIndex)"] = Self.ftsPhrase(term)
            } else {
                // <3 字符（中文两字）或纯标点：trigram 无法召回，降级 LIKE。
                sql += "\n  AND m.content LIKE :like\(termIndex) ESCAPE '\\'"
                arguments["like\(termIndex)"] = "%\(Self.escapeLike(term))%"
            }
            termIndex += 1
        }

        if let cursor {
            sql += "\n  AND \(Self.cursorCondition(cursor))"
            arguments.merge(Self.cursorArguments(cursor)) { _, new in new }
        }
        sql += "\nORDER BY m.pinned DESC, m.created_at DESC, m.id DESC\nLIMIT :limit"

        let rows = try Memo.fetchAll(db, sql: sql, arguments: StatementArguments(arguments))
        return Self.page(from: rows, pageSize: pageSize)
    }

    // MARK: - 内部：搜索语法

    /// 是否走 FTS：trigram 需要 ≥3 个 Unicode scalar，且至少要有一个字母/数字
    /// （纯标点/引号的查询交给 LIKE，避免构造出病态的 MATCH 表达式）。
    static func isFTSQueryable(_ term: String) -> Bool {
        guard term.unicodeScalars.count >= 3 else { return false }
        return term.unicodeScalars.contains { CharacterSet.alphanumerics.contains($0) }
    }

    /// FTS5 短语查询：把用户输入整体包成 `"..."`，内部双引号按 FTS5 规则翻倍。
    /// trigram 的短语匹配退化为「子串匹配」，与 LIKE 的直觉一致。
    static func ftsPhrase(_ term: String) -> String {
        "\"" + term.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }

    /// 与服务端 `escapeLike` 一致：`\`、`%`、`_` 转义后配 `ESCAPE '\'`。
    static func escapeLike(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "%", with: "\\%")
            .replacingOccurrences(of: "_", with: "\\_")
    }

    // MARK: - 内部：分页

    static func clampedPageSize(_ limit: Int) -> Int {
        max(1, min(limit, 500))
    }

    static func page(from rows: [Memo], pageSize: Int) -> MemoPage {
        guard rows.count > pageSize else {
            return MemoPage(memos: rows, nextCursor: nil)
        }
        let memos = Array(rows.prefix(pageSize))
        guard let last = memos.last else {
            return MemoPage(memos: memos, nextCursor: nil)
        }
        return MemoPage(
            memos: memos,
            nextCursor: MemoPageCursor(pinned: last.pinned, createdAt: last.createdAt, id: last.id))
    }

    /// keyset 游标条件：`pinned DESC, created_at DESC, id DESC` 的严格后继。
    static func cursorCondition(_ cursor: MemoPageCursor) -> String {
        """
        (
              m.pinned < :cursorPinned
              OR (m.pinned = :cursorPinned AND (
                    m.created_at < :cursorCreatedAt
                    OR (m.created_at = :cursorCreatedAt AND m.id < :cursorId)
              ))
        )
        """
    }

    static func cursorArguments(_ cursor: MemoPageCursor) -> [String: (any DatabaseValueConvertible)?] {
        [
            "cursorPinned": cursor.pinned ? 1 : 0,
            "cursorCreatedAt": cursor.createdAt.string,
            "cursorId": cursor.id,
        ]
    }

    /// 评论是 memos 行 + comment 关系；时间线/搜索必须排除（对齐服务端 `notComment`）。
    static func notCommentCondition(alias: String) -> String {
        """
        NOT EXISTS (
              SELECT 1 FROM memo_relations r
              WHERE r.memo_id = \(alias).id AND r.type = 'comment'
        )
        """
    }
}

/// 列表范围：时间线 / 归档 / 回收站（映射到 D1 `memos.status`）。
public enum MemoListScope: String, Sendable, Hashable, Codable, CaseIterable {
    case timeline
    case archive
    case trash

    public var status: MemoStatus {
        switch self {
        case .timeline: .normal
        case .archive: .archived
        case .trash: .trashed
        }
    }
}

/// 分页游标：`(pinned, created_at, id)`，与 D1 的服务端 page token 同序。
public struct MemoPageCursor: Sendable, Hashable, Codable {
    public var pinned: Bool
    public var createdAt: ISOTimestamp
    public var id: String

    public init(pinned: Bool, createdAt: ISOTimestamp, id: String) {
        self.pinned = pinned
        self.createdAt = createdAt
        self.id = id
    }

    public init(memo: Memo) {
        self.init(pinned: memo.pinned, createdAt: memo.createdAt, id: memo.id)
    }
}

/// 一页结果；`nextCursor == nil` 表示没有更多。
public struct MemoPage: Sendable, Hashable {
    public var memos: [Memo]
    public var nextCursor: MemoPageCursor?

    public init(memos: [Memo], nextCursor: MemoPageCursor?) {
        self.memos = memos
        self.nextCursor = nextCursor
    }
}

/// MemoStore 的业务错误。
public enum MemoStoreError: Error, Equatable, Sendable, LocalizedError {
    case emptyContent
    case contentTooLong(Int)
    case memoNotFound(String)

    public var errorDescription: String? {
        switch self {
        case .emptyContent:
            return "内容不能为空"
        case .contentTooLong(let length):
            return "内容过长（\(length) 字符，上限 \(MemoStore.maxContentLength)）"
        case .memoNotFound(let id):
            return "本地库里没有这条 memo：\(id)"
        }
    }
}
