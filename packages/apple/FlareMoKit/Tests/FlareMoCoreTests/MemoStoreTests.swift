import Foundation
import GRDB
import Testing
@testable import FlareMoCore

/// 本文件负责：`MemoStore` 的单测 —— CRUD 往返、列表分页、软删/恢复/置顶、
/// 中文两字搜索降级 LIKE、FTS 命中、评论排除、ValueObservation 刷新。
@Suite("MemoStore")
struct MemoStoreTests {
    @Test("新建 → 读取往返：UUIDv7 id、时间、version、payload、outbox 入队")
    func createAndFetch() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let store = MemoStore(database: database, userId: "user-1")

        let memo = try store.create(
            content: "  今天的第一条速记  ",
            payload: MemoPayload(tags: ["速记"]),
            visibility: .private,
            now: TestTime.t0)

        #expect(memo.id.count == 36)
        #expect(memo.userId == "user-1")
        #expect(memo.content == "今天的第一条速记", "内容应被 trim（对齐服务端 createMemoSchema）")
        #expect(memo.status == .normal)
        #expect(memo.pinned == false)
        #expect(memo.version == 1)
        #expect(memo.createdAt == TestTime.t0)
        #expect(memo.updatedAt == TestTime.t0)
        #expect(memo.clientId == memo.id, "本地 id 即 client_id，服务端据此幂等")
        #expect(memo.payload.tags == ["速记"])
        #expect(memo.payload.clientID == memo.id)

        let fetched = try store.memo(id: memo.id)
        #expect(fetched == memo)

