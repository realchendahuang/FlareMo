import Foundation
import GRDB

/// 本文件负责：`memo_relations` 表的事实层模型。
///
/// 这是「评论」在数据层的落点（docs/native-clients.md §4.1）：服务端没有
/// `comments` 表，评论就是一条 `memos` 行 + 一条
/// `memo_relations(memo_id=评论 id, related_memo_id=父 id, type='comment')`。
/// 因此本表既表达 `reference`，也表达评论的父子关系。
///
/// 列对齐：主键是联合主键 `(memo_id, related_memo_id, type)`（见迁移 0000），
/// `updated_at` 来自迁移 0048（`text NOT NULL DEFAULT
/// '1970-01-01T00:00:00.000Z'`，回填时被写成 `created_at`）。
/// GRDB 的 `save` / `update` 会从数据库 schema 读取联合主键，不需要在类型里声明。
public struct MemoRelation: Codable, Sendable, Hashable,
    TableRecord, FetchableRecord, PersistableRecord
{
    public static let databaseTableName = "memo_relations"
    public static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    public static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase

    public var memoId: String
    public var relatedMemoId: String
    public var type: MemoRelationType
    public var createdAt: ISOTimestamp
    /// 迁移 0048 新增：评论关系也要参与增量同步。D1 的列默认值就是 1970 纪元。
    public var updatedAt: ISOTimestamp

    public init(
        memoId: String,
        relatedMemoId: String,
        type: MemoRelationType,
        createdAt: ISOTimestamp,
        updatedAt: ISOTimestamp? = nil
    ) {
        self.memoId = memoId
        self.relatedMemoId = relatedMemoId
        self.type = type
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
    }
}

/// D1 `memo_relations.type` 的两个取值。
public enum MemoRelationType: String, Codable, Sendable, Hashable, CaseIterable {
    case reference
    case comment
}

extension MemoRelationType: DatabaseValueConvertible {
    public var databaseValue: DatabaseValue { rawValue.databaseValue }
    public static func fromDatabaseValue(_ dbValue: DatabaseValue) -> MemoRelationType? {
        String.fromDatabaseValue(dbValue).flatMap(MemoRelationType.init(rawValue:))
    }
}
