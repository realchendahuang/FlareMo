package dev.flaremo.core.sync

import dev.flaremo.core.db.FlareMoDatabase
import dev.flaremo.core.db.SqliteMemoRepository
import dev.flaremo.core.network.HydrateRequest
import dev.flaremo.core.network.HydrateResponse
import dev.flaremo.core.network.PushRequest
import dev.flaremo.core.network.PushResponse
import dev.flaremo.core.network.PushResult
import dev.flaremo.core.network.RemoteMemo
import dev.flaremo.core.network.SyncChange
import dev.flaremo.core.network.SyncChangesPage
import dev.flaremo.core.network.SyncTransport
import java.io.File
import kotlin.io.path.createTempDirectory
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

/**
 * 同步引擎的 JVM 单测（假传输层）。
 *
 * 覆盖六种场景：空页、落库推进水位、删除墓碑、上送成功、409 LWW 覆盖、失败退避。
 * 用假传输层而不是真实实例：单测不该依赖后端是否在跑（与 Apple 端同一原则）。
 */
class SyncEngineTest {
    private val directory: File = createTempDirectory("flaremo-sync-test").toFile()
    private val database = FlareMoDatabase(File(directory, "library.sqlite").absolutePath)
    private val repository = SqliteMemoRepository(database)
    private val transport = FakeTransport()

    @AfterTest
    fun tearDown() {
        database.close()
        directory.deleteRecursively()
    }

    @Test
    fun `空页不补正文也不推进水位`() = runTest {
        transport.pages.addLast(SyncChangesPage(changes = emptyList(), nextSeq = 0))

        val summary = SyncEngine(database, transport).pullOnce()

        assertEquals(0, summary.applied)
        assertEquals(0, summary.nextSince)
        assertEquals(0, database.syncCursor().seq)
        assertTrue(transport.hydrateCalls.isEmpty(), "没有变更就不该发 hydrate")
    }

    @Test
    fun `拉的变更落库后推进水位`() = runTest {
        transport.pages.addLast(
            SyncChangesPage(
                changes = listOf(
                    SyncChange(seq = 41, entity = "memo", entityId = "memo-a", op = "upsert"),
                    SyncChange(seq = 42, entity = "memo", entityId = "memo-b", op = "upsert"),
                ),
                nextSeq = 42,
            ),
        )
        transport.hydration = HydrateResponse(
            memos = listOf(remoteMemo("memo-a", "服务端 A"), remoteMemo("memo-b", "服务端 B")),
        )

        val summary = SyncEngine(database, transport).pullOnce()

        assertEquals(2, summary.applied)
        assertEquals(42, summary.nextSince)
        assertEquals(42, database.syncCursor().seq)
        assertEquals(listOf("memo-a", "memo-b"), transport.hydrateCalls.single().memoIds)
        asserts()

        val listed = repository.list()
        assertEquals(2, listed.size)
        assertEquals(setOf("服务端 A", "服务端 B"), listed.map { it.content }.toSet())
        assertEquals(0, repository.pendingSyncCount(), "远端落库不能产生 outbox 行")
    }

    private fun asserts() {
        assertNotNull(database.memoStatus("memo-a"))
    }

    @Test
    fun `删除变更落墓碑但不硬删行`() = runTest {
        // 第一页：先把一行同步下来。
        transport.pages.addLast(
            SyncChangesPage(
                changes = listOf(SyncChange(seq = 10, entity = "memo", entityId = "memo-x", op = "upsert")),
                nextSeq = 10,
            ),
        )
        transport.hydration = HydrateResponse(memos = listOf(remoteMemo("memo-x", "会被删")))
        val engine = SyncEngine(database, transport)
        engine.pullOnce()
        assertEquals(1, repository.count())

        // 第二页：服务端说它没了。
        transport.pages.addLast(
            SyncChangesPage(
                changes = listOf(SyncChange(seq = 11, entity = "memo", entityId = "memo-x", op = "delete")),
                nextSeq = 11,
            ),
        )
        val summary = engine.pullOnce()

        assertEquals(11, database.syncCursor().seq)
        assertEquals(0, repository.count(), "墓碑不再出现在时间线")
        assertEquals("trashed", database.memoStatus("memo-x"), "行还在，只是变墓碑")
        assertNotNull(database.memoDeletedAt("memo-x"))
        assertEquals(1, summary.applied)
    }

