import Foundation
import GRDB

/// 本文件负责：`memos` 表 / 评论锚点的事实层模型。
///
/// 列与服务端 D1 **逐一对齐**（`packages/db/src/schema/memos.ts` + 迁移 0048）：
/// - `version` 列来自 docs/native-clients.md §4.3 迁移 0048（`integer NOT NULL
///   DEFAULT 1`）。它既是乐观锁（`PATCH ... expected_version`），也是
///   `sync_changes` 的版本号。本地 schema 一次性按 0048 之后的形态建库，
///   不做迁移链（§7.7「本地库是副本」）。
/// - 文件的 Codable 表示使用 camelCase（给 Swift/JSON 用），数据库列名由
///   `databaseColumnEncodingStrategy/.convertToSnakeCase` 映射成 snake_case，
///   与 D1 完全一致。
///
/// 评论不是独立表：一条评论 = 一条完整的 `memos` 行 + 一条
/// `memo_relations(memo_id=评论, related_memo_id=父记录, type='comment')`。
/// 时间线查询必须用 `NOT EXISTS (... type='comment')` 把评论排除掉
/// （对齐服务端 `notComment()`，见 `packages/domain/src/memo-comment-filter.ts`）。
public struct Memo: Codable, Sendable, Hashable, Identifiable,
    TableRecord, FetchableRecord, PersistableRecord
{
    public static let databaseTableName = "memos"
    public static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    public static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase

    public var id: String
    public var userId: String
    public var teamId: String?
    public var content: String
    public var visibility: MemoVisibility
    public var status: MemoStatus
    public var pinned: Bool
    public var source: String
    public var clientId: String?
    public var payload: MemoPayload
    public var createdAt: ISOTimestamp
    public var updatedAt: ISOTimestamp
    public var deletedAt: ISOTimestamp?
    public var embeddingStatus: MemoEmbeddingStatus
    public var embeddingVersion: String?
    public var embeddedAt: ISOTimestamp?
    public var embeddingError: String?
    public var embeddingChunks: Int?
    /// 迁移 0048 新增；评论的乐观锁也由它覆盖。
    public var version: Int

    public init(
        id: String,
        userId: String,
        teamId: String? = nil,
        content: String,
        visibility: MemoVisibility = .private,
        status: MemoStatus = .normal,
        pinned: Bool = false,
        source: String = "web",
        clientId: String? = nil,
        payload: MemoPayload = .empty,
        createdAt: ISOTimestamp,
        updatedAt: ISOTimestamp,
        deletedAt: ISOTimestamp? = nil,
        embeddingStatus: MemoEmbeddingStatus = .notIndexed,
        embeddingVersion: String? = nil,
        embeddedAt: ISOTimestamp? = nil,
        embeddingError: String? = nil,
        embeddingChunks: Int? = nil,
        version: Int = 1
    ) {
        self.id = id
        self.userId = userId
        self.teamId = teamId
        self.content = content
        self.visibility = visibility
        self.status = status
        self.pinned = pinned
        self.source = source
        self.clientId = clientId
        self.payload = payload
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deletedAt = deletedAt
        self.embeddingStatus = embeddingStatus
        self.embeddingVersion = embeddingVersion
        self.embeddedAt = embeddedAt
        self.embeddingError = embeddingError
        self.embeddingChunks = embeddingChunks
        self.version = version
    }

    /// 是否在回收站（服务端软删即 tombstone：`status='trashed'` + `deleted_at`）。
    public var isTrashed: Bool { status == .trashed || deletedAt != nil }
}

/// D1 `memos.visibility` 的三个取值。`private` / `public` 是 Swift 关键字，
/// 用反引号声明后 `.private` / `.public` 在调用点仍可正常书写。
public enum MemoVisibility: String, Codable, Sendable, Hashable, CaseIterable {
    case `private` = "private"
    case protected = "protected"
    case `public` = "public"
}

/// D1 `memos.status` 的四个取值。
///
/// `trashed` 是「进回收站」，`deleted` 是同步层可能带来的硬删墓碑（查询默认都
/// 过滤掉）；时间线/归档/回收站分别对应 normal / archived / trashed。
public enum MemoStatus: String, Codable, Sendable, Hashable, CaseIterable {
    case normal
    case archived
    case trashed
    case deleted
}

/// D1 `memos.embedding_status`：语义搜索索引状态。本地只做镜像，不消费。
public enum MemoEmbeddingStatus: String, Codable, Sendable, Hashable, CaseIterable {
    case notIndexed = "not_indexed"
    case pending
    case indexed
    case error
}

// MARK: - GRDB 值映射

extension MemoVisibility: DatabaseValueConvertible {
    public var databaseValue: DatabaseValue { rawValue.databaseValue }
    public static func fromDatabaseValue(_ dbValue: DatabaseValue) -> MemoVisibility? {
        String.fromDatabaseValue(dbValue).flatMap(MemoVisibility.init(rawValue:))
    }
}

extension MemoStatus: DatabaseValueConvertible {
    public var databaseValue: DatabaseValue { rawValue.databaseValue }
    public static func fromDatabaseValue(_ dbValue: DatabaseValue) -> MemoStatus? {
        String.fromDatabaseValue(dbValue).flatMap(MemoStatus.init(rawValue:))
    }
}

extension MemoEmbeddingStatus: DatabaseValueConvertible {
    public var databaseValue: DatabaseValue { rawValue.databaseValue }
    public static func fromDatabaseValue(_ dbValue: DatabaseValue) -> MemoEmbeddingStatus? {
        String.fromDatabaseValue(dbValue).flatMap(MemoEmbeddingStatus.init(rawValue:))
    }
}
