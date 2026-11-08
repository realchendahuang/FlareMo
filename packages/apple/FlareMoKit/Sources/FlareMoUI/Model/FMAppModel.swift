import FlareMoCore
import FlareMoDesign
import Foundation
import GRDB
import Observation

// 注意：`FlareMoCore` 里有个 `struct Task`（服务端 tasks 表），会遮蔽
// `_Concurrency.Task`。这个文件里凡是要起异步任务都必须写 `_Concurrency.Task`。
import SwiftUI

/// App 级数据模型：本地库 → 界面。
///
/// 这一层是 §7.7 那条原则的唯一实现点：**本地 SQLite 是事实源，UI 只是它的响应式视图**。
/// 所以这里没有"加载中"状态、没有网络请求——打开即读本地库，写就是写本地库，
/// 同步是另一条链路（`FlareMoCore/Sync`，M0 之后接）。
///
/// 用 `@Observable` 而不是 `ObservableObject`：SwiftUI 只重算真正读了变化字段的视图，
/// 长列表的刷新成本差别很大。
@MainActor
@Observable
public final class FMAppModel {
    /// 时间线当前展示的速记（已映射成展示模型）。
    public private(set) var memos: [MemoPresentation] = []
    /// 侧栏统计。
    public private(set) var stats: FMSidebarStats = .placeholder
    /// 侧栏标签（按出现次数排序）。
    public private(set) var tags: [String] = []
    /// 待上送的操作数（离线时也会涨，用来在界面上表达"还没同步出去"）。
    public private(set) var pendingOutboxCount = 0
    /// 打开本地库失败时的原因。非 nil 时界面显示错误态而不是空列表——
    /// 空列表会让人以为数据丢了。
    public private(set) var openFailure: String?

    private let database: AppDatabase?
    private let memoStore: MemoStore?
    private let isPreview: Bool

    /// 实例连接与同步。界面只读它的状态；它自己管 Keychain 与后台循环。
    public let sync: FMSyncCoordinator
    private var listObservation: AnyDatabaseCancellable?
    private var outboxObservation: AnyDatabaseCancellable?

    /// 列表一次取多少条。v1 不分页（§7.7 的 keyset 游标留给滚动加载）。
    private static let pageSize = 200

    /// 预览、快照测试与 `flaremo-preview --window` 用：不碰磁盘，
    /// 直接吃一组展示模型（新建的速记只留在内存里）。
    public init(previewMemos: [MemoPresentation], stats: FMSidebarStats, tags: [String]) {
        self.database = nil
        self.memoStore = nil
        self.isPreview = true
        self.memos = previewMemos
        self.stats = stats
        self.tags = tags
        self.sync = FMSyncCoordinator(database: nil)
    }

    /// - Parameter databaseDirectory: 指定本地库目录（测试注入临时目录用）；
    ///   传 nil 用 Application Support 下的默认位置。
    public init(databaseDirectory: URL? = nil) {
        do {
            let directory = try databaseDirectory ?? Self.applicationSupportDirectory()
            let database = try AppDatabase.open(inDirectory: directory)
            self.database = database
            // v1 是单用户 bootstrap；多用户时这里换成登录返回的 uid。
            let store = MemoStore(database: database, userId: Self.localUserId)
            self.memoStore = store
            self.isPreview = false
            self.sync = FMSyncCoordinator(database: database)
            startObserving(store: store)
            // 首帧不等观测回调：直接读一次。ValueObservation 的首个值会走异步回调，
            // 否则打开 App 的第一帧是空列表（能看到闪一下）。
            refresh()
        } catch {
            self.database = nil
            self.memoStore = nil
            self.isPreview = false
            self.sync = FMSyncCoordinator(database: nil)
            self.openFailure = String(describing: error)
        }
    }

    // MARK: - 写入

    /// 新建一条速记。写入是同步的（SQLite 本地写很快），UI 立刻能看到——
    /// 这正是「写完就合盖」也丢不了的前提（`synchronous=FULL`）。
    @discardableResult
    public func createMemo(content: String) -> Bool {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        guard let memoStore else {
            // 预览模式：只落内存，让演示窗口能真的"写进去"看到效果。
            guard isPreview else { return false }
            memos.insert(
                MemoPresentation(id: UUID().uuidString, content: trimmed, createdAt: .now),
                at: 0
            )
            return true
        }
        do {
            try memoStore.create(content: trimmed)
            return true
        } catch {
            openFailure = String(describing: error)
            return false
        }
    }

