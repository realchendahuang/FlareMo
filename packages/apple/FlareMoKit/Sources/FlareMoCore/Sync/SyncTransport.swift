import Foundation

/// 同步引擎唯一的网络出口。
///
/// 抽成协议的理由：引擎的单测不该起 HTTP 服务；真实实现
/// （`URLSessionSyncTransport`，等后端 M0 落地后接）只在 App 里注入。
public protocol SyncTransport: Sendable {
    /// 拉增量引用。`since` 是客户端水位。
    func fetchChanges(since: Int, limit: Int) async throws -> SyncChangesPage
    /// 按 id 批量补正文。
    func hydrate(_ request: HydrateRequest) async throws -> HydrateResponse
    /// 串行上送一批 outbox 操作。
    func push(_ request: PushRequest) async throws -> PushResponse
}

/// 同步过程中可能出现的、需要引擎区别对待的错误。
public enum SyncError: Error, Sendable, Equatable {
    /// 410：服务端不认识当前水位（实例重建/裁剪），必须整库重建后全量对齐（§7.7）。
    case cursorExpired
    /// 401/403：令牌失效，交给认证层刷新，引擎本轮直接放弃。
    case unauthorized
    /// 其它可重试错误（网络、5xx）。
    case retryable(String)
}
