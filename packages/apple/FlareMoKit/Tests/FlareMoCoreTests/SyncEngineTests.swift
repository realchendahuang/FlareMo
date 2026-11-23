import Foundation
import Testing

@testable import FlareMoCore

/// 本文件负责：同步引擎的拉 / 推两条链路（§4.4 / §4.5）。
/// 全部对着 `FakeTransport` 跑，不起网络 —— 真实 HTTP 实现等后端 M0 落地后另测契约。
@Suite("同步引擎")
struct SyncEngineTests {

    // MARK: 夹具

    /// 可编排的假传输层：记录调用、按脚本返回。
    actor FakeTransport: SyncTransport {
        var changesPages: [SyncChangesPage] = []
        var hydration: HydrateResponse
        var pushResponse: PushResponse
        private(set) var pushRequests: [PushRequest] = []
        private(set) var hydrateRequests: [HydrateRequest] = []
        private(set) var changesCalls: [(since: Int, limit: Int)] = []

        init(
            hydration: HydrateResponse = HydrateResponse(memos: [], attachments: [], articles: []),
            pushResponse: PushResponse = PushResponse(results: [])
        ) {
            self.hydration = hydration
            self.pushResponse = pushResponse
        }

        func queue(page: SyncChangesPage) { changesPages.append(page) }

        func fetchChanges(since: Int, limit: Int) async throws -> SyncChangesPage {
            changesCalls.append((since, limit))
            if changesPages.isEmpty {
                return SyncChangesPage(changes: [], nextSeq: since, hasMore: false)
            }
            return changesPages.removeFirst()
        }

        func hydrate(_ request: HydrateRequest) async throws -> HydrateResponse {
            hydrateRequests.append(request)
            return hydration
        }

        func push(_ request: PushRequest) async throws -> PushResponse {
            pushRequests.append(request)
            return pushResponse
        }
    }

    private func remoteMemo(
        id: String,
        content: String,
        version: Int = 1,
        deletedAt: String? = nil
    ) -> RemoteMemo {
        RemoteMemo(
            id: id,
            userId: "local-user",
            teamId: nil,
            content: content,
            visibility: "private",
            status: deletedAt == nil ? "normal" : "trashed",
            pinned: false,
            source: "web",
            clientId: id,
            payload: .empty,
            createdAt: "2026-11-08T10:00:00.000Z",
            updatedAt: "2026-11-08T10:00:00.000Z",
            deletedAt: deletedAt,
            version: version
        )
    }

    // MARK: 拉