        let outbox = try OutboxStore(database: database).all()
        #expect(outbox.count == 1)
        #expect(outbox.first?.op == .create)
        #expect(outbox.first?.entity == .memo)
        #expect(outbox.first?.entityId == memo.id)
        #expect(outbox.first?.idempotencyKey == memo.id)
    }

    @Test("空内容/超长内容被拒绝（对齐服务端契约）")
    func rejectsInvalidContent() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let store = MemoStore(database: database, userId: "user-1")

        #expect(throws: MemoStoreError.emptyContent) {
            try store.create(content: "   \n\t  ", now: TestTime.t0)
        }
        #expect(throws: MemoStoreError.contentTooLong(100_001)) {
            try store.create(content: String(repeating: "字", count: 100_001), now: TestTime.t0)
        }
        #expect(try OutboxStore(database: database).pendingCount() == 0, "校验失败不能留下 outbox")
    }

    @Test("更新：version+1、updated_at 前移、outbox 记录 expected_version")
    func updateBumpsVersion() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let store = MemoStore(database: database, userId: "user-1")
        let created = try store.create(content: "原始内容", now: TestTime.t0)

        let updated = try store.update(
            id: created.id,
            content: "改过的内容",
            payload: MemoPayload(tags: ["新标签"]),
            now: TestTime.t1)

        #expect(updated.version == created.version + 1)
        #expect(updated.content == "改过的内容")
        #expect(updated.updatedAt == TestTime.t1)
        #expect(updated.createdAt == created.createdAt)
        #expect(updated.payload.tags == ["新标签"])

        let outbox = try OutboxStore(database: database).all()
        #expect(outbox.count == 2)
        let updateItem = try #require(outbox.last)
        #expect(updateItem.op == .update)
        #expect(updateItem.payload == [
            "content": .string("改过的内容"),
            "payload": .object(["tags": .array([.string("新标签")])]),
            "expected_version": .int(1),
        ])
    }

    @Test("置顶 / 取消置顶")
    func setPinned() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let store = MemoStore(database: database, userId: "user-1")
        let memo = try store.create(content: "要置顶的一条", now: TestTime.t0)

        let pinned = try store.setPinned(id: memo.id, isPinned: true, now: TestTime.t1)
        #expect(pinned.pinned)
        #expect(pinned.version == 2)

        let unpinned = try store.setPinned(id: memo.id, isPinned: false, now: TestTime.t2)
        #expect(!unpinned.pinned)
        #expect(unpinned.version == 3)
    }

    @Test("软删 → 回收站 → 恢复")
    func softDeleteAndRestore() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let store = MemoStore(database: database, userId: "user-1")
        let memo = try store.create(content: "会被删掉的一条", now: TestTime.t0)

        let trashed = try store.softDelete(id: memo.id, now: TestTime.t1)
        #expect(trashed.status == .trashed)
        #expect(trashed.deletedAt == TestTime.t1)
        #expect(trashed.version == 2)
        #expect(try store.list(scope: .timeline).memos.isEmpty)
        #expect(try store.list(scope: .trash).memos.map(\.id) == [memo.id])

        // 软删是 tombstone：查得到，但不在时间线。
        #expect(try store.memo(id: memo.id)?.isTrashed == true)

        let restored = try store.restore(id: memo.id, now: TestTime.t2)
        #expect(restored.status == .normal)
        #expect(restored.deletedAt == nil)
        #expect(restored.version == 3)
        #expect(try store.list(scope: .timeline).memos.map(\.id) == [memo.id])

        // 幂等：重复删/恢复不重复入队。
        let outboxBefore = try OutboxStore(database: database).pendingCount()
        _ = try store.restore(id: memo.id, now: TestTime.t3)
        #expect(try OutboxStore(database: database).pendingCount() == outboxBefore)
    }

    @Test("列表排序：置顶优先，然后 created_at DESC / id DESC")
    func listOrdering() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let store = MemoStore(database: database, userId: "user-1")

        let first = try store.create(content: "第一条", now: TestTime.t0)
        let second = try store.create(content: "第二条", now: TestTime.t1)
        let third = try store.create(content: "第三条", now: TestTime.t2)
        _ = try store.setPinned(id: first.id, isPinned: true, now: TestTime.t3)

        let page = try store.list(limit: 10)
        #expect(page.memos.map(\.id) == [first.id, third.id, second.id])
        #expect(page.nextCursor == nil)
    }

    @Test("列表分页：keyset 游标逐页取完且不重复")
    func pagination() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let store = MemoStore(database: database, userId: "user-1")

        var createdIDs: [String] = []
        for index in 0..<5 {
            let memo = try store.create(
                content: "第 \(index) 条", now: TestTime.t0.adding(seconds: Double(index)))
            createdIDs.append(memo.id)
        }

        var seen: [String] = []
        var cursor: MemoPageCursor?
        var pages = 0
        repeat {
            let page = try store.list(limit: 2, after: cursor)
            seen.append(contentsOf: page.memos.map(\.id))
            cursor = page.nextCursor
            pages += 1
            #expect(pages <= 5, "分页不应死循环")
        } while cursor != nil

        #expect(seen == createdIDs.reversed(), "整体顺序 = created_at DESC")
        #expect(Set(seen).count == 5)

        // 第 2 页起点正好是上一页最后一条之后的元素。
        let firstPage = try store.list(limit: 2)
        let secondPage = try store.list(limit: 2, after: firstPage.nextCursor)
        #expect(secondPage.memos.count == 2)
        #expect(Set(firstPage.memos.map(\.id)).isDisjoint(with: Set(secondPage.memos.map(\.id))))
    }

    @Test("搜索：英文 ≥3 字符走 FTS trigram")
    func searchUsesFTS() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let store = MemoStore(database: database, userId: "user-1")

        let memo = try store.create(content: "hello world apple", now: TestTime.t0)
        _ = try store.create(content: "完全不相干的内容", now: TestTime.t1)

        #expect(try store.search("apple").memos.map(\.id) == [memo.id])
        #expect(try store.search("ell").memos.map(\.id) == [memo.id], "trigram 子串命中")
        #expect(try store.search("zzz").memos.isEmpty)
    }

    @Test("搜索：中文两字降级 LIKE（M1 验收项）")
    func searchCJKTwoCharactersFallsBackToLike() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let store = MemoStore(database: database, userId: "user-1")

        let memo = try store.create(content: "今天写了中文笔记，分享给团队", now: TestTime.t0)
        _ = try store.create(content: "今天开会", now: TestTime.t1)

        // 2 个汉字：trigram 无法召回，必须由 LIKE 兜底。
        #expect(try store.search("笔记").memos.map(\.id) == [memo.id])
        #expect(try store.search("中文").memos.map(\.id) == [memo.id])
        // 3 个汉字走 FTS trigram。
        #expect(try store.search("中文笔").memos.map(\.id) == [memo.id])
        // 混排：两个短词各自 AND。
        #expect(try store.search("笔记 团队").memos.map(\.id) == [memo.id])
        #expect(try store.search("笔记 不存在").memos.isEmpty)
    }

    @Test("搜索：LIKE 通配符被转义，不会全表命中")
    func searchEscapesLikeWildcards() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let store = MemoStore(database: database, userId: "user-1")

        _ = try store.create(content: "100% 完成", now: TestTime.t0)
        _ = try store.create(content: "1000 完成", now: TestTime.t1)

        #expect(try store.search("100%").memos.count == 1)
        #expect(try store.search("00%").memos.count == 1)
    }

    @Test("搜索：范围/操作符（in:trash、is:pinned、has:attachment、before/after）")
    func searchOperators() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let store = MemoStore(database: database, userId: "user-1")

        let pinned = try store.create(content: "置顶的笔记", now: TestTime.t0)
        _ = try store.setPinned(id: pinned.id, isPinned: true, now: TestTime.t0)
        let normal = try store.create(content: "普通的笔记", now: TestTime.t1)
        let trashed = try store.create(content: "回收站的笔记", now: TestTime.t2)
        _ = try store.softDelete(id: trashed.id, now: TestTime.t2)

        // is:pinned
        #expect(try store.search("is:pinned 笔记").memos.map(\.id) == [pinned.id])
        // 默认搜索范围 = 时间线 + 归档（不含回收站）
        #expect(try store.search("笔记").memos.map(\.id) == [pinned.id, normal.id])
        // in:trash
        #expect(try store.search("in:trash 笔记").memos.map(\.id) == [trashed.id])
        // before/after（UTC 创建日期）
        #expect(try store.search("after:2026-11-08 before:2026-11-09 笔记").memos.count == 2)
        #expect(try store.search("after:2026-11-09 笔记").memos.isEmpty)

        // has:attachment：只命中真的有 ready 附件的 memo
        let attachment = Attachment(
            id: UUIDv7.generateString(),
            userId: "user-1",
            memoId: normal.id,
            r2Key: "attachments/u/a.png",
            filename: "a.png",
            size: 10,
            state: .ready,
            createdAt: TestTime.t1,
            updatedAt: TestTime.t1)
        try database.write { db in
            try attachment.insert(db)
        }
        #expect(try store.search("has:attachment").memos.map(\.id) == [normal.id])
    }

    @Test("评论不是时间线条目：列表/搜索排除，comments(for:) 可读")
    func commentsAreExcludedFromTimeline() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let store = MemoStore(database: database, userId: "user-1")

        let parent = try store.create(content: "父记录内容", now: TestTime.t0)
        let comment = try store.create(content: "这是一条评论", now: TestTime.t1)
        try database.write { db in
            let relation = MemoRelation(
                memoId: comment.id, relatedMemoId: parent.id, type: .comment,
                createdAt: TestTime.t1)
            try relation.insert(db)
        }

        #expect(try store.list().memos.map(\.id) == [parent.id])
        #expect(try store.count() == 1)
        #expect(try store.search("评论").memos.isEmpty)

        let comments = try store.comments(for: parent.id)
        #expect(comments.map(\.id) == [comment.id])
    }

    @Test("ValueObservation：列表随写入自动刷新")
    func observationDeliversUpdates() async throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let store = MemoStore(database: database, userId: "user-1")

        var iterator = store.observeList(limit: 10).values(in: database.pool).makeAsyncIterator()
        let initial = try #require(await iterator.next())
        #expect(initial.isEmpty)

        let memo = try store.create(content: "观察到的第一条", now: TestTime.t0)
        let afterCreate = try #require(await iterator.next())
        #expect(afterCreate.map(\.id) == [memo.id])

        _ = try store.softDelete(id: memo.id, now: TestTime.t1)
        let afterDelete = try #require(await iterator.next())
        #expect(afterDelete.isEmpty)
    }

    @Test("ValueObservation：单条 memo 随更新刷新，删除后变 nil")
    func observationOfSingleMemo() async throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }
        let store = MemoStore(database: database, userId: "user-1")
        let memo = try store.create(content: "第一版", now: TestTime.t0)

        var iterator = store.observeMemo(id: memo.id).values(in: database.pool).makeAsyncIterator()
        let initial = try #require(await iterator.next())
        #expect(initial?.content == "第一版")

        _ = try store.update(id: memo.id, content: "第二版", now: TestTime.t1)
        let updated = try #require(await iterator.next())
        #expect(updated?.content == "第二版")

        try database.write { db in
            try Memo.deleteOne(db, key: memo.id)
        }
        let deleted = try #require(await iterator.next())
        #expect(deleted == nil)
    }
}
