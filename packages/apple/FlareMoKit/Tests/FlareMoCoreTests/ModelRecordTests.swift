import Foundation
import GRDB
import Testing
@testable import FlareMoCore

/// 本文件负责：事实层模型的 GRDB 映射单测 —— 列名 snake_case ↔ 属性 camelCase
/// 的自动转换、Codable 字段（payload/timestamps）、联合主键。
@Suite("事实层模型映射")
struct ModelRecordTests {
    @Test("Memo：完整字段往返（含 payload 未知键、embedding_*、version）")
    func memoRoundTrip() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }

        let memo = Memo(
            id: UUIDv7.generateString(),
            userId: "user-1",
            teamId: "team-1",
            content: "带 payload 的 memo",
            visibility: .protected,
            status: .archived,
            pinned: true,
            source: "web",
            clientId: "client-1",
            payload: MemoPayload(
                tags: ["工作"],
                property: MemoProperty(hasLink: true),
                clientID: "client-1",
                extras: ["durationSeconds": .double(3.5)]),
            createdAt: TestTime.t0,
            updatedAt: TestTime.t1,
            deletedAt: nil,
            embeddingStatus: .indexed,
            embeddingVersion: "v1",
            embeddedAt: TestTime.t2,
            embeddingError: nil,
            embeddingChunks: 2,
            version: 7)

        try database.write { db in
            try memo.insert(db)
        }
        let fetched = try #require(try database.read { db in try Memo.fetchOne(db, key: memo.id) })
        #expect(fetched == memo)
    }

    @Test("Attachment：r2_key / thumbnail_size / article_id 等 snake_case 列映射")
    func attachmentRoundTrip() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }

        let attachment = Attachment(
            id: UUIDv7.generateString(),
            userId: "user-1",
            memoId: "memo-1",
            articleId: "article-1",
            r2Key: "attachments/user-1/abc.png",
            filename: "截图.png",
            contentType: "image/png",
            size: 2048,
            thumbnailSize: 256,
            state: .deleting,
            clientId: "client-att-1",
            etag: "etag-1",
            payload: ["width": .int(100), "height": .int(200)],
            createdAt: TestTime.t0,
            updatedAt: TestTime.t1,
            deletedAt: TestTime.t2,
            version: 3)

        try database.write { db in
            try attachment.insert(db)
        }
        let fetched = try #require(
            try database.read { db in try Attachment.fetchOne(db, key: attachment.id) })
        #expect(fetched == attachment)
        #expect(fetched.r2Key == attachment.r2Key)
        #expect(fetched.thumbnailSize == 256)
    }

    @Test("Article：cover_attachment_id / published_at / status 映射")
    func articleRoundTrip() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }

        let article = Article(
            id: UUIDv7.generateString(),
            userId: "user-1",
            teamId: nil,
            slug: "hello-world",
            title: "标题",
            description: "描述",
            content: "# 正文",
            status: .published,
            coverAttachmentId: "att-1",
            lang: "zh-CN",
            publishedAt: TestTime.t2,
            createdAt: TestTime.t0,
            updatedAt: TestTime.t3,
            deletedAt: nil,
            version: 2)

        try database.write { db in
            try article.insert(db)
        }
        let fetched = try #require(
            try database.read { db in try Article.fetchOne(db, key: article.id) })
        #expect(fetched == article)
        #expect(fetched.coverAttachmentId == "att-1")
        #expect(fetched.status == .published)
    }

    @Test("Task：nullable project_id / source_memo_id / in_progress / priority")
    func taskRoundTrip() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }

        let task = Task(
            id: UUIDv7.generateString(),
            userId: "user-1",
            projectId: nil,
            sourceMemoId: "memo-1",
            title: "写测试",
            notes: "备注",
            status: .inProgress,
            priority: .medium,
            dueAt: TestTime.t3,
            sortOrder: 42,
            completedAt: nil,
            deletedAt: TestTime.t4,
            createdAt: TestTime.t0,
            updatedAt: TestTime.t1)

        try database.write { db in
            try task.insert(db)
        }
        let fetched = try #require(try database.read { db in try Task.fetchOne(db, key: task.id) })
        #expect(fetched == task)
        #expect(fetched.status == .inProgress)
    }

    @Test("MemoRelation：联合主键 (memo_id, related_memo_id, type)")
    func memoRelationCompositeKey() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }

        let relation = MemoRelation(
            memoId: "comment-1",
            relatedMemoId: "parent-1",
            type: .comment,
            createdAt: TestTime.t0)

        try database.write { db in
            try relation.insert(db)
        }
        let fetched = try #require(
            try database.read { db in
                try MemoRelation.fetchOne(db, sql: "SELECT * FROM memo_relations")
            })
        #expect(fetched == relation)
        // 默认 updated_at 由 D1 的 1970 默认值兜底；这里在初始化时写成 created_at，
        // 与 0049 回填后的形态一致。
        #expect(fetched.updatedAt == relation.createdAt)

        // 复合主键能正确删除（GRDB 从 schema 读取主键信息）。
        let compositeKey: [String: (any DatabaseValueConvertible)?] = [
            "memo_id": "comment-1",
            "related_memo_id": "parent-1",
            "type": "comment",
        ]
        try database.write { db in
            try MemoRelation.deleteOne(db, key: compositeKey)
        }
        let count = try database.read { db in try MemoRelation.fetchCount(db) }
        #expect(count == 0)
    }

    @Test("Blob / OutboxItem / SyncState 的列映射")
    func localTableModelsRoundTrip() throws {
        let database = try TestDatabase.make()
        defer { TestDatabase.destroy(database) }

        let blob = Blob(
            sha256: String(repeating: "a", count: 64),
            bytes: 1234,
            mime: "image/png",
            remoteKey: "blobs/aa/aa/aaa",
            state: .ready,
            lastUsedAt: TestTime.t1)
        let item = OutboxItem(
            id: UUIDv7.generateString(),
            op: .create,
            entity: .memo,
            entityId: "memo-1",
            payload: ["content": .string("hi")],
            idempotencyKey: "idem-1",
            dependsOn: nil,
            attempts: 2,
            nextAttemptAt: TestTime.t2,
            createdAt: TestTime.t0)

        try database.write { db in
            try blob.insert(db)
            try OutboxStore.enqueue(item, in: db)
        }
        let fetchedBlob = try #require(try database.read { db in try Blob.fetchOne(db, key: blob.sha256) })
        #expect(fetchedBlob == blob)

        let fetchedItem = try #require(try database.read { db in try OutboxItem.fetchOne(db) })
        #expect(fetchedItem.payload == item.payload)
        #expect(fetchedItem.attempts == 2)
        #expect(fetchedItem.nextAttemptAt == TestTime.t2)

        let state = try database.read { db in try SyncState.fetchOne(db, key: 1) }
        #expect(state?.generation == 0)
    }
}
