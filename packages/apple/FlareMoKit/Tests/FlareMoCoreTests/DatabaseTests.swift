import Foundation
import GRDB
import Testing
@testable import FlareMoCore

/// 本文件负责：本地库的建库验收 —— PRAGMA 精确值、表/索引齐全、FTS5 trigram
/// 触发器、结构版本标记、派生层可重建。
@Suite("本地库建库")
struct DatabaseTests {
    /// 读一组 PRAGMA；writer 与 reader 连接都要满足 §7.7 的取值。
    private func readPragmas(_ db: Database) throws -> (journal: String, synchronous: Int, foreignKeys: Int, busyTimeout: Int, tempStore: Int) {
        let journal = try String.fetchOne(db, sql: "PRAGMA journal_mode") ?? ""
        let synchronous = try Int.fetchOne(db, sql: "PRAGMA synchronous") ?? -1
        let foreignKeys = try Int.fetchOne(db, sql: "PRAGMA foreign_keys") ?? -1
        let busyTimeout = try Int.fetchOne(db, sql: "PRAGMA busy_timeout") ?? -1
        let tempStore = try Int.fetchOne(db, sql: "PRAGMA temp_store") ?? -1
        return (journal, synchronous, foreignKeys, busyTimeout, tempStore)
    }

    @Test("PRAGMA：WAL / synchronous=FULL / foreign_keys=ON / busy_timeout=5000 / temp_store=MEMORY")
    func pragmasAreExact() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }

        // writer 连接（synchronous 会被 GRDB 的 WAL 初始化改成 NORMAL，必须拉回 FULL）
        let writer = try database.pool.writeWithoutTransaction { db in
            try readPragmas(db)
        }
        #expect(writer.journal == "wal")
        #expect(writer.synchronous == 2, "synchronous=FULL 是速记场景的硬要求")
        #expect(writer.foreignKeys == 1)
        #expect(writer.busyTimeout == 5000)
        #expect(writer.tempStore == 2, "temp_store=MEMORY")

        // reader 连接同样要按 §7.7 配置
        let reader = try database.pool.read { db in
            try readPragmas(db)
        }
        #expect(reader.journal == "wal")
        #expect(reader.synchronous == 2)
        #expect(reader.foreignKeys == 1)
        #expect(reader.busyTimeout == 5000)
        #expect(reader.tempStore == 2)
    }

    @Test("事实层 + 本地表 + 派生层表齐全")
    func schemaTablesExist() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }

        let expectedTables: Set<String> = [
            // ① 事实层
            "memos", "memo_relations", "attachments", "articles", "tasks",
            // ③ 本地表
            "outbox", "sync_state", "blobs",
            // ② 派生层
            "memos_fts",
        ]

        let tables = try database.read { db in
            // FTS5 的 shadow table（memos_fts_data/_idx/_docsize/_config）不算业务表。
            try String.fetchAll(
                db,
                sql: """
                    SELECT name FROM sqlite_master
                    WHERE type = 'table'
                      AND name NOT LIKE 'sqlite_%'
                      AND name NOT LIKE 'memos_fts_%'
                    """
            )
        }
        #expect(Set(tables) == expectedTables)
    }

    @Test("列名与 D1 对齐：抽查 memos / memo_relations / attachments / articles / tasks")
    func columnsMatchD1() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }

        func columns(_ table: String) throws -> Set<String> {
            try database.read { db in
                Set(try db.columns(in: table).map(\.name))
            }
        }

        // memos：迁移 0048 的 version 必须在；评论锚点关系表也有 updated_at。
        let memoColumns: Set<String> = [
            "id", "user_id", "team_id", "content", "visibility", "status", "pinned",
            "source", "client_id", "payload", "created_at", "updated_at", "deleted_at",
            "embedding_status", "embedding_version", "embedded_at", "embedding_error",
            "embedding_chunks", "version",
        ]
        #expect(try columns("memos") == memoColumns)

        let relationColumns: Set<String> = [
            "memo_id", "related_memo_id", "type", "created_at", "updated_at",
        ]
        #expect(try columns("memo_relations") == relationColumns)

        let attachmentColumns: Set<String> = [
            "id", "user_id", "memo_id", "article_id", "r2_key", "filename", "content_type",
            "size", "thumbnail_size", "state", "client_id", "etag", "payload",
            "created_at", "updated_at", "deleted_at", "version",
        ]
        #expect(try columns("attachments") == attachmentColumns)

        let articleColumns: Set<String> = [
            "id", "user_id", "team_id", "slug", "title", "description", "content", "status",
            "cover_attachment_id", "lang", "published_at", "created_at", "updated_at",
            "deleted_at", "version",
        ]
        #expect(try columns("articles") == articleColumns)

        let taskColumns: Set<String> = [
            "id", "user_id", "project_id", "source_memo_id", "title", "notes", "status",
            "priority", "due_at", "sort_order", "completed_at", "deleted_at",
            "created_at", "updated_at",
        ]
        #expect(try columns("tasks") == taskColumns)

        // 本地表列集合是文档硬约束（§7.7），一个不能少。
        let outboxColumns: Set<String> = [
            "id", "op", "entity", "entity_id", "payload", "idempotency_key",
            "depends_on", "attempts", "next_attempt_at", "created_at",
        ]
        #expect(try columns("outbox") == outboxColumns)

        let syncStateColumns: Set<String> = [
            "id", "seq", "generation", "last_pull_at", "last_push_at",
        ]
        #expect(try columns("sync_state") == syncStateColumns)

        let blobColumns: Set<String> = [
            "sha256", "bytes", "mime", "remote_key", "state", "last_used_at",
        ]
        #expect(try columns("blobs") == blobColumns)
    }

    @Test("结构版本写进 PRAGMA user_version / application_id，sync_state 预置单行")
    func schemaVersionsAndInitialSyncState() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }

        let userVersion = try database.read { db in
            try Int.fetchOne(db, sql: "PRAGMA user_version") ?? -1
        }
        #expect(userVersion == DatabaseSchema.version)

        let derivedVersion = try database.read { db in
            try Int.fetchOne(db, sql: "PRAGMA application_id") ?? -1
        }
        #expect(derivedVersion == DatabaseSchema.derivedVersion)

        let state = try SyncStateStore(database: database).current()
        #expect(state.seq == 0)
        #expect(state.generation == 0)
        #expect(state.lastPullAt == nil)
        #expect(state.lastPushAt == nil)
    }

    @Test("FTS5 trigram 可用；<3 字符时 trigram 不命中（所以必须降级 LIKE）")
    func fts5TrigramIsAvailable() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }

        #expect(database.ftsAvailable, "本机系统 SQLite 应支持 FTS5 trigram")

        let ftsSQL = try database.read { db in
            try String.fetchOne(
                db,
                sql: "SELECT sql FROM sqlite_master WHERE name = 'memos_fts'") ?? ""
        }
        #expect(ftsSQL.contains("fts5"))
        #expect(ftsSQL.contains("trigram"))
        #expect(ftsSQL.contains("content='memos'") || ftsSQL.contains("content=\"memos\""))

        // 使用 external content 表：正文只有一份，派生层可重算。
        try database.write { db in
            try db.execute(
                sql: """
                    INSERT INTO memos (id, user_id, content, created_at, updated_at)
                    VALUES ('m-1', 'u-1', '今天写了中文笔记', '2026-11-08T10:00:00.000Z',
                            '2026-11-08T10:00:00.000Z')
                    """)
        }
        let threeCharHits = try database.read { db in
            try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM memos_fts WHERE memos_fts MATCH ?",
                arguments: [#""中文笔""#]) ?? 0
        }
        #expect(threeCharHits == 1)

        let twoCharHits = try database.read { db in
            try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM memos_fts WHERE memos_fts MATCH ?",
                arguments: [#""笔记""#]) ?? 0
        }
        #expect(twoCharHits == 0, "trigram 对 1–2 字符无法召回，必须由 LIKE 降级兜底")
    }

    @Test("FTS 触发器：插入/更新/删除都与 memos 同步")
    func ftsTriggersFollowMemos() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }

        let store = MemoStore(database: database, userId: "u-1")
        let memo = try store.create(content: "hello world apple", now: TestTime.t0)

        func ftsCount(_ phrase: String) throws -> Int {
            try database.read { db in
                try Int.fetchOne(
                    db,
                    sql: "SELECT COUNT(*) FROM memos_fts WHERE memos_fts MATCH ?",
                    arguments: [phrase]) ?? 0
            }
        }

        #expect(try ftsCount(#""hello world""#) == 1)

        try store.update(id: memo.id, content: "goodbye moon banana", now: TestTime.t1)
        #expect(try ftsCount(#""hello world""#) == 0)
        #expect(try ftsCount(#""moon ban""#) == 1)

        try database.write { db in
            try Memo.deleteOne(db, key: memo.id)
        }
        #expect(try ftsCount(#""moon ban""#) == 0)
    }

    @Test("派生层版本变化：memos_fts 整层重建，派生数据可重算")
    func derivedLayerRebuilds() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }

        let store = MemoStore(database: database, userId: "u-1")
        let memo = try store.create(content: "可以被重新索引的中文内容", now: TestTime.t0)
        _ = memo

        // 手动把派生层版本改旧，模拟「FTS 定义变了」。
        try database.write { db in
            try db.execute(sql: "PRAGMA application_id = 0")
        }
        try database.write { db in
            try DatabaseSchema.ensureDerivedLayer(db)
        }

        let derivedVersion = try database.read { db in
            try Int.fetchOne(db, sql: "PRAGMA application_id") ?? -1
        }
        #expect(derivedVersion == DatabaseSchema.derivedVersion)

        // 重建后索引仍有数据（external content 的 rebuild）。
        let hits = try database.read { db in
            try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM memos_fts WHERE memos_fts MATCH ?",
                arguments: [#""中文内容""#]) ?? 0
        }
        #expect(hits == 1)
    }
}
