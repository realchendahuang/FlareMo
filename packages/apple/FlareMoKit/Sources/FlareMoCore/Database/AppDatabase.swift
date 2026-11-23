import Foundation
import GRDB

/// 本文件负责：本地库的连接、PRAGMA、结构版本与「整库重建」。
///
/// ## 连接模型（为什么是「一个 DatabasePool」）
///
/// docs/native-clients.md §7.7 要求「单写连接 + 多读连接（WAL 下读写并发）；
/// 写连接串行」。这里选**一个 `DatabasePool` 同时承担读写**，而不是
/// 「DatabaseQueue 写 + DatabasePool 读」：
/// - GRDB 的 `DatabasePool` 本身就是「1 个串行 writer + 最多 N 个 reader」的
///   结构（WAL），写事务天然串行、读可并发，正好是 §7.7 要的形态；
/// - 若对同一个文件再开一个 `DatabaseQueue` 当 writer，就是两个高层连接同时
///   观察/检查点同一个库：ValueObservation 的提交通知、WAL checkpoint、schema
///   缓存会被拆到两套连接上，问题排查成本远高于收益。
///
/// 因此：**写走 `pool.write`（GRDB 事务，一次用户动作 = 一个事务），
/// 读走 `pool.read`；观察走 `ValueObservation`（同样从 pool 启动）**。
///
/// ## PRAGMA（§7.7 精确取值）
///
/// | PRAGMA | 值 | 落点 |
/// | --- | --- | --- |
/// | `journal_mode` | `WAL` | `DatabasePool` 打开时自动设置（GRDB 的 WAL 初始化）|
/// | `synchronous` | `FULL` | 每个连接的 `prepareDatabase`；writer 在 WAL 初始化后会被 GRDB 改成 NORMAL，打开后要再拉回 FULL |
/// | `foreign_keys` | `ON` | `prepareDatabase`（GRDB 默认也开）|
/// | `busy_timeout` | `5000` | `Configuration.busyMode = .timeout(5)` + `prepareDatabase` |
/// | `temp_store` | `MEMORY` | `prepareDatabase` |
///
/// `synchronous=FULL` 的理由（§7.7）：速记是「打完字就合盖」的场景，宁可多一次
/// fsync，不能丢。
///
/// ## 结构版本（§7.7「本地库是副本」）
///
/// 本地库不做迁移链：`PRAGMA user_version` != 当前结构版本时，**保留 outbox
/// （以及 blobs 元数据）→ 删库文件 → 重建 → 重新灌回 outbox → 全量对齐**。
/// 派生层单独用 `PRAGMA application_id` 记版本：只改 FTS 定义时只重建派生层。
public final class AppDatabase: Sendable {
    /// GRDB 连接池：writer 串行、reader 并发。UI 的 `ValueObservation` 也从它启动。
    public let pool: DatabasePool
    /// 数据库文件路径（日志与诊断用）。
    public let path: String
    /// FTS5 + trigram 是否可用。不可用时搜索自动全程降级 LIKE（绝不崩）。
    public let ftsAvailable: Bool

    private init(pool: DatabasePool, path: String, ftsAvailable: Bool) {
        self.pool = pool
        self.path = path
        self.ftsAvailable = ftsAvailable
    }

    // MARK: - 打开

    /// 打开（必要时创建）目录下的 `library.sqlite`。
    public static func open(inDirectory directory: URL, fileName: String = "library.sqlite") throws -> AppDatabase {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return try open(atPath: directory.appendingPathComponent(fileName).path)
    }

    /// 打开（必要时创建）指定路径的本地库。
    public static func open(atPath path: String) throws -> AppDatabase {
        try open(atPath: path, schemaVersion: DatabaseSchema.version)
    }

