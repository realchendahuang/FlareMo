package dev.flaremo.core.db

/**
 * 同步层用的行记录。
 *
 * 放在 :core-db 而不是 :core-sync，是因为它们就是本地库的列投影；
 * 同步引擎只做映射与决策，不碰 SQL。
 */

/** `sync_state` 的单行水位。 */
data class SyncCursor(
    val seq: Int = 0,
    val generation: Int = 0,
)

/** outbox 里的一行待上送操作。 */
data class OutboxRow(
    val id: String,
    val op: String,
    val entity: String,
    val entityId: String,
    /** 序列化后的 REST 请求体字段集合。 */
    val payload: String,
    val idempotencyKey: String,
    val attempts: Int = 0,
    val nextAttemptAt: String? = null,
    val createdAt: String = "",
)

/** hydrate 回来的 memo 行（已摊平成本地库的列）。 */
data class RemoteMemoRow(
    val id: String,
    val content: String,
    val status: String,
    val pinned: Boolean,
    val source: String,
    val tags: List<String>,
    /** 原始 payload JSON（含 client_id / tags 等），整块存起来，解析交给上层。 */
    val payloadJson: String,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String?,
    val version: Int,
)
