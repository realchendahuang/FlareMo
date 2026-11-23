import Foundation
import GRDB
import Testing
@testable import FlareMoCore

/// 本文件负责：本地库「副本语义」的单测 —— 结构版本变化整库重建（保留 outbox
/// 与 blobs）、收到 410 后全量对齐（generation++ / seq 归零 / 清事实层）、
/// 水位只升不降。
@Suite("本地库副本与重建")
struct RebuildAndSyncStateTests {
    @Test("结构版本变化：整库重建，outbox/blobs 保留，generation+1、seq 归零")
    func rebuildPreservesOutboxAndBlobs() throws {
        let path = TestDatabase.makePath()
        try FileManager.default.createDirectory(
            at: URL(fileURLWithPath: path).deletingLastPathComponent(),
            withIntermediateDirectories: true)

        let first = try AppDatabase.open(atPath: path)
        let store = MemoStore(database: first, userId: "user-1")
        let memo = try store.create(content: "离线写的一条", now: TestTime.t0)
        let outboxBefore = try OutboxStore(database: first).all()
        #expect(outboxBefore.count == 1)

        let sha = String(repeating: "b", count: 64)
        try BlobStore(database: first).register(
            sha256: sha, bytes: 1024, mime: "image/png", now: TestTime.t0)
        try first.close()

        // 模拟 App 升级：结构版本从 1 变成 2。
        let second = try AppDatabase.open(atPath: path, schemaVersion: 2)
        defer { TestDatabase.destroy(second) }
        let store2 = MemoStore(database: second, userId: "user-1")

        // 事实层被清空（需要按新结构全量对齐）。
        #expect(try store2.memo(id: memo.id) == nil)
        #expect(try store2.list().memos.isEmpty)

        // outbox 与 blob 元数据保留（本地未上送的写不能丢）。
        let outboxAfter = try OutboxStore(database: second).all()
        #expect(outboxAfter.map(\.id) == outboxBefore.map(\.id))
        #expect(outboxAfter.first?.payload == outboxBefore.first?.payload)
        #expect(try BlobStore(database: second).blob(sha256: sha) != nil)

        // 换代标记：同步层据此走全量对齐。
        let state = try SyncStateStore(database: second).current()
        #expect(state.generation == 1)
        #expect(state.seq == 0)

        // 新库的用户版本已更新。
        let userVersion = try second.read { db in
            try Int.fetchOne(db, sql: "PRAGMA user_version") ?? -1
        }
        #expect(userVersion == 2)
    }

    @Test("收到 410：全量对齐 —— 事实层清空、outbox/blobs 保留、generation+1、seq 归零")
    func prepareFullResync() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let store = MemoStore(database: database, userId: "user-1")
        let syncState = SyncStateStore(database: database)

        let memo = try store.create(content: "会被全量重拉的一条", now: TestTime.t0)
        _ = try syncState.advanceSeq(to: 1024)
        _ = try syncState.recordPull(at: TestTime.t1)
        _ = try syncState.recordPush(at: TestTime.t2)

        let sha = String(repeating: "c", count: 64)
        try BlobStore(database: database).register(sha256: sha, bytes: 10, now: TestTime.t0)

        let before = try syncState.current()
        let state = try database.prepareFullResync()

        #expect(state.generation == before.generation + 1)
        #expect(state.seq == 0)
        #expect(state.lastPullAt == nil)
        #expect(state.lastPushAt == nil)

        // 事实层清空（含 FTS），outbox 保留。
        #expect(try store.memo(id: memo.id) == nil)
        #expect(try store.search("全量重拉").memos.isEmpty)
        #expect(try OutboxStore(database: database).pendingCount() == 1)
        #expect(try BlobStore(database: database).blob(sha256: sha) != nil)
    }

    @Test("seq 水位只升不降")
    func seqNeverGoesBackwards() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let syncState = SyncStateStore(database: database)

        _ = try syncState.advanceSeq(to: 100)
        #expect(try syncState.current().seq == 100)
        _ = try syncState.advanceSeq(to: 99)
        #expect(try syncState.current().seq == 100)
        _ = try syncState.advanceSeq(to: 101)
        #expect(try syncState.current().seq == 101)
    }

    @Test("同步状态观察：水位推进会推送给 UI")
    func syncStateObservation() async throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let syncState = SyncStateStore(database: database)

        var iterator = syncState.observe().values(in: database.pool).makeAsyncIterator()
        let initial = try #require(await iterator.next())
        #expect(initial.seq == 0)

        _ = try syncState.advanceSeq(to: 42)
        let advanced = try #require(await iterator.next())
        #expect(advanced.seq == 42)
    }

    @Test("BlobStore：staged → ready 才进入淘汰候选；LRU 按 last_used_at")
    func blobLifecycle() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let blobs = BlobStore(database: database)

        let staged = String(repeating: "d", count: 64)
        let readyOld = String(repeating: "e", count: 64)
        let readyNew = String(repeating: "f", count: 64)
        try blobs.register(sha256: staged, bytes: 1, now: TestTime.t0)
        try blobs.register(sha256: readyOld, bytes: 2, state: .ready, now: TestTime.t0)
        try blobs.register(sha256: readyNew, bytes: 4, state: .ready, now: TestTime.t1)

        #expect(try blobs.blob(sha256: staged)?.state == .staged)
        #expect(try blobs.totalBytes() == 7)

        // staged 永不淘汰；ready 里按 last_used_at 最旧优先。
        #expect(try blobs.evictionCandidates().map(\.sha256) == [readyOld, readyNew])

        try blobs.touch(sha256: readyOld, now: TestTime.t2)
        #expect(try blobs.evictionCandidates().map(\.sha256) == [readyNew, readyOld])

        try blobs.markReady(sha256: staged, remoteKey: "remote/key", now: TestTime.t3)
        #expect(try blobs.blob(sha256: staged)?.state == .ready)
        #expect(try blobs.blob(sha256: staged)?.remoteKey == "remote/key")

        #expect(try blobs.delete(sha256: staged))
        #expect(try blobs.blob(sha256: staged) == nil)
        #expect(try blobs.totalBytes() == 6)

        // 内容寻址路径：前 2 + 次 2 个字符分级。
        let blob = try #require(try blobs.blob(sha256: readyOld))
        #expect(blob.relativePath == "ee/ee/\(readyOld)")
    }
}