    public func setPinned(_ memoID: String, pinned: Bool) {
        guard let memoStore else { return }
        do {
            try memoStore.setPinned(id: memoID, isPinned: pinned)
        } catch {
            openFailure = String(describing: error)
        }
    }

    public func deleteMemo(_ memoID: String) {
        guard let memoStore else { return }
        do {
            try memoStore.softDelete(id: memoID)
        } catch {
            openFailure = String(describing: error)
        }
    }

    // MARK: - 观察

    private func startObserving(store: MemoStore) {
        guard let database else { return }

        // 列表：一次订阅，库里任何写入（包括将来的同步落库）都会自动推上来。
        let listObservation = store.observeList(scope: .timeline, limit: Self.pageSize)
        self.listObservation = listObservation.start(
            in: database.pool,
            scheduling: .immediate,
            onError: { [weak self] error in
                _Concurrency.Task { @MainActor in self?.openFailure = String(describing: error) }
            },
            onChange: { [weak self] _ in
                // 回调在 GRDB 的队列上，切回主线程再改 @Observable 状态。
                _Concurrency.Task { @MainActor in self?.refresh() }
            }
        )

        let outboxObservation = OutboxStore(database: database).observePendingCount()
        self.outboxObservation = outboxObservation.start(
            in: database.pool,
            scheduling: .immediate,
            onError: { [weak self] error in
                _Concurrency.Task { @MainActor in self?.openFailure = String(describing: error) }
            },
            onChange: { [weak self] _ in
                _Concurrency.Task { @MainActor in self?.refresh() }
            }
        )
    }

    /// 重读整个页面需要的数据。
    ///
    /// v1 每次都重读（200 条 + 两个 COUNT），在本地 SQLite 上是亚毫秒级；
    /// 等列表要分页时再改成"只取变化段"。
    public func refresh() {
        guard let memoStore else { return }
        do {
            let page = try memoStore.list(scope: .timeline, limit: Self.pageSize)
            memos = page.memos.map(Self.presentation(from:))
            stats = FMSidebarStats(
                recordCount: try memoStore.count(scope: .timeline),
                tagCount: Set(memos.flatMap(\.tags)).count,
                streakDays: Self.streakDays(from: page.memos)
            )
            tags = Self.tagFrequency(page.memos).map(\.name)
            if let database {
                pendingOutboxCount = try OutboxStore(database: database).pendingCount()
            }
        } catch {
            openFailure = String(describing: error)
        }
    }

    // MARK: - 映射

    private static func presentation(from memo: Memo) -> MemoPresentation {
        MemoPresentation(
            id: memo.id,
            content: memo.content,
            createdAt: memo.createdAt.date,
            tags: memo.payload.tags ?? [],
            isPinned: memo.pinned,
            commentCount: 0,
            hasAttachment: memo.payload.extras["has_attachment"]?.boolValue ?? false
        )
    }

    private static func tagFrequency(_ memos: [Memo]) -> [(name: String, count: Int)] {
        var frequency: [String: Int] = [:]
        for memo in memos {
            for tag in memo.payload.tags ?? [] {
                frequency[tag, default: 0] += 1
            }
        }
        return frequency
            .map { (name: $0.key, count: $0.value) }
            .sorted { $0.count == $1.count ? $0.name < $1.name : $0.count > $1.count }
    }

    /// 连续记录天数：从今天往回数，每天至少有一条。
    private static func streakDays(from memos: [Memo], calendar: Calendar = .current) -> Int {
        let days = Set(memos.map { calendar.startOfDay(for: $0.createdAt.date) })
        var streak = 0
        var cursor = calendar.startOfDay(for: .now)
        while days.contains(cursor) {
            streak += 1
            guard let previous = calendar.date(byAdding: .day, value: -1, to: cursor) else { break }
            cursor = previous
        }
        return streak
    }

    // MARK: - 路径

    /// 本地库目录。macOS 与 iOS 都放在 Application Support 下：
    /// 它参与系统备份（数据就是它），而附件走缓存目录另算（§7.7）。
    private static func applicationSupportDirectory() throws -> URL {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        return base.appendingPathComponent("FlareMo", isDirectory: true)
    }

    /// v1 单用户 bootstrap 的本地占位 uid；登录后换成服务端返回的 `users.id`。
    private static let localUserId = "local-user"
}

extension JSONValue {
    /// 只在 `extras` 里取布尔值用，避免到处写模式匹配。
    fileprivate var boolValue: Bool? {
        if case let .bool(value) = self { return value }
        return nil
    }
}
