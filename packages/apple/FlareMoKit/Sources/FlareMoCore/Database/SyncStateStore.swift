import Foundation
import GRDB

/// 本文件负责：`sync_state` 单行水位的读写 —— `seq` 水位、`generation`、
/// 最后拉取/推送时间。
///
/// docs/native-clients.md §7.5：客户端只存一个 `seq` 水位（一个整数覆盖四类
/// 实体）；§7.7：收到 410 → `generation++` → 清空事实层 → 全量对齐。
/// 换代与清空事实层的原子操作在 `AppDatabase.prepareFullResync()`，本文件只管
/// 水位推进与时间戳。
public struct SyncStateStore: Sendable {
    public let database: AppDatabase

    public init(database: AppDatabase) {
        self.database = database
    }

    /// 当前水位。单行不存在（理论上不会）时补一行初始状态。
    public func current() throws -> SyncState {
        try database.read { db in
            if let state = try SyncState.fetchOne(db, key: 1) {
                return state
            }
            return .initial
        }
    }

    /// 推进 `seq` 水位。**只升不降**（乱序/重放的安全网）；换代由
    /// `AppDatabase.prepareFullResync()` 负责归零。
    @discardableResult
    public func advanceSeq(to seq: Int) throws -> SyncState {
        try database.write { db in
            try db.execute(
                sql: "UPDATE sync_state SET seq = MAX(seq, :seq) WHERE id = 1",
                arguments: ["seq": seq])
            guard let state = try SyncState.fetchOne(db, key: 1) else {
                throw DatabaseError(message: "sync_state 单行丢失")
            }
            return state
        }
    }

    /// 记录一次成功的拉取（`since` 水位时间）。
    @discardableResult
    public func recordPull(at timestamp: ISOTimestamp = .now()) throws -> SyncState {
        try database.write { db in
            try db.execute(
                sql: "UPDATE sync_state SET last_pull_at = :at WHERE id = 1",
                arguments: ["at": timestamp])
            guard let state = try SyncState.fetchOne(db, key: 1) else {
                throw DatabaseError(message: "sync_state 单行丢失")
            }
            return state
        }
    }

    /// 记录一次成功的上送。
    @discardableResult
    public func recordPush(at timestamp: ISOTimestamp = .now()) throws -> SyncState {
        try database.write { db in
            try db.execute(
                sql: "UPDATE sync_state SET last_push_at = :at WHERE id = 1",
                arguments: ["at": timestamp])
            guard let state = try SyncState.fetchOne(db, key: 1) else {
                throw DatabaseError(message: "sync_state 单行丢失")
            }
            return state
        }
    }

    /// 水位变化的观察（设置页/状态栏）。
    public func observe() -> ValueObservation<ValueReducers.Fetch<SyncState>> {
        return ValueObservation.tracking { db in
            try SyncState.fetchOne(db, key: 1) ?? .initial
        }
    }
}
