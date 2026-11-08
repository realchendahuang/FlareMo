import Foundation
import GRDB

/// 本文件负责：`sync_state` 表 —— 单行同步水位（docs/native-clients.md §7.7
/// 「本地表」）。
///
/// 一个客户端实例只有一个同步状态（单用户、单写者，§7.5「单写者」），所以这张
/// 表用 `id INTEGER PRIMARY KEY CHECK (id = 1)` 钉成单行，避免「多行水位」这种
/// 不可能自洽的状态：
///
/// - `seq`：已拉取到的 `sync_changes.seq` 水位；`GET /sync/changes?since=<seq>`
///   的唯一游标（§4.4 一个整数覆盖四类实体）。
/// - `generation`：本地库的「代」。收到 410（服务端变更日志已裁剪）或本地库
///   整库重建时 +1，表示必须全量对齐；同步层用它区分「同一代内的增量」和
///   「换代后的全量」。
/// - `last_pull_at` / `last_push_at`：诊断与设置页展示用。
public struct SyncState: Codable, Sendable, Hashable,
    TableRecord, FetchableRecord, PersistableRecord
{
    public static let databaseTableName = "sync_state"
    public static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
    public static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase

    public var id: Int = 1
    public var seq: Int
    public var generation: Int
    public var lastPullAt: ISOTimestamp?
    public var lastPushAt: ISOTimestamp?

    public init(
        id: Int = 1,
        seq: Int = 0,
        generation: Int = 0,
        lastPullAt: ISOTimestamp? = nil,
        lastPushAt: ISOTimestamp? = nil
    ) {
        self.id = id
        self.seq = seq
        self.generation = generation
        self.lastPullAt = lastPullAt
        self.lastPushAt = lastPushAt
    }

    /// 从未同步过的初始状态。
    public static let initial = SyncState()
}
