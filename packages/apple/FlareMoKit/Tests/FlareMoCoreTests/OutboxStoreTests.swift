import Foundation
import GRDB
import Testing
@testable import FlareMoCore

/// 本文件负责：outbox 全生命周期 —— 入队、取下一批、失败退避、成功删除、
/// 依赖顺序、幂等键唯一、待发送计数观察。
@Suite("Outbox 生命周期")
struct OutboxStoreTests {
    private func makeItem(
        op: OutboxOp = .create,
        entityID: String = "memo-1",
        idempotencyKey: String = UUID().uuidString,
        dependsOn: String? = nil,
        createdAt: ISOTimestamp = TestTime.t0
    ) -> OutboxItem {
        OutboxItem(
            id: UUIDv7.generateString(),
            op: op,
            entity: .memo,
            entityId: entityID,
            payload: ["content": .string("hi")],
            idempotencyKey: idempotencyKey,
            dependsOn: dependsOn,
            createdAt: createdAt)
    }

    @Test("入队 → 取下一批 → 成功删除")
    func enqueueAndComplete() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let outbox = OutboxStore(database: database)

        let item = makeItem()
        try database.write { db in
            try OutboxStore.enqueue(item, in: db)
        }

        let batch = try outbox.nextBatch(limit: 10, now: TestTime.t0)
        #expect(batch.map(\.id) == [item.id])

        #expect(try outbox.complete(id: item.id))
        #expect(try outbox.all().isEmpty)
        #expect(try outbox.nextBatch(now: TestTime.t1).isEmpty)
        #expect(try !outbox.complete(id: item.id), "重复完成是幂等的")
    }

    @Test("失败退避：attempts+1，next_attempt_at 按 2^n 秒推后")
    func failureBackoff() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let outbox = OutboxStore(database: database)

        let item = makeItem()
        try database.write { db in
            try OutboxStore.enqueue(item, in: db)
        }

        let failed = try #require(try outbox.recordFailure(id: item.id, now: TestTime.t0))
        #expect(failed.attempts == 1)
        #expect(failed.nextAttemptAt == TestTime.t0.adding(seconds: 2))

        // 还没到重试时间：取不到。
        #expect(try outbox.nextBatch(now: TestTime.t0.adding(seconds: 1)).isEmpty)
        // 到点后可以取到。
        #expect(try outbox.nextBatch(now: TestTime.t0.adding(seconds: 2)).map(\.id) == [item.id])

        let failedAgain = try #require(
            try outbox.recordFailure(id: item.id, now: TestTime.t0.adding(seconds: 2)))
        #expect(failedAgain.attempts == 2)
        #expect(failedAgain.nextAttemptAt == TestTime.t0.adding(seconds: 2 + 4))

        // 退避上限 300s。
        #expect(OutboxStore.backoffDelay(forAttempt: 1) == 2)
        #expect(OutboxStore.backoffDelay(forAttempt: 8) == 256)
        #expect(OutboxStore.backoffDelay(forAttempt: 10) == 300)
        #expect(OutboxStore.backoffDelay(forAttempt: 100) == 300)
    }

    @Test("depends_on：依赖行还在时不可发送，依赖完成后才按序发送")
    func dependencyOrdering() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let outbox = OutboxStore(database: database)

        let memoItem = makeItem(entityID: "memo-1", createdAt: TestTime.t0)
        // 附件依赖 memo 已创建：depends_on 指向 memo 那条 outbox 行。
        let attachmentItem = makeItem(
            op: .create, entityID: "att-1", idempotencyKey: UUID().uuidString,
            dependsOn: memoItem.id, createdAt: TestTime.t1)

        try database.write { db in
            try OutboxStore.enqueue(memoItem, in: db)
            try OutboxStore.enqueue(attachmentItem, in: db)
        }

        // 依赖未完成：只能取到 memo 那条。
        #expect(try outbox.nextBatch(limit: 10, now: TestTime.t1).map(\.id) == [memoItem.id])

        #expect(try outbox.complete(id: memoItem.id))
        #expect(try outbox.nextBatch(limit: 10, now: TestTime.t1).map(\.id) == [attachmentItem.id])
    }

    @Test("按 created_at 串行；idempotency_key 唯一约束挡住重复入队")
    func serialOrderAndUniqueIdempotencyKey() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let outbox = OutboxStore(database: database)

        let first = makeItem(idempotencyKey: "same-key", createdAt: TestTime.t0)
        let second = makeItem(idempotencyKey: "other-key", createdAt: TestTime.t1)
        try database.write { db in
            try OutboxStore.enqueue(first, in: db)
            try OutboxStore.enqueue(second, in: db)
        }
        #expect(try outbox.nextBatch(limit: 10, now: TestTime.t2).map(\.id) == [first.id, second.id])

        let duplicate = makeItem(idempotencyKey: "same-key", createdAt: TestTime.t2)
        #expect(throws: DatabaseError.self) {
            try database.write { db in
                try OutboxStore.enqueue(duplicate, in: db)
            }
        }
    }

    @Test("待发送计数与观察")
    func pendingCountObservation() async throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let outbox = OutboxStore(database: database)

        var iterator = outbox.observePendingCount().values(in: database.pool).makeAsyncIterator()
        let initial = try #require(await iterator.next())
        #expect(initial == 0)

        let item = makeItem()
        try database.write { db in
            try OutboxStore.enqueue(item, in: db)
        }
        let afterEnqueue = try #require(await iterator.next())
        #expect(afterEnqueue == 1)

        _ = try outbox.complete(id: item.id)
        let afterComplete = try #require(await iterator.next())
        #expect(afterComplete == 0)
    }

    @Test("MemoStore 的写操作与实体在同一个事务里入队（一次动作一条 outbox）")
    func memoStoreWritesAreAtomicWithOutbox() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let store = MemoStore(database: database, userId: "user-1")
        let outbox = OutboxStore(database: database)

        let memo = try store.create(content: "一条", now: TestTime.t0)
        _ = try store.update(id: memo.id, content: "改过", now: TestTime.t1)
        _ = try store.softDelete(id: memo.id, now: TestTime.t2)

        #expect(try outbox.all().map(\.op) == [.create, .update, .delete])
        #expect(try outbox.all().allSatisfy { $0.entityId == memo.id })
    }
}
