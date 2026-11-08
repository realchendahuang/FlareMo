import Foundation
import GRDB

/// 本文件负责：`tasks` 表的事实层模型。
///
/// 列对齐 `packages/db/src/schema/tasks.ts` + 迁移 0025：
/// - `project_id` 可为 NULL（未归项目的任务），注意迁移 0025 把原来的 NOT NULL
///   放宽成了可空；本地按最终形态建表。
/// - `source_memo_id` 故意没有外键（memo 硬删不能级联掉任务）。
/// - `deleted_at` 是回收站标记（delete 写时间、restore 清空、cron 到期硬删）。
///
/// ⚠️ 命名提醒：本类型名 `Task` 会遮蔽 Swift 并发库的 `_Concurrency.Task`。
/// 在本模块（或其下游）里要用并发任务时，请写 `_Concurrency.Task { ... }`。
/// 保留这个名字是为了和 `packages/db` 的领域命名一致。
public struct Task: Codable, Sendable, Hashable, Identifiable,
    TableRecord, FetchableRecord, PersistableRecord
{
    public static let databaseTableName = "tasks"
    public static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    public static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase

    public var id: String
    public var userId: String
    public var projectId: String?
    public var sourceMemoId: String?
    public var title: String
    public var notes: String?
    public var status: TaskStatus
    public var priority: TaskPriority
    public var dueAt: ISOTimestamp?
    public var sortOrder: Int
    public var completedAt: ISOTimestamp?
    public var deletedAt: ISOTimestamp?
    public var createdAt: ISOTimestamp
    public var updatedAt: ISOTimestamp

    public init(
        id: String,
        userId: String,
        projectId: String? = nil,
        sourceMemoId: String? = nil,
        title: String,
        notes: String? = nil,
        status: TaskStatus = .todo,
        priority: TaskPriority = .none,
        dueAt: ISOTimestamp? = nil,
        sortOrder: Int = 0,
        completedAt: ISOTimestamp? = nil,
        deletedAt: ISOTimestamp? = nil,
        createdAt: ISOTimestamp,
        updatedAt: ISOTimestamp
    ) {
        self.id = id
        self.userId = userId
        self.projectId = projectId
        self.sourceMemoId = sourceMemoId
        self.title = title
        self.notes = notes
        self.status = status
        self.priority = priority
        self.dueAt = dueAt
        self.sortOrder = sortOrder
        self.completedAt = completedAt
        self.deletedAt = deletedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// D1 `tasks.status`。
public enum TaskStatus: String, Codable, Sendable, Hashable, CaseIterable {
    case todo
    case inProgress = "in_progress"
    case done
}

/// D1 `tasks.priority`。
public enum TaskPriority: String, Codable, Sendable, Hashable, CaseIterable {
    case none
    case low
    case medium
    case high
}

extension TaskStatus: DatabaseValueConvertible {
    public var databaseValue: DatabaseValue { rawValue.databaseValue }
    public static func fromDatabaseValue(_ dbValue: DatabaseValue) -> TaskStatus? {
        String.fromDatabaseValue(dbValue).flatMap(TaskStatus.init(rawValue:))
    }
}

extension TaskPriority: DatabaseValueConvertible {
    public var databaseValue: DatabaseValue { rawValue.databaseValue }
    public static func fromDatabaseValue(_ dbValue: DatabaseValue) -> TaskPriority? {
        String.fromDatabaseValue(dbValue).flatMap(TaskPriority.init(rawValue:))
    }
}
