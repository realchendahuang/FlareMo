package dev.flaremo.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * 服务端增量同步契约（docs/native-clients.md §4.4），与 Apple 端
 * `Sources/FlareMoCore/Sync/SyncContract.swift` 逐字段对齐。
 *
 * 线格式一律 snake_case；这里显式写 `@SerialName`，改契约时 diff 一眼能看出来。
 */

/** 一条变更引用：只有游标与 id，没有正文。 */
@Serializable
data class SyncChange(
    /** 全局单调递增游标；客户端只存一个整数水位。 */
    val seq: Int,
    /** memo / attachment / article / relation */
    val entity: String,
    @SerialName("entity_id") val entityId: String,
    /** upsert / delete */
    val op: String,
    val version: Int = 1,
    @SerialName("updated_at") val updatedAt: String = "",
)

/** `GET /api/app/sync/changes?since=&limit=` */
@Serializable
data class SyncChangesPage(
    val changes: List<SyncChange> = emptyList(),
    @SerialName("next_seq") val nextSeq: Int,
    @SerialName("has_more") val hasMore: Boolean = false,
)

/** `POST /api/app/sync/hydrate` 的请求体。 */
@Serializable
data class HydrateRequest(
    @SerialName("memo_ids") val memoIds: List<String> = emptyList(),
    @SerialName("attachment_ids") val attachmentIds: List<String> = emptyList(),
    @SerialName("article_ids") val articleIds: List<String> = emptyList(),
    @SerialName("relation_ids") val relationIds: List<String> = emptyList(),
)

/**
 * hydrate 返回的 memo 行：列名与 D1 的 memos 表一致（snake_case），
 * 不含 `embedding_*` 这类不参与同步的派生列。
 */
@Serializable
data class RemoteMemo(
    val id: String,
    @SerialName("user_id") val userId: String = "",
    @SerialName("team_id") val teamId: String? = null,
    val content: String = "",
    val visibility: String = "private",
    val status: String = "normal",
    val pinned: Boolean = false,
    val source: String = "device",
    @SerialName("client_id") val clientId: String? = null,
    val payload: JsonElement? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
    @SerialName("deleted_at") val deletedAt: String? = null,
    val version: Int = 1,
)

/** hydrate 的响应体。v1 只消费 memos，其余实体保留结构但不落库。 */
@Serializable
data class HydrateResponse(
    val memos: List<RemoteMemo> = emptyList(),
)

/**
 * 上送的一步操作。
 *
 * `payload` 是「写成 REST 请求体的字段集合」：create 直接当 POST body，
 * update/delete 当 PATCH body（同步引擎已经从 outbox 里读出来了）。
 */
@Serializable
data class PushOperation(
    val idempotencyKey: String,
    /** create / update / delete */
    val op: String,
    /** memo（v1 只有 memo 有写路径） */
    val entity: String,
    val entityId: String,
    val clientId: String? = null,
    val expectedVersion: Int? = null,
    val payload: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class PushRequest(val operations: List<PushOperation>)

/** 单条上送结果。applied / duplicate / conflict / error。 */
@Serializable
data class PushResult(
    val idempotencyKey: String,
    val status: String,
    val version: Int? = null,
    val message: String? = null,
    /** 冲突时服务端的最新正文，用来覆盖本地（§4.5 LWW）。 */
    val serverMemo: RemoteMemo? = null,
)

@Serializable
data class PushResponse(val results: List<PushResult>)
