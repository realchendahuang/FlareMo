import Foundation
import GRDB

/// 本文件负责：`blobs` 表（二进制元数据）的访问入口 —— 落盘后的登记、服务端
/// 确认、LRU 使用时间、淘汰候选。
///
/// docs/native-clients.md §7.7「二进制策略」：
/// - 缩略图随列表预取，LRU 淘汰，硬上限 200MB；
/// - 原图/音频按需下载，LRU 淘汰，硬上限 2GB；
/// - **被 outbox 引用或用户标记「离线保留」的永不淘汰；未同步的本地文件永不删除**：
///   所以淘汰候选只取 `state = ready` 的行，`staged` 永远不选；
/// - 文件内容按 sha256 寻址，落在文件系统，本表只存元数据。
public struct BlobStore: Sendable {
    public let database: AppDatabase

    public init(database: AppDatabase) {
        self.database = database
    }

    /// 读取一个 blob 的元数据。
    public func blob(sha256: String) throws -> Blob? {
        try database.read { db in try Blob.fetchOne(db, key: sha256) }
    }

    /// 本地落盘后登记（文件已经写到 `relativePath`）。重复登记会覆盖元数据，
    /// 但不会把 `ready` 降回 `staged`（服务端确认后重算 sha 的场景不应回退状态）。
    @discardableResult
    public func register(
        sha256: String,
        bytes: Int,
        mime: String? = nil,
        remoteKey: String? = nil,
        state: BlobState = .staged,
        now: ISOTimestamp = .now()
    ) throws -> Blob {
        try database.write { db in
            if var existing = try Blob.fetchOne(db, key: sha256) {
                existing.bytes = bytes
                if let mime { existing.mime = mime }
                if let remoteKey { existing.remoteKey = remoteKey }
                if state == .ready || existing.state != .ready { existing.state = state }
                existing.lastUsedAt = now
                try existing.update(db)
                return existing
            }
            let blob = Blob(
                sha256: sha256, bytes: bytes, mime: mime, remoteKey: remoteKey,
                state: state, lastUsedAt: now)
            try blob.insert(db)
            return blob
        }
    }

    /// 服务端 `complete` 成功后置 `ready`（之后才允许进入淘汰候选）。
    @discardableResult
    public func markReady(
        sha256: String, remoteKey: String? = nil, now: ISOTimestamp = .now()
    ) throws -> Blob? {
        try database.write { db in
            guard var blob = try Blob.fetchOne(db, key: sha256) else { return nil }
            blob.state = .ready
            if let remoteKey { blob.remoteKey = remoteKey }
            blob.lastUsedAt = now
            try blob.update(db)
            return blob
        }
    }

    /// 记录一次使用（LRU 依据）。
    public func touch(sha256: String, now: ISOTimestamp = .now()) throws {
        try database.write { db in
            try db.execute(
                sql: "UPDATE blobs SET last_used_at = :at WHERE sha256 = :sha",
                arguments: ["at": now, "sha": sha256])
        }
    }

    /// 标记文件系统里已找不到（下次访问触发重新下载）。
    public func markMissing(sha256: String) throws {
        try database.write { db in
            try db.execute(
                sql: "UPDATE blobs SET state = 'missing' WHERE sha256 = :sha",
                arguments: ["sha": sha256])
        }
    }

    /// 删除元数据（文件由调用方删除；本表不碰文件系统）。
    @discardableResult
    public func delete(sha256: String) throws -> Bool {
        try database.write { db in
            try db.execute(sql: "DELETE FROM blobs WHERE sha256 = ?", arguments: [sha256])
            return db.changesCount > 0
        }
    }

    /// LRU 淘汰候选：只取 `ready`，按 `last_used_at` 从旧到新（NULL 视为最旧）。
    public func evictionCandidates(limit: Int = 50) throws -> [Blob] {
        let pageSize = max(1, min(limit, 500))
        return try database.read { db in
            try Blob.fetchAll(
                db,
                sql: """
                    SELECT * FROM blobs
                    WHERE state = 'ready'
                    ORDER BY COALESCE(last_used_at, '1970-01-01T00:00:00.000Z'), sha256
                    LIMIT :limit
                    """,
                arguments: ["limit": pageSize])
        }
    }

    /// 已缓存二进制的总字节数（配额判断用）。
    public func totalBytes() throws -> Int {
        try database.read { db in
            try Int.fetchOne(db, sql: "SELECT COALESCE(SUM(bytes), 0) FROM blobs") ?? 0
        }
    }
}