    /// 内部入口：`schemaVersion` 仅供测试模拟「结构升级 → 整库重建」。
    static func open(atPath path: String, schemaVersion: Int) throws -> AppDatabase {
        try FileManager.default.createDirectory(
            at: URL(fileURLWithPath: path).deletingLastPathComponent(),
            withIntermediateDirectories: true)

        let preflight = try Preflight.inspect(path: path, schemaVersion: schemaVersion)
        if preflight.needsRebuild {
            // 本地库是副本：不做迁移，直接删文件重建（outbox 已在 preflight 里读进内存）。
            try removeDatabaseFiles(atPath: path)
        }

        let pool = try DatabasePool(path: path, configuration: makeConfiguration())

        // GRDB 在启用 WAL 时会把 writer 的 synchronous 改成 NORMAL（WAL 的常见
        // 折衷），这里按 §7.7 的硬要求拉回 FULL。读连接在 prepareDatabase 里已经
        // 是 FULL，且 reader 不写库，不受影响。
        try pool.writeWithoutTransaction { db in
            try db.execute(sql: "PRAGMA synchronous = FULL")
        }

        if preflight.needsBaseSchema || preflight.needsRebuild {
            try pool.write { db in
                try DatabaseSchema.createBaseTables(db, version: schemaVersion)
            }
        }

        if preflight.needsRebuild {
            // 保留本地未上送的写与未确认的 blob 元数据，避免「建库升级」吃掉用户
            // 离线产出的内容；随后由同步层做全量对齐（generation+1、seq 归零）。
            try pool.write { db in
                for item in preflight.outbox {
                    try item.insert(db)
                }
                for blob in preflight.blobs {
                    try blob.insert(db)
                }
                try db.execute(
                    sql: """
                        UPDATE sync_state
                        SET generation = generation + 1,
                            seq = 0,
                            last_pull_at = NULL,
                            last_push_at = NULL
                        WHERE id = 1
                        """)
            }
        }

        // 派生层：FTS5 + trigram。建不出来（例如 SQLite 没编进 FTS5/trigram）时
        // 不阻断启动——搜索降级 LIKE（§5.4），下次打开会再试一次。
        var ftsAvailable = false
        do {
            try pool.write { db in
                try DatabaseSchema.ensureDerivedLayer(db)
            }
            ftsAvailable = true
        } catch {
            #if DEBUG
                print("[FlareMoCore] memos_fts 创建失败，搜索降级 LIKE：\(error)")
            #endif
        }

        return AppDatabase(pool: pool, path: path, ftsAvailable: ftsAvailable)
    }

    // MARK: - 访问

    /// 读（会并发使用 reader 连接）。导航与页面渲染只应走这里，不发网络请求。
    public func read<T>(_ body: (Database) throws -> T) throws -> T {
        try pool.read(body)
    }

    /// 写（单写者串行；GRDB 会包一个事务）。
    ///
    /// 一次用户动作 = 一个事务：实体 + outbox（+ FTS 触发器）一起提交
    /// （§7.7「事务」一行）。
    @discardableResult
    public func write<T>(_ body: (Database) throws -> T) throws -> T {
        try pool.write(body)
    }

    /// 不包事务的写入口：同步层批量 hydrate 时自己控制事务边界用。
    @discardableResult
    public func writeWithoutTransaction<T>(_ body: (Database) throws -> T) throws -> T {
        try pool.writeWithoutTransaction(body)
    }

    /// 关闭连接（进程退出/测试清理用）。
    public func close() throws {
        try pool.close()
    }

    // MARK: - 全量对齐 / 重建

    /// 收到 410 或需要全量对齐时调用：清空事实层、`generation += 1`、`seq` 归零，
    /// 保留 outbox 与 blobs（§7.7「冲突与重建」）。
    @discardableResult
    public func prepareFullResync() throws -> SyncState {
        try pool.write { db in
            try DatabaseSchema.clearFactLayer(db)
            try db.execute(
                sql: """
                    UPDATE sync_state
                    SET generation = generation + 1,
                        seq = 0,
                        last_pull_at = NULL,
                        last_push_at = NULL
                    WHERE id = 1
                    """)
            guard let state = try SyncState.fetchOne(db, key: 1) else {
                throw DatabaseError(message: "sync_state 单行丢失")
            }
            return state
        }
    }