    @Test("空页：水位不动，但记录一次 pull 时间")
    func pullEmptyPage() async throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }

        let transport = FakeTransport()
        let engine = SyncEngine(database: database, transport: transport)
        let stateBefore = try SyncStateStore(database: database).current()

        let summary = try await engine.pullOnce()

        #expect(summary.applied == 0)
        #expect(summary.nextSince == stateBefore.seq)
        let stateAfter = try SyncStateStore(database: database).current()
        #expect(stateAfter.seq == stateBefore.seq)
        #expect(stateAfter.lastPullAt != nil)
        // 空轮询不该发 hydrate 请求
        #expect(await transport.hydrateRequests.isEmpty)
    }

    @Test("有变更：补正文 → 落库 → 推进水位")
    func pullAppliesChanges() async throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }

        let memo = remoteMemo(id: "0199aa00-0000-7000-8000-0000000000a1", content: "服务端来的")
        let transport = FakeTransport(
            hydration: HydrateResponse(memos: [memo], attachments: [], articles: [])
        )
        await transport.queue(
            page: SyncChangesPage(
                changes: [
                    SyncChange(seq: 7, entity: "memo", entityId: memo.id, op: "upsert", version: 1)
                ],
                nextSeq: 7,
                hasMore: false
            )
        )
        let engine = SyncEngine(database: database, transport: transport)

        let summary = try await engine.pullOnce()

        #expect(summary.applied == 1)
        #expect(summary.nextSince == 7)
        let store = MemoStore(database: database, userId: "local-user")
        #expect(try store.memo(id: memo.id)?.content == "服务端来的")
        #expect(try SyncStateStore(database: database).current().seq == 7)
        // 同步落库不能产生 outbox 行，否则会无限回环
        #expect(try OutboxStore(database: database).pendingCount() == 0)
        #expect(await transport.hydrateRequests.first?.memoIds == [memo.id])
    }

    @Test("删除变更：本地落墓碑而不是硬删")
    func pullAppliesDelete() async throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }

        // 先放一条本地行
        let memoID = "0199aa00-0000-7000-8000-0000000000a2"
        try RemoteApplyStore(database: database).apply(memos: [remoteMemo(id: memoID, content: "会被删")])

        let transport = FakeTransport()
        await transport.queue(
            page: SyncChangesPage(
                changes: [
                    SyncChange(seq: 9, entity: "memo", entityId: memoID, op: "delete", version: 2)
                ],
                nextSeq: 9,
                hasMore: false
            )
        )
        let engine = SyncEngine(database: database, transport: transport)
        _ = try await engine.pullOnce()

        let stored = try MemoStore(database: database, userId: "local-user").memo(id: memoID)
        #expect(stored?.status == .trashed)
        #expect(stored?.deletedAt != nil)
        #expect(try SyncStateStore(database: database).current().seq == 9)
    }

    // MARK: 推

    @Test("上送成功：outbox 行被删掉")
    func pushCompletesOutbox() async throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }

        let store = MemoStore(database: database, userId: "local-user")
        let memo = try store.create(content: "本地写的")
        let outbox = OutboxStore(database: database)
        let pending = try outbox.all()
        #expect(pending.count == 1)

        let transport = FakeTransport(
            pushResponse: PushResponse(
                results: [
                    PushResult(
                        idempotencyKey: pending[0].idempotencyKey,
                        status: "applied",
                        version: 1,
                        message: nil,
                        serverMemo: nil
                    )
                ]
            )
        )
        let engine = SyncEngine(database: database, transport: transport)
        let summary = try await engine.pushOnce()

        #expect(summary.attempted == 1)
        #expect(summary.applied == 1)
        #expect(try outbox.pendingCount() == 0)
        // 上送的客户端 id 必须是客户端生成的 UUIDv7（服务端按它幂等）
        let sent = await transport.pushRequests.first?.operations.first
        #expect(sent?.clientId == memo.id)
        #expect(sent?.op == "create")
    }

    @Test("409 冲突：服务端赢，覆盖本地并删掉 outbox 行")
    func pushConflictAppliesServerVersion() async throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }

        let store = MemoStore(database: database, userId: "local-user")
        let memo = try store.create(content: "我这边改的")
        let outbox = OutboxStore(database: database)
        let pending = try outbox.all()

        let serverVersion = remoteMemo(id: memo.id, content: "服务端已经改成这个", version: 5)
        let transport = FakeTransport(
            pushResponse: PushResponse(
                results: [
                    PushResult(
                        idempotencyKey: pending[0].idempotencyKey,
                        status: "conflict",
                        version: 5,
                        message: nil,
                        serverMemo: serverVersion
                    )
                ]
            )
        )
        let engine = SyncEngine(database: database, transport: transport)
        let summary = try await engine.pushOnce()

        #expect(summary.conflicts == 1)
        #expect(try outbox.pendingCount() == 0)
        // LWW：本地最终是服务端那一版
        let local = try store.memo(id: memo.id)
        #expect(local?.content == "服务端已经改成这个")
        #expect(local?.version == 5)
    }

    @Test("上送失败：退避重试，outbox 行不丢")
    func pushFailureBacksOff() async throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }

        _ = try MemoStore(database: database, userId: "local-user").create(content: "会失败的")
        let outbox = OutboxStore(database: database)
        let pending = try outbox.all()

        let transport = FakeTransport(
            pushResponse: PushResponse(
                results: [
                    PushResult(
                        idempotencyKey: pending[0].idempotencyKey,
                        status: "error",
                        version: nil,
                        message: "boom",
                        serverMemo: nil
                    )
                ]
            )
        )
        let engine = SyncEngine(database: database, transport: transport)
        let summary = try await engine.pushOnce()

        #expect(summary.retried == 1)
        #expect(try outbox.pendingCount() == 1)
        let retried = try #require(try outbox.all().first)
        #expect(retried.attempts == 1)
        #expect(retried.nextAttemptAt != nil)
    }

    // MARK: 一轮完整同步

    @Test("runOnce：先拉后推")
    func runOncePullsThenPushes() async throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }

        _ = try MemoStore(database: database, userId: "local-user").create(content: "本地的一条")
        let pending = try OutboxStore(database: database).all()
        let transport = FakeTransport(
            pushResponse: PushResponse(
                results: [
                    PushResult(
                        idempotencyKey: pending[0].idempotencyKey,
                        status: "applied",
                        version: 1,
                        message: nil,
                        serverMemo: nil
                    )
                ]
            )
        )
        let engine = SyncEngine(database: database, transport: transport)

        let summary = await engine.runOnce()

        #expect(summary.pullError == nil)
        #expect(summary.pushError == nil)
        #expect(summary.pull?.applied == 0)
        #expect(summary.push?.applied == 1)
        #expect(try OutboxStore(database: database).pendingCount() == 0)
    }
}
