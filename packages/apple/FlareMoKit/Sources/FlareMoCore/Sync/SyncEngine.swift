import Foundation

/// 同步引擎（§4.4 / §4.5 / §7.5 的同一套算法，Android 与 Windows 将来照着实现）。
///
/// 两条独立的水位：
/// - **拉**：`since` 游标单调推进，只前进不后退；
/// - **推**：outbox 单写者串行上送，成功删行、失败退避。
///
/// 引擎本身不持状态，水位全在本地库里——这样进程被杀也不会丢进度。
public struct SyncEngine: Sendable {
    public let database: AppDatabase
    public let transport: any SyncTransport
    public let outbox: OutboxStore
    public let syncState: SyncStateStore
    public let remoteApply: RemoteApplyStore

    public init(database: AppDatabase, transport: any SyncTransport) {
        self.database = database
        self.transport = transport
        self.outbox = OutboxStore(database: database)
        self.syncState = SyncStateStore(database: database)
        self.remoteApply = RemoteApplyStore(database: database)
    }

    /// 一轮完整同步：先拉（拿到别人的改动），再推（把自己的改动送出去）。
    ///
    /// 顺序不是随意的：先拉能把服务端的最新版本取回来，后面推的时候
    /// `expected_version` 才是准的，冲突会显著变少。
    public func runOnce(pageLimit: Int = 200, pushLimit: Int = 20) async -> SyncRunSummary {
        var summary = SyncRunSummary()
        do {
            summary.pull = try await pullOnce(pageLimit: pageLimit)
        } catch {
            summary.pullError = String(describing: error)
            return summary
        }
        do {
            summary.push = try await pushOnce(limit: pushLimit)
        } catch {
            summary.pushError = String(describing: error)
        }
        return summary
    }

    // MARK: 拉

    /// 拉一轮：取一页变更 → 补正文 → 事务落库 → 推进水位。
    ///
    /// 顺序必须是「先落库、再推进水位」：如果先推进水位再落库，
    /// 中途崩溃就会永久丢掉这批变更。
    @discardableResult
    public func pullOnce(pageLimit: Int = 200) async throws -> PullSummary {
        let state = try syncState.current()
        let page = try await transport.fetchChanges(since: state.seq, limit: pageLimit)

        guard !page.changes.isEmpty else {
            try syncState.recordPull()
            return PullSummary(applied: 0, nextSince: state.seq, hasMore: page.hasMore)
        }

        // v1 只落 memo（附件/文章等实体在 M1+ 接），其余引用先跳过但不阻塞水位。
        let memoIDs = page.changes
            .filter { $0.entity == "memo" && $0.op != "delete" }
            .map(\.entityId)

        if !memoIDs.isEmpty {
            let hydration = try await transport.hydrate(HydrateRequest(memoIds: memoIDs))
            try remoteApply.apply(memos: hydration.memos)
        }

        // 删除也是变更：服务端 hydrate 不会返回已删除的行，这里直接落墓碑。
        let deletedMemoIDs = page.changes
            .filter { $0.entity == "memo" && $0.op == "delete" }
            .map(\.entityId)
        if !deletedMemoIDs.isEmpty {
            try markDeleted(memoIDs: deletedMemoIDs)
        }

        try syncState.advanceSeq(to: page.nextSeq)
        try syncState.recordPull()
        return PullSummary(
            applied: page.changes.count,
            nextSince: page.nextSeq,
            hasMore: page.hasMore
        )
    }

    /// 服务端说这条没了：本地落墓碑（保留行，等 30 天清理）。
    private func markDeleted(memoIDs: [String]) throws {
        try database.write { db in
            for id in memoIDs {
                try db.execute(
                    sql: """
                        UPDATE memos
                        SET status = 'trashed', deleted_at = ?, version = version + 1
                        WHERE id = ? AND deleted_at IS NULL
                        """,
                    arguments: [ISOTimestamp.now().string, id]
                )
            }
        }
    }

    // MARK: 推

    /// 推一轮：取一批 outbox → 上送 → 按结果删行 / 退避 / LWW 覆盖。
    @discardableResult
    public func pushOnce(limit: Int = 20) async throws -> PushSummary {
        let batch = try outbox.nextBatch(limit: limit)
        guard !batch.isEmpty else {
            return PushSummary(attempted: 0, applied: 0, conflicts: 0, retried: 0)
        }

        let operations = batch.map(Self.operation(from:))
        let response = try await transport.push(PushRequest(operations: operations))

        var applied = 0
        var conflicts = 0
        var retried = 0

        let resultsByKey = Dictionary(uniqueKeysWithValues: response.results.map { ($0.idempotencyKey, $0) })
        for item in batch {
            guard let result = resultsByKey[item.idempotencyKey] else {
                // 服务端没回这条：当失败处理，别把操作丢了。
                try outbox.recordFailure(id: item.id)
                retried += 1
                continue
            }
            switch result.status {
            case "applied", "duplicate":
                try outbox.complete(id: item.id)
                applied += 1
            case "conflict":
                // LWW：服务端赢，覆盖本地后删掉 outbox 行（§4.5）。
                if let serverMemo = result.serverMemo {
                    try remoteApply.apply(memos: [serverMemo])
                }
                try outbox.complete(id: item.id)
                conflicts += 1
            default:
                try outbox.recordFailure(id: item.id)
                retried += 1
            }
        }

        try syncState.recordPush()
        return PushSummary(
            attempted: batch.count,
            applied: applied,
            conflicts: conflicts,
            retried: retried
        )
    }

    /// JSONValue 是个封闭枚举，这里就地取值，避免为同步层给模型加一堆便利属性。
    private static func stringValue(_ value: JSONValue?) -> String? {
        if case let .string(text) = value { return text }
        return nil
    }

    private static func intValue(_ value: JSONValue?) -> Int? {
        if case let .int(number) = value { return number }
        if case let .double(number) = value { return Int(number) }
        return nil
    }

    private static func operation(from item: OutboxItem) -> PushOperation {
        PushOperation(
            idempotencyKey: item.idempotencyKey,
            op: item.op.rawValue,
            entity: item.entity.rawValue,
            entityId: item.entityId,
            clientId: Self.stringValue(item.payload["client_id"]) ?? item.entityId,
            expectedVersion: Self.intValue(item.payload["expected_version"]),
            payload: item.payload
        )
    }
}

// MARK: - 结果

public struct PullSummary: Sendable, Equatable {
    public var applied: Int
    public var nextSince: Int
    public var hasMore: Bool
}

public struct PushSummary: Sendable, Equatable {
    public var attempted: Int
    public var applied: Int
    public var conflicts: Int
    public var retried: Int
}

public struct SyncRunSummary: Sendable, Equatable {
    public var pull: PullSummary?
    public var push: PushSummary?
    public var pullError: String?
    public var pushError: String?

    public init() {}
}
