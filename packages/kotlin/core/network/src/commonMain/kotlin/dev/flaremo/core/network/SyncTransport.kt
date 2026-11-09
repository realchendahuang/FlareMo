package dev.flaremo.core.network

/**
 * 同步引擎唯一的网络出口。
 *
 * 抽成接口的理由：引擎单测用假传输层（不依赖后端是否在跑），
 * 真实实现 [HttpSyncTransport] 只在 App / 探针里注入。
 */
interface SyncTransport {
    /** 拉增量引用。`since` 是客户端水位。 */
    suspend fun fetchChanges(since: Int, limit: Int): SyncChangesPage

    /** 按 id 批量补正文。 */
    suspend fun hydrate(request: HydrateRequest): HydrateResponse

    /** 串行上送一批 outbox 操作。 */
    suspend fun push(request: PushRequest): PushResponse
}
