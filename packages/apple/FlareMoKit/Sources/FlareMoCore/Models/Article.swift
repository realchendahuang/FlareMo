import Foundation
import GRDB

/// 本文件负责：`articles` 表的事实层模型（长文，Markdown + 发布态）。
///
/// 列对齐 `packages/db/src/schema/content.ts`：`status` 只有
/// `draft` / `published` 两态；`published_at` 首次发布时写入、之后
/// 下架/再发布都保留；`deleted_at` 是回收站标记；`version` 来自迁移 0048。
///
/// 与 memos 的差别只在语义：article 有稳定的公开 URL（`slug`）和发布生命周期，
/// 但同步（`sync_changes`）与软删规则完全一致。
public struct Article: Codable, Sendable, Hashable, Identifiable,
    TableRecord, FetchableRecord, PersistableRecord
{
    public static let databaseTableName = "articles"
    public static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    public static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase

    public var id: String
    public var userId: String
    public var teamId: String?
    public var slug: String
    public var title: String
    public var description: String?
    public var content: String
    public var status: ArticleStatus
    /// og:image 指向的附件 id（D1 里没有外键，读取时自行兜底）。
    public var coverAttachmentId: String?
    public var lang: String?
    public var publishedAt: ISOTimestamp?
    public var createdAt: ISOTimestamp
    public var updatedAt: ISOTimestamp
    public var deletedAt: ISOTimestamp?
    /// 迁移 0048 新增。
    public var version: Int

    public init(
        id: String,
        userId: String,
        teamId: String? = nil,
        slug: String,
        title: String,
        description: String? = nil,
        content: String,
        status: ArticleStatus = .draft,
        coverAttachmentId: String? = nil,
        lang: String? = nil,
        publishedAt: ISOTimestamp? = nil,
        createdAt: ISOTimestamp,
        updatedAt: ISOTimestamp,
        deletedAt: ISOTimestamp? = nil,
        version: Int = 1
    ) {
        self.id = id
        self.userId = userId
        self.teamId = teamId
        self.slug = slug
        self.title = title
        self.description = description
        self.content = content
        self.status = status
        self.coverAttachmentId = coverAttachmentId
        self.lang = lang
        self.publishedAt = publishedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deletedAt = deletedAt
        self.version = version
    }
}

/// D1 `articles.status`：草稿 / 已发布。
public enum ArticleStatus: String, Codable, Sendable, Hashable, CaseIterable {
    case draft
    case published
}

extension ArticleStatus: DatabaseValueConvertible {
    public var databaseValue: DatabaseValue { rawValue.databaseValue }
    public static func fromDatabaseValue(_ dbValue: DatabaseValue) -> ArticleStatus? {
        String.fromDatabaseValue(dbValue).flatMap(ArticleStatus.init(rawValue:))
    }
}
