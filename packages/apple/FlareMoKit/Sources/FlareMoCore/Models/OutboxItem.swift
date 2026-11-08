import Foundation
import GRDB

/// 本文件负责：`outbox` 表 —— 本地待上送操作队列（docs/native-clients.md §7.7
/// 「写入路径」）。
///
/// 列集合是文档硬约束，一个不能少：
/// `id`、`op`、`entity`、`entity_id`、`payload`、`idempotency_key`、
/// `depends_on`、`attempts`、`next_attempt_at`、`created_at`。
///
/// 生命周期：
/// 1. 用户在本地事务里写实体 + 写 outbox（同一事务，UI 立刻可见）；
/// 2. 单写者循环按 `created_at, id` 串行取出待发送行；
/// 3. 成功 → 删除该行；失败 → `attempts += 1`、按指数退避写
///    `next_attempt_at`；409 冲突由同步层拉最新后删行（LWW）。
///
/// `depends_on` 表达「这条依赖另一条先成功」：附件依赖 memo 已创建、评论依赖
/// 父记录已创建。本层用**依赖行是否还存在**判断依赖是否满足（成功即删行），
/// 这样不额外发明状态列（§7.7 的列清单是固定的）。
///
/// `idempotency_key`：每次上送重试都带同一个键，服务端据此去重；创建 memo 时
/// 与 `client_id`（= 本地 memo id）相同。
public struct OutboxItem: Codable, Sendable, Hashable, Identifiable,
    TableRecord, FetchableRecord, PersistableRecord
{
    public static let databaseTableName = "outbox"
    public static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    public static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase

    /// 本地生成的 UUIDv7 字符串。
    public var id: String
    /// 用户动作类型：新建 / 更新 / 删除。
    public var op: OutboxOp
    /// 目标实体；取值与 `sync_changes.entity` 一致。
    public var entity: OutboxEntity
    public var entityId: String
    /// 上送请求体（JSON 对象）。写操作的具体字段都放这里，本层不解析。
    ///
    /// 类型是 `[String: JSONValue]` 而不是 `JSONValue`：GRDB 解码 Codable 属性时
    /// 会先试「单值列」（SQLite 把 text 强转成 0），只有请求 keyed container 的
    /// 类型才会回落到 JSON 解码；Dictionary 的 Codable 正好先请求 keyed container，
    /// 所以能正确读到 JSON 文本（详见 `JSONValue` 的注释）。
    public var payload: [String: JSONValue]
    public var idempotencyKey: String
    /// 依赖的另一条 outbox 行的 id；nil 表示无依赖。
    public var dependsOn: String?
    public var attempts: Int
    /// 退避后的最早重试时间；nil 表示立即可发送。
    public var nextAttemptAt: ISOTimestamp?
    public var createdAt: ISOTimestamp

    public init(
        id: String,
        op: OutboxOp,
        entity: OutboxEntity,
        entityId: String,
        payload: [String: JSONValue] = [:],
        idempotencyKey: String,
        dependsOn: String? = nil,
        attempts: Int = 0,
        nextAttemptAt: ISOTimestamp? = nil,
        createdAt: ISOTimestamp
    ) {
        self.id = id
        self.op = op
        self.entity = entity
        self.entityId = entityId
        self.payload = payload
        self.idempotencyKey = idempotencyKey
        self.dependsOn = dependsOn
        self.attempts = attempts
        self.nextAttemptAt = nextAttemptAt
        self.createdAt = createdAt
    }
}

/// outbox 操作类型。
///
/// 与服务端同步契约的对应关系（§4.4）：
/// - `create` → `POST /api/app/memos`（幂等键 = `client_id`）
/// - `update` → `PATCH /api/app/memos/:id`（payload 里带 `expected_version`）
/// - `delete` → 软删：更新为 `status='trashed'` + `deleted_at`（服务端同样用
///   PATCH 表达回收站；payload 里也带 `expected_version`）
public enum OutboxOp: String, Codable, Sendable, Hashable, CaseIterable {
    case create
    case update
    case delete
}

/// outbox 目标实体；取值与 `sync_changes.entity` 的四个类型一致
/// （`packages/db/src/schema` 迁移 0048 的注释）。
public enum OutboxEntity: String, Codable, Sendable, Hashable, CaseIterable {
    case memo
    case attachment
    case article
    case relation
}

extension OutboxOp: DatabaseValueConvertible {
    public var databaseValue: DatabaseValue { rawValue.databaseValue }
    public static func fromDatabaseValue(_ dbValue: DatabaseValue) -> OutboxOp? {
        String.fromDatabaseValue(dbValue).flatMap(OutboxOp.init(rawValue:))
    }
}

extension OutboxEntity: DatabaseValueConvertible {
    public var databaseValue: DatabaseValue { rawValue.databaseValue }
    public static func fromDatabaseValue(_ dbValue: DatabaseValue) -> OutboxEntity? {
        String.fromDatabaseValue(dbValue).flatMap(OutboxEntity.init(rawValue:))
    }
}
