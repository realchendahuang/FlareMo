import Foundation
import GRDB

/// 本文件负责：`attachments` 表的事实层模型（**只存元数据**，二进制在 blobs 层）。
///
/// 列对齐 `packages/db/src/schema/content.ts`（含迁移 0041 的 `thumbnail_size`、
/// 0029 的 `article_id`、0002 的 `state` / `etag`、0004 的 `client_id`，以及
/// 迁移 0048 的 `version`）。默认值逐个照抄 D1：`size=0`、
/// `thumbnail_size=0`、`state='ready'`、`payload='{}'`、`version=1`。
///
/// 二进制不进 SQLite（§7.7「明确不做」）：真正的文件在文件系统
/// `<appSupport>/blobs/<sha2>/<sha2>/<sha>`，这里只留 `r2_key` 等元数据；
/// 本地文件状态在 `Blob`（`blobs` 表）里。
public struct Attachment: Codable, Sendable, Hashable, Identifiable,
    TableRecord, FetchableRecord, PersistableRecord
{
    public static let databaseTableName = "attachments"
    public static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    public static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase

    public var id: String
    public var userId: String
    public var memoId: String?
    public var articleId: String?
    public var r2Key: String
    public var filename: String
    public var contentType: String?
    public var size: Int
    /// 派生的缩略图对象字节数；和 `size`（原文件）分开存，配额要算两者之和。
    public var thumbnailSize: Int
    public var state: AttachmentState
    /// 离线重试时用来认出「上传其实已成功、只是响应丢了」的附件。
    public var clientId: String?
    public var etag: String?
    /// D1 里是 `Record<string, unknown>`：未知键必须原样保留。
    public var payload: [String: JSONValue]
    public var createdAt: ISOTimestamp
    public var updatedAt: ISOTimestamp
    public var deletedAt: ISOTimestamp?
    /// 迁移 0048 新增。
    public var version: Int

    public init(
        id: String,
        userId: String,
        memoId: String? = nil,
        articleId: String? = nil,
        r2Key: String,
        filename: String,
        contentType: String? = nil,
        size: Int = 0,
        thumbnailSize: Int = 0,
        state: AttachmentState = .ready,
        clientId: String? = nil,
        etag: String? = nil,
        payload: [String: JSONValue] = [:],
        createdAt: ISOTimestamp,
        updatedAt: ISOTimestamp,
        deletedAt: ISOTimestamp? = nil,
        version: Int = 1
    ) {
        self.id = id
        self.userId = userId
        self.memoId = memoId
        self.articleId = articleId
        self.r2Key = r2Key
        self.filename = filename
        self.contentType = contentType
        self.size = size
        self.thumbnailSize = thumbnailSize
        self.state = state
        self.clientId = clientId
        self.etag = etag
        self.payload = payload
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deletedAt = deletedAt
        self.version = version
    }
}

/// D1 `attachments.state`：`ready` / `deleting` / `missing`。
public enum AttachmentState: String, Codable, Sendable, Hashable, CaseIterable {
    case ready
    case deleting
    case missing
}

extension AttachmentState: DatabaseValueConvertible {
    public var databaseValue: DatabaseValue { rawValue.databaseValue }
    public static func fromDatabaseValue(_ dbValue: DatabaseValue) -> AttachmentState? {
        String.fromDatabaseValue(dbValue).flatMap(AttachmentState.init(rawValue:))
    }
}
