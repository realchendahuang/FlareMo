import Foundation

/// 服务端增量同步契约（docs/native-clients.md §4.4）。
///
/// 这一层的 DTO 与 `/api/app/sync/*` 的响应一一对应。字段名不用手写映射：
/// 后端约定用驼峰，这里统一 `convertFromSnakeCase` / `convertToSnakeCase` 兼容两边写法。
public struct SyncChange: Codable, Sendable, Hashable {
    /// 全局单调递增游标。客户端只存一个整数水位。
    public var seq: Int
    /// memo / attachment / article / relation
    public var entity: String
    public var entityId: String
    /// upsert / delete
    public var op: String
    public var version: Int
}

/// `GET /api/app/sync/changes?since=`
public struct SyncChangesPage: Codable, Sendable, Hashable {
    public var changes: [SyncChange]
    /// 线上字段是 `next_seq`。`convertFromSnakeCase` 只把 `next_seq` 解成 `nextSeq`，
    /// 所以属性名必须跟线格式同形——叫 `nextSince` 会解不出来。
    public var nextSeq: Int
    public var hasMore: Bool
}

/// 服务端返回的 memo 正文（`POST /api/app/sync/hydrate`）。
///
/// 只列本地库真正要用的列；embedding_* 这些派生列不参与同步。
public struct RemoteMemo: Codable, Sendable, Hashable {
    public var id: String
    public var userId: String
    public var teamId: String?
    public var content: String
    public var visibility: String
    public var status: String
    public var pinned: Bool
    public var source: String
    public var clientId: String?
    public var payload: MemoPayload
    public var createdAt: String
    public var updatedAt: String
    public var deletedAt: String?
    public var version: Int
}

/// `POST /api/app/sync/hydrate` 的请求体。
public struct HydrateRequest: Codable, Sendable {
    public var memoIds: [String]
    public var attachmentIds: [String]
    public var articleIds: [String]
    /// 关系行没有正文，但它自己就是正文（memo_id / related_memo_id / type），单列一类。
    public var relationIds: [String]

    public init(
        memoIds: [String] = [],
        attachmentIds: [String] = [],
        articleIds: [String] = [],
        relationIds: [String] = []
    ) {
        self.memoIds = memoIds
        self.attachmentIds = attachmentIds
        self.articleIds = articleIds
        self.relationIds = relationIds
    }
}

/// `POST /api/app/sync/hydrate` 的响应体。
public struct HydrateResponse: Codable, Sendable {
    public var memos: [RemoteMemo]
    public var attachments: [RemoteAttachment]
    public var articles: [RemoteArticle]
    public var relations: [RemoteRelation]

    public init(
        memos: [RemoteMemo] = [],
        attachments: [RemoteAttachment] = [],
        articles: [RemoteArticle] = [],
        relations: [RemoteRelation] = []
    ) {
        self.memos = memos
        self.attachments = attachments
        self.articles = articles
        self.relations = relations
    }
}

/// 关系行（评论、引用等）。服务端没有独立的 comments 表：
/// 评论是完整 memo 行 + `memo_relations(type='comment')`。这里给的是这条关系本身。
public struct RemoteRelation: Codable, Sendable, Hashable {
    public var id: String
    public var memoId: String
    public var relatedMemoId: String
    public var type: String
    public var createdAt: String
    public var updatedAt: String
    public var version: Int
}

/// 附件元数据（二进制本身走 S3 兼容直传，不经过 hydrate）。
public struct RemoteAttachment: Codable, Sendable, Hashable {
    public var id: String
    public var userId: String?
    public var memoId: String?
    public var articleId: String?
    public var r2Key: String
    public var filename: String?
    /// 字节数。服务端字段名是 `size`（不是 `bytes`）。
    public var size: Int
    /// MIME 类型。**服务端的列名是 `content_type`，没有 `mime` 这一列**——
    /// 线格式以真实响应为准，写 `mime` 会直接解码失败。
    public var contentType: String
    public var thumbnailSize: Int?
    public var state: String
    public var clientId: String?
    public var etag: String?
    public var createdAt: String
    public var updatedAt: String
    public var deletedAt: String?
    public var version: Int
}

/// 文章（分享 / 长文）。
public struct RemoteArticle: Codable, Sendable, Hashable {
    public var id: String
    public var userId: String
    public var slug: String?
    public var title: String
    public var content: String
    public var status: String
    public var createdAt: String
    public var updatedAt: String
    public var deletedAt: String?
    public var version: Int
}

// MARK: - 上送

/// 一条待上送操作。由 outbox 行映射而来。
public struct PushOperation: Codable, Sendable {
    public var idempotencyKey: String
    /// create / update / delete
    public var op: String
    /// memo / attachment / article / relation
    public var entity: String
    public var entityId: String
    /// 客户端生成的 UUIDv7；服务端按它做幂等（§7.7 全局约定 1）
    public var clientId: String?
    /// 乐观锁：服务端当前版本 +1 才接受
    public var expectedVersion: Int?
    public var payload: [String: JSONValue]
}

public struct PushRequest: Codable, Sendable {
    public var operations: [PushOperation]
}

/// 单条上送结果。
public struct PushResult: Codable, Sendable {
    public var idempotencyKey: String
    /// applied / conflict / error / duplicate
    public var status: String
    /// 服务端当前版本（conflict 时用于 LWW 覆盖）
    public var version: Int?
    public var message: String?
    /// 冲突时服务端返回的最新正文；客户端据它覆盖本地（§4.5 LWW）
    public var serverMemo: RemoteMemo?
}

public struct PushResponse: Codable, Sendable {
    public var results: [PushResult]
}

// MARK: - 能力发现

/// `GET /api/app/instance`
///
/// `capabilities` 是**带版本号的对象**（§4.6），不是字符串数组：
/// `{"sync_changes": 1, "native_push": ["apns", "fcm"], ...}`。
/// 值的类型不统一（数字 / 数组 / 布尔），所以用 `[String: JSONValue]` 保留原始形状，
/// 再按能力名取值。缺能力不阻塞启动，只是降级（§7.6）。
public struct InstanceCapabilities: Codable, Sendable, Hashable {
    public var version: String?
    public var capabilities: [String: JSONValue]

    /// 实例是否声明了某个能力。
    public func supports(_ name: String) -> Bool {
        capabilities[name] != nil
    }

    /// 能力版本号（比如 `sync_changes` 的 1）；没有该能力返回 nil。
    public func version(of name: String) -> Int? {
        guard case let .int(value) = capabilities[name] else { return nil }
        return value
    }
}
