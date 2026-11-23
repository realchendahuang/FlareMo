import Foundation
import GRDB

/// 本文件负责：`blobs` 表 —— 二进制文件的元数据（文件本身在文件系统里）。
///
/// docs/native-clients.md §7.7「表分三层」第 ③ 层：
/// 文件按内容寻址落在 `<appSupport>/blobs/<sha2>/<sha2>/<sha>`，库里只存
/// `sha256`、字节数、mime、远端 key、状态、最后使用时间；**不把二进制塞进
/// SQLite**（同节「明确不做」）。
///
/// 生命周期（同节「二进制策略」）：
/// - 附件：先落本地文件 → `state = staged`（未同步文件永不删）；
/// - `POST /attachments/:id/complete` 成功后 → `state = ready`，才允许进入 LRU
///   淘汰候选；
/// - 缩略图随列表预取、原图按需下载，`last_used_at` 是 LRU 的依据。
public struct Blob: Codable, Sendable, Hashable,
    TableRecord, FetchableRecord, PersistableRecord
{
    public static let databaseTableName = "blobs"
    public static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    public static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase

    /// 内容的 SHA-256（十六进制小写）；内容寻址，所以直接做主键。
    public var sha256: String
    public var bytes: Int
    public var mime: String?
    /// 服务端 R2 对象 key；本地新建、还没上传时为 nil。
    public var remoteKey: String?
    public var state: BlobState
    /// LRU 淘汰依据；`staged` 状态下也记录，便于观察未同步文件。
    public var lastUsedAt: ISOTimestamp?

    public init(
        sha256: String,
        bytes: Int,
        mime: String? = nil,
        remoteKey: String? = nil,
        state: BlobState = .staged,
        lastUsedAt: ISOTimestamp? = nil
    ) {
        self.sha256 = sha256
        self.bytes = bytes
        self.mime = mime
        self.remoteKey = remoteKey
        self.state = state
        self.lastUsedAt = lastUsedAt
    }

    /// 内容寻址的本地相对路径：`<ab>/<cd>/<完整 sha>`（前 2 + 次 2 个字符分级）。
    public var relativePath: String {
        let first = String(sha256.prefix(2))
        let second = String(sha256.dropFirst(2).prefix(2))
        return "\(first)/\(second)/\(sha256)"
    }
}

/// blobs 层的本地状态。
///
/// - `staged`：本地已经有文件，但还没被服务端确认（outbox 引用中，永不淘汰）；
/// - `ready`：服务端已确认（或从服务端下载完成），可进入 LRU 淘汰候选；
/// - `missing`：库里还有元数据，但文件系统里找不到文件（下次访问触发重新下载）。
public enum BlobState: String, Codable, Sendable, Hashable, CaseIterable {
    case staged
    case ready
    case missing
}

extension BlobState: DatabaseValueConvertible {
    public var databaseValue: DatabaseValue { rawValue.databaseValue }
    public static func fromDatabaseValue(_ dbValue: DatabaseValue) -> BlobState? {
        String.fromDatabaseValue(dbValue).flatMap(BlobState.init(rawValue:))
    }
}
