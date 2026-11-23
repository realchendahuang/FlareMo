package dev.flaremo.core.network

/**
 * HTTP 层的错误语义。
 *
 * 同步引擎按这些类型决定「本轮放弃 / 退避重试 / 整库重建」：
 * - [Unauthorized] 401/403：令牌失效，交给认证层，本轮直接放弃；
 * - [CursorExpired] 410：服务端不认识当前水位，必须清空事实层后全量对齐（§7.7）；
 * - [Retryable] 网络错误 / 5xx / 其它：下一轮重试；
 * - [Conflict] 409：服务端版本更新，LWW 覆盖本地（§4.5）；
 * - [Decoding] 契约漂移，属于 bug，报出来别吞。
 */
sealed class ApiError(message: String, cause: Throwable? = null) : Exception(message, cause) {
    class Unauthorized(message: String = "HTTP 401/403：令牌无效") : ApiError(message)

    class CursorExpired(
        message: String = "HTTP 410：同步游标已过期，需要全量重建",
    ) : ApiError(message)

    class NotFound(message: String = "HTTP 404") : ApiError(message)

    class Conflict(val body: String?, message: String = "HTTP 409：版本冲突") :
        ApiError(message)

    class Retryable(message: String, cause: Throwable? = null) : ApiError(message, cause)

    class Decoding(message: String, cause: Throwable? = null) : ApiError(message, cause)
}