    @Test
    fun `上送成功删掉 outbox 行`() = runTest {
        val memo = repository.create("离线写的")
        assertEquals(1, repository.pendingSyncCount())
        val key = database.outboxAll().single().idempotencyKey
        transport.pushResponder = { request ->
            PushResponse(request.operations.map { PushResult(it.idempotencyKey, "applied", version = 1) })
        }

        val summary = SyncEngine(database, transport).pushOnce()

        assertEquals(1, summary.attempted)
        assertEquals(1, summary.applied)
        assertEquals(0, repository.pendingSyncCount())
        val operation = transport.pushRequests.single().operations.single()
        assertEquals("create", operation.op)
        assertEquals(memo.id, operation.entityId)
        assertTrue(operation.payload.toString().contains(memo.content), "create 的 body 要带正文")
    }

    @Test
    fun `409 冲突用服务端版本覆盖本地后删行`() = runTest {
        val memo = repository.create("本地的版本")
        repository.setPinned(memo.id, true) // 再入一条 update
        val key = database.outboxAll().first().idempotencyKey
        transport.pushResponder = {
            PushResponse(
                listOf(
                    PushResult(
                        idempotencyKey = key,
                        status = "conflict",
                        version = 7,
                        serverMemo = remoteMemo(memo.id, "服务端的版本", version = 7),
                    ),
                ),
            )
        }

        val summary = SyncEngine(database, transport).pushOnce(limit = 1)

        assertEquals(1, summary.conflicts)
        val listed = repository.list()
        assertEquals("服务端的版本", listed.single().content, "LWW：服务端赢")
        assertEquals(1, repository.pendingSyncCount(), "只应删掉这一条冲突行，另一条留着")
    }

    @Test
    fun `上送失败按指数退避并跳过未到时间的行`() = runTest {
        repository.create("会失败的")
        transport.pushResponder = { request ->
            PushResponse(
                request.operations.map {
                    PushResult(it.idempotencyKey, "error", message = "HTTP 500")
                },
            )
        }

        val summary = SyncEngine(database, transport).pushOnce()

        assertEquals(1, summary.retried)
        val row = database.outboxAll().single()
        assertEquals(1, row.attempts)
        assertNotNull(row.nextAttemptAt, "失败要写下次重试时间")
        assertNull(database.outboxNextBatch().firstOrNull(), "未到重试时间的行不该被取到")

        // 第二轮：同一时刻再跑，取不到这批行，不发请求。
        val second = SyncEngine(database, transport).pushOnce()
        assertEquals(0, second.attempted)
        assertNotEquals(0, repository.pendingSyncCount())
    }
}

/** 假传输层：页面/补正文/上送结果都由测试摆好。 */
private class FakeTransport : SyncTransport {
    val pages = ArrayDeque<SyncChangesPage>()
    var hydration: HydrateResponse = HydrateResponse()
    val hydrateCalls = mutableListOf<HydrateRequest>()
    val pushRequests = mutableListOf<PushRequest>()
    var pushResponder: (PushRequest) -> PushResponse = { PushResponse(emptyList()) }

    override suspend fun fetchChanges(since: Int, limit: Int): SyncChangesPage =
        pages.removeFirstOrNull() ?: SyncChangesPage(changes = emptyList(), nextSeq = since)

    override suspend fun hydrate(request: HydrateRequest): HydrateResponse {
        hydrateCalls += request
        return hydration
    }

    override suspend fun push(request: PushRequest): PushResponse {
        pushRequests += request
        return pushResponder(request)
    }
}

private fun remoteMemo(id: String, content: String, version: Int = 1) = RemoteMemo(
    id = id,
    content = content,
    createdAt = "2026-11-09T00:00:00.000Z",
    updatedAt = "2026-11-09T00:00:00.000Z",
    version = version,
)
