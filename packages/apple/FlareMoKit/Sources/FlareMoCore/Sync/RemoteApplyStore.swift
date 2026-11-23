import Foundation
import GRDB

/// 把服务端回来的行写进本地库。
///
/// **和 `MemoStore` 的写路径刻意分开**：本地写要顺带入 outbox（等上送），
/// 而同步落库是「服务端已经是事实」，绝不能再产生 outbox 行，否则会无限回环。
public struct RemoteApplyStore: Sendable {
    public let database: AppDatabase

    public init(database: AppDatabase) {
        self.database = database
    }

    /// 在一个事务里批量 upsert。整批要么全成、要么全不成，配合水位推进才安全。
    public func apply(memos: [RemoteMemo]) throws {
        guard !memos.isEmpty else { return }
        try database.write { db in
            for memo in memos {
                try Self.upsert(memo: memo, in: db)
            }
        }
    }

    private static func upsert(memo: RemoteMemo, in db: Database) throws {
        // 用显式 SQL 而不是 record.save：同步来的行可能缺本地默认值，
        // ON CONFLICT 只更新服务端关心的列，本地派生列（embedding_*）保持不动。
        try db.execute(
            sql: """
                INSERT INTO memos (
                    id, user_id, team_id, content, visibility, status, pinned,
                    source, client_id, payload, created_at, updated_at, deleted_at, version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    user_id    = excluded.user_id,
                    team_id    = excluded.team_id,
                    content    = excluded.content,
                    visibility = excluded.visibility,
                    status     = excluded.status,
                    pinned     = excluded.pinned,
                    source     = excluded.source,
                    client_id  = excluded.client_id,
                    payload    = excluded.payload,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    deleted_at = excluded.deleted_at,
                    version    = excluded.version
                """,
            arguments: [
                memo.id,
                memo.userId,
                memo.teamId,
                memo.content,
                memo.visibility,
                memo.status,
                memo.pinned,
                memo.source,
                memo.clientId,
                try Self.encodePayload(memo.payload),
                memo.createdAt,
                memo.updatedAt,
                memo.deletedAt,
                memo.version,
            ]
        )
    }

    /// payload 在本地是 JSON 文本列。
    private static func encodePayload(_ payload: MemoPayload) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(payload)
        return String(decoding: data, as: UTF8.self)
    }
}
