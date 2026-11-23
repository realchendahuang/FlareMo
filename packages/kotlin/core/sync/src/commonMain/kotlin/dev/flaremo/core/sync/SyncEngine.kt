package dev.flaremo.core.sync

import dev.flaremo.core.db.FlareMoDatabase
import dev.flaremo.core.db.OutboxRow
import dev.flaremo.core.db.RemoteMemoRow
import dev.flaremo.core.network.ApiError
import dev.flaremo.core.network.FlareMoJson
import dev.flaremo.core.network.HydrateRequest
import dev.flaremo.core.network.HydrateResponse
import dev.flaremo.core.network.PushOperation
import dev.flaremo.core.network.PushRequest
import dev.flaremo.core.network.PushResponse
import dev.flaremo.core.network.RemoteMemo
import dev.flaremo.core.network.SyncTransport
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * 同步引擎（§4.4 / §4.5 / §7.5 的同一套算法，与 Apple 端 `SyncEngine.swift` 对齐）。
 *
 * 两条独立的水位：
 * - **拉**：`since` 游标单调推进，只前进不后退；
 * - **推**：outbox 单写者串行上送，成功删行、失败退避。
 *
 * 引擎自己不持状态：水位全在本地库里，进程被杀也不会丢进度。
 * 顺序固定「先拉后推」——先拉到服务端最新版本，推的时候冲突才少。
 */