    // MARK: - 配置

    static func makeConfiguration() -> Configuration {
        var configuration = Configuration()
        // false 也行（默认 true），但显式写出来，和 §7.7 的 PRAGMA 表一一对应。
        configuration.foreignKeysEnabled = true
        // busy_timeout=5000 的 GRDB 写法；prepareDatabase 里还会再设一次 PRAGMA，
        // 保证 `PRAGMA busy_timeout` 本身也读得到 5000。
        configuration.busyMode = .timeout(5)
        configuration.prepareDatabase { db in
            // 每个连接（writer + 所有 reader）都套用同一组 PRAGMA。
            // journal_mode=WAL 由 DatabasePool 的 WAL 初始化负责，不在这里设置
            // （在只读连接上切 journal_mode 没有意义）。
            try db.execute(sql: "PRAGMA synchronous = FULL")
            try db.execute(sql: "PRAGMA temp_store = MEMORY")
            try db.execute(sql: "PRAGMA busy_timeout = 5000")
            try db.execute(sql: "PRAGMA foreign_keys = ON")
        }
        return configuration
    }

    // MARK: - 内部工具

    private static func removeDatabaseFiles(atPath path: String) throws {
        let manager = FileManager.default
        for suffix in ["", "-wal", "-shm"] {
            let filePath = path + suffix
            if manager.fileExists(atPath: filePath) {
                try manager.removeItem(atPath: filePath)
            }
        }
    }

    /// 打开前的预检：结构版本、是否需要重建、以及重建要抢救的本地数据。
    struct Preflight {
        var needsBaseSchema: Bool
        var needsRebuild: Bool
        var outbox: [OutboxItem]
        var blobs: [Blob]
        var generation: Int

        static func inspect(path: String, schemaVersion: Int) throws -> Preflight {
            let fresh = Preflight(
                needsBaseSchema: true, needsRebuild: false,
                outbox: [], blobs: [], generation: 0)
            guard FileManager.default.fileExists(atPath: path) else { return fresh }

            let queue = try DatabaseQueue(path: path, configuration: AppDatabase.makeConfiguration())
            defer { try? queue.close() }

            let userVersion = try queue.read { db in try Int.fetchOne(db, sql: "PRAGMA user_version") ?? 0 }
            let hasBaseSchema = try queue.read { db in try db.tableExists("memos") }
            guard hasBaseSchema else {
                // 空文件 / 半成品文件：按新库处理，不删文件（可能只是上次初始化失败）。
                return fresh
            }
            guard userVersion != schemaVersion else {
                // 结构一致：不需要建表、也不需要重建。
                return Preflight(
                    needsBaseSchema: false, needsRebuild: false,
                    outbox: [], blobs: [], generation: 0)
            }

            // 结构版本不一致：整库重建，抢救 outbox 与 blobs。
            // 注意这里只做「尽力而为」的读取：旧版本的表结构可能不认识某些列，
            // 读失败就丢弃那部分（outbox 的行格式在 v1 内是稳定的）。
            let outbox = (try? queue.read { db in try OutboxItem.fetchAll(db, sql: "SELECT * FROM outbox") }) ?? []
            let blobs = (try? queue.read { db in try Blob.fetchAll(db, sql: "SELECT * FROM blobs") }) ?? []
            let generation: Int =
                (try? queue.read { db in
                    try Int.fetchOne(db, sql: "SELECT generation FROM sync_state WHERE id = 1")
                }) ?? 0
            return Preflight(
                needsBaseSchema: true,
                needsRebuild: true,
                outbox: outbox,
                blobs: blobs,
                generation: generation)
        }
    }
}
