import Foundation
import GRDB

/// 本文件负责：outbox 单写者队列的读写 —— 入队、取下一批、失败退避、完成删除。
///
/// docs/native-clients.md §7.5：同一时刻只跑一个 pull 与一个 push；§7.7：
/// 「outbox 单写者循环：按 created_at 串行上送 → 成功删行；409 → LWW 覆盖后删行」。
///
/// 本层只提供**队列语义**，不关心 HTTP：真正的 push 循环在 `Sources/FlareMoCore/Sync/`
/// （同步引擎）里，它每次取 `nextBatch`、上送成功调 `complete`、失败调
/// `recordFailure`。
public struct OutboxStore: Sendable {
    public let database: AppDatabase

    public init(database: AppDatabase) {
        self.database = database
    }

    // MARK: - 入队（必须在写实体的事务里调用）

    /// 在已有事务中入队。调用方保证「实体 + outbox」在同一个事务里提交
    /// （§7.7「一次用户动作 = 一个事务」）。
    public static func enqueue(_ item: OutboxItem, in db: Database) throws {
        try item.insert(db)
    }

    // MARK: - 单写者取队列

    /// 取下一批可发送的行（按 `created_at, id` 串行、跳过未到重试时间的行、
    /// 跳过依赖尚未完成的行）。
    ///
    /// `depends_on` 的「依赖是否完成」用**依赖行是否还存在**判断：成功即删行，
    /// 所以不存在 = 已完成。这样不需要额外发明状态列（列清单是文档硬约束）。
    public func nextBatch(limit: Int = 1, now: ISOTimestamp = .now()) throws -> [OutboxItem] {
        let pageSize = max(1, min(limit, 100))
        return try database.read { db in
            try OutboxItem.fetchAll(
                db,
                sql: """
                    SELECT o.* FROM outbox o
                    WHERE (o.next_attempt_at IS NULL OR o.next_attempt_at <= :now)
                      AND (o.depends_on IS NULL OR NOT EXISTS (
                            SELECT 1 FROM outbox d WHERE d.id = o.depends_on))
                    ORDER BY o.created_at, o.id
                    LIMIT :limit
                    """,
                arguments: ["now": now, "limit": pageSize])
        }
    }

    /// 队列里所有行（诊断/测试用）。
    public func all() throws -> [OutboxItem] {
        try database.read { db in
            try OutboxItem.fetchAll(db, sql: "SELECT * FROM outbox ORDER BY created_at, id")
        }
    }

    /// 待发送条数（UI 同步状态角标用）。
    public func pendingCount() throws -> Int {
        try database.read { db in try OutboxItem.fetchCount(db) }
    }

    // MARK: - 结果回写

    /// 上送成功：删除该行（幂等；行已不存在也返回 nil）。
    @discardableResult
    public func complete(id: String) throws -> Bool {
        try database.write { db in
            try db.execute(sql: "DELETE FROM outbox WHERE id = ?", arguments: [id])
            return db.changesCount > 0
        }
    }

    /// 上送失败：`attempts += 1`，按指数退避写 `next_attempt_at`。
    ///
    /// 默认退避：第 1 次失败 2s、第 2 次 4s、第 3 次 8s……上限 300s。
    /// 409 冲突不应该走这里（同步层拉最新后直接 `complete`，LWW）。
    @discardableResult
    public func recordFailure(
        id: String,
        now: ISOTimestamp = .now(),
        retryDelay: TimeInterval? = nil
    ) throws -> OutboxItem? {
        try database.write { db in
            guard var item = try OutboxItem.fetchOne(db, key: id) else { return nil }
            item.attempts += 1
            let delay = retryDelay ?? Self.backoffDelay(forAttempt: item.attempts)
            item.nextAttemptAt = now.adding(seconds: delay)
            try item.update(db)
            return item
        }
    }

    /// 指数退避：2^n 秒，封顶 300 秒。
    public static func backoffDelay(forAttempt attempt: Int) -> TimeInterval {
        let exponent = min(max(attempt, 1), 9)
        return min(pow(2, Double(exponent)), 300)
    }

    // MARK: - 观察

    /// 待发送条数的观察（UI 显示「同步中 / 待发送 N 条」）。
    public func observePendingCount() -> ValueObservation<ValueReducers.Fetch<Int>> {
        return ValueObservation.tracking { db in
            try OutboxItem.fetchCount(db)
        }
    }
}