class SyncEngine(
    private val database: FlareMoDatabase,
    private val transport: SyncTransport,
) {
    /** 一轮完整同步：先拉，再推。 */
    suspend fun runOnce(pageLimit: Int = 200, pushLimit: Int = 20): SyncRunSummary {
        var summary = SyncRunSummary()
        summary = try {
            summary.copy(pull = pullOnce(pageLimit))
        } catch (error: ApiError.CursorExpired) {
            // 410：服务端不认识当前水位（实例重建/裁剪）→ 换代 + 清事实层，重试一次全量。
            database.prepareFullResync()
            try {
                summary.copy(pull = pullOnce(pageLimit))
            } catch (retryError: CancellationException) {
                throw retryError
            } catch (retryError: Throwable) {
                summary.copy(pullError = retryError.message ?: retryError.toString())
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            summary.copy(pullError = error.message ?: error.toString())
        }

        summary = try {
            summary.copy(push = pushOnce(pushLimit))
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            summary.copy(pushError = error.message ?: error.toString())
        }
        return summary
    }

    // MARK: 拉

    /**
     * 拉一页：取变更引用 → 只对 memo 引用补正文 → 事务落库 → 推进水位。
     *
     * 顺序必须是「先落库、再推进水位」：先推水位再落库，中途崩溃就永久丢这批变更。
     */
    suspend fun pullOnce(pageLimit: Int = 200): PullSummary {
        val cursor = database.syncCursor()
        val page = transport.fetchChanges(since = cursor.seq, limit = pageLimit)

        if (page.changes.isEmpty()) {
            database.recordPull()
            return PullSummary(applied = 0, nextSince = cursor.seq, hasMore = page.hasMore)
        }

        // v1 只落 memo；attachment/article/relation 的引用先跳过，但不阻塞水位。
        val memoIds = page.changes
            .filter { it.entity == "memo" && it.op != "delete" }
            .map { it.entityId }
            .distinct()
        if (memoIds.isNotEmpty()) {
            val hydration: HydrateResponse = transport.hydrate(HydrateRequest(memoIds = memoIds))
            database.applyRemoteMemos(hydration.memos.map(RemoteMemo::toRow))
        }

        // 删除也是变更：服务端 hydrate 会返回墓碑行，这里再兜一层，防止漏行。
        val deletedMemoIds = page.changes
            .filter { it.entity == "memo" && it.op == "delete" }
            .map { it.entityId }
        if (deletedMemoIds.isNotEmpty()) {
            database.markRemoteDeleted(deletedMemoIds, database.currentIsoTimestamp())
        }

        database.advanceSeq(page.nextSeq)
        database.recordPull()
        return PullSummary(
            applied = page.changes.size,
            nextSince = page.nextSeq,
            hasMore = page.hasMore,
        )
    }

    // MARK: 推

    /**
     * 推一批：取 outbox → 逐条上送 → applied/duplicate 删行、conflict 用服务端版本覆盖后删行、
     * 其它失败 `attempts+1` 指数退避（§4.5 / §7.5）。
     */
    suspend fun pushOnce(limit: Int = 20): PushSummary {
        val batch = database.outboxNextBatch(limit = limit)
        if (batch.isEmpty()) {
            return PushSummary(attempted = 0, applied = 0, conflicts = 0, retried = 0)
        }

        val response: PushResponse = try {
            transport.push(PushRequest(batch.map(::operationOf)))
        } catch (error: CancellationException) {
            throw error
        } catch (error: ApiError.Unauthorized) {
            throw error
        } catch (error: Throwable) {
            // 传输层整体失败：这一批一律退避，下一轮再来。
            batch.forEach { database.outboxRecordFailure(it.id) }
            return PushSummary(attempted = batch.size, applied = 0, conflicts = 0, retried = batch.size)
        }

        val resultsByKey = response.results.associateBy { it.idempotencyKey }
        var applied = 0
        var conflicts = 0
        var retried = 0

        for (item in batch) {
            val result = resultsByKey[item.idempotencyKey]
            if (result == null) {
                // 服务端没回这条：当失败处理，别把操作丢了。
                database.outboxRecordFailure(item.id)
                retried += 1
                continue
            }
            when (result.status) {
                "applied", "duplicate" -> {
                    database.outboxComplete(item.id)
                    applied += 1
                }
                "conflict" -> {
                    // LWW：服务端赢，覆盖本地后删掉 outbox 行。
                    result.serverMemo?.let { remote ->
                        database.applyRemoteMemos(listOf(remote.toRow()))
                    }
                    database.outboxComplete(item.id)
                    conflicts += 1
                }
                else -> {
                    database.outboxRecordFailure(item.id)
                    retried += 1
                }
            }
        }

        database.recordPush()
        return PushSummary(
            attempted = batch.size,
            applied = applied,
            conflicts = conflicts,
            retried = retried,
        )
    }

    // MARK: 映射

    private fun operationOf(item: OutboxRow): PushOperation {
        val payload = runCatching {
            FlareMoJson.parseToJsonElement(item.payload) as? JsonObject
        }.getOrNull() ?: JsonObject(emptyMap())
        val clientId = (payload["client_id"] as? JsonPrimitive)?.contentOrNull
        val expectedVersion = (payload["expected_version"] as? JsonPrimitive)?.contentOrNull?.toIntOrNull()
        return PushOperation(
            idempotencyKey = item.idempotencyKey,
            op = item.op,
            entity = item.entity,
            entityId = item.entityId,
            clientId = clientId,
            expectedVersion = expectedVersion,
            payload = payload,
        )
    }
}

// MARK: - 结果

data class PullSummary(
    val applied: Int,
    val nextSince: Int,
    val hasMore: Boolean,
)

data class PushSummary(
    val attempted: Int,
    val applied: Int,
    val conflicts: Int,
    val retried: Int,
)

data class SyncRunSummary(
    val pull: PullSummary? = null,
    val push: PushSummary? = null,
    val pullError: String? = null,
    val pushError: String? = null,
)

/** hydrate 行 → 本地库列投影（tags 从 payload 里摊平）。 */
internal fun RemoteMemo.toRow(): RemoteMemoRow {
    val payloadObject = payload as? JsonObject
    val tags = payloadObject?.get("tags")
        ?.let { element ->
            (element as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
        }
        .orEmpty()
    return RemoteMemoRow(
        id = id,
        content = content,
        status = if (deletedAt != null && status == "normal") "trashed" else status,
        pinned = pinned,
        source = source,
        tags = tags,
        payloadJson = payloadObject?.toString() ?: "{}",
        createdAt = createdAt,
        updatedAt = updatedAt,
        deletedAt = deletedAt,
        version = version,
    )
}
