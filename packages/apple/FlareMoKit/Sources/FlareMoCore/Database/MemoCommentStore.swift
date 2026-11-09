import Foundation
import GRDB

/// 评论的写入路径。
///
/// 服务端**没有独立的 comments 表**：一条评论就是一条完整的 `memos` 行，
/// 加上一条 `memo_relations(memo_id=评论, related_memo_id=父, type='comment')`。
/// 所以这里一次事务里要做三件事：写评论行、写关系、写两条 outbox（create memo + create relation）。
///
/// 单独成文件而不是塞进 `MemoStore`：`MemoStore` 的写路径都是「一条实体 + 一条 outbox」，
/// 评论是唯一需要两个实体配对写入的特例，混在一起会让那个类的职责变糊。
public struct MemoCommentStore: Sendable {
    public let database: AppDatabase
    /// 当前用户的 `users.id`（本地库是当前用户可见的副本，写时仍要填作者）。
    public let userId: String

    public init(database: AppDatabase, userId: String) {
        self.database = database
        self.userId = userId
    }

    /// 给 `memoID` 加一条评论，返回评论本身（它也是一条 memo）。
    @discardableResult
    public func createComment(
        memoID: String,
        content: String,
        now: ISOTimestamp = .now()
    ) throws -> Memo {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw MemoStoreError.emptyContent }
        guard trimmed.count <= MemoStore.maxContentLength else {
            throw MemoStoreError.contentTooLong(trimmed.count)
        }

        let commentID = UUIDv7.generateString()
        let nowString = now.string

        try database.write { db in
            // 父记录必须存在，否则会写出一条孤儿评论。
            guard try Memo.fetchOne(db, key: memoID) != nil else {
                throw MemoStoreError.memoNotFound(memoID)
            }

            let comment = Memo(
                id: commentID,
                userId: userId,
                teamId: nil,
                content: trimmed,
                visibility: .private,
                status: .normal,
                pinned: false,
                source: MemoStore.defaultSource,
                clientId: commentID,
                payload: .empty,
                createdAt: now,
                updatedAt: now,
                version: 1
            )
            try comment.insert(db)

            let relation = MemoRelation(
                memoId: commentID,
                relatedMemoId: memoID,
                type: .comment,
                createdAt: now,
                updatedAt: now
            )
            try relation.insert(db)

            // 两条 outbox：先建评论、再建关系；关系依赖评论先落地。
            let commentOutboxID = UUIDv7.generateString()
            try OutboxItem(
                id: commentOutboxID,
                op: .create,
                entity: .memo,
                entityId: commentID,
                payload: [
                    "id": .string(commentID),
                    "content": .string(trimmed),
                    "visibility": .string("private"),
                    "source": .string(MemoStore.defaultSource),
                    "client_id": .string(commentID),
                    "created_at": .string(nowString),
                    "updated_at": .string(nowString),
                ],
                idempotencyKey: commentID,
                dependsOn: nil,
                attempts: 0,
                nextAttemptAt: nil,
                createdAt: now
            ).insert(db)

            try OutboxItem(
                id: UUIDv7.generateString(),
                op: .create,
                entity: .relation,
                entityId: commentID,
                payload: [
                    "memo_id": .string(commentID),
                    "related_memo_id": .string(memoID),
                    "type": .string("comment"),
                    "created_at": .string(nowString),
                ],
                idempotencyKey: "\(commentID):relation",
                dependsOn: commentOutboxID,
                attempts: 0,
                nextAttemptAt: nil,
                createdAt: now
            ).insert(db)
        }

        guard let created = try database.read({ db in try Memo.fetchOne(db, key: commentID) }) else {
            throw MemoStoreError.memoNotFound(commentID)
        }
        return created
    }
}
