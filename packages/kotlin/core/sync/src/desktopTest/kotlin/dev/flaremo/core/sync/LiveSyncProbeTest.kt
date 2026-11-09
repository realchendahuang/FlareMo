package dev.flaremo.core.sync

import dev.flaremo.core.db.FlareMoDatabase
import dev.flaremo.core.db.SqliteMemoRepository
import dev.flaremo.core.network.HttpSyncTransport
import dev.flaremo.core.network.InstanceCredentials
import dev.flaremo.core.network.createFlareMoHttpClient
import java.io.File
import kotlin.io.path.createTempDirectory
import kotlin.test.Test
import kotlinx.coroutines.test.runTest

/**
 * 端到端探针：对着一个真实实例跑一轮同步，把关键数字打到 stdout。
 *
 * 默认 **skip**（不拿真实网络进单测），用项目属性显式打开：
 * ```
 * ./gradlew :core-sync:desktopTest --tests "*LiveSyncProbeTest*" \
 *   -Pflaremo.baseUrl=http://localhost:8787 -Pflaremo.token=memos_pat_…
 * ```
 */
class LiveSyncProbeTest {
    @Test
    fun pullFromLiveInstance() = runTest {
        val baseUrl = System.getProperty("flaremo.baseUrl").orEmpty()
        val token = System.getProperty("flaremo.token").orEmpty()
        if (baseUrl.isBlank() || token.isBlank()) {
            println("SKIP live probe：没有传 -Pflaremo.baseUrl / -Pflaremo.token")
            return@runTest
        }

        val directory = createTempDirectory("flaremo-live-probe").toFile()
        val database = FlareMoDatabase(File(directory, "probe.sqlite").absolutePath)
        val client = createFlareMoHttpClient()
        try {
            val credentials = InstanceCredentials(baseUrl = baseUrl, accessToken = token)
            val engine = SyncEngine(database, HttpSyncTransport(client, credentials))
            val summary = engine.runOnce()

            println("PROBE_BASE_URL=$baseUrl")
            println("PULL_APPLIED=${summary.pull?.applied ?: -1}")
            println("PULL_HAS_MORE=${summary.pull?.hasMore}")
            println("PULL_ERROR=${summary.pullError ?: "none"}")
            println("PUSH_ATTEMPTED=${summary.push?.attempted ?: -1}")
            println("PUSH_ERROR=${summary.pushError ?: "none"}")
            println("NEXT_SEQ=${database.syncCursor().seq}")
            println("MEMO_COUNT=${database.countMemos()}")

            // 可选：本地新建一条，再跑一轮，验证真实 REST 上送（POST 带客户端 id）。
            if (System.getProperty("flaremo.push") == "true") {
                val repository = SqliteMemoRepository(database)
                val created = repository.create("Kotlin 同步探针 ${System.currentTimeMillis()}")
                val pushed = engine.runOnce()
                println("PUSH_ATTEMPTED=${pushed.push?.attempted ?: -1}")
                println("PUSH_APPLIED=${pushed.push?.applied ?: -1}")
                println("PUSH_CONFLICTS=${pushed.push?.conflicts ?: -1}")
                println("PUSH_ERROR=${pushed.pushError ?: "none"}")
                println("OUTBOX_LEFT=${database.pendingOutboxCount()}")
                println("PUSHED_MEMO_ID=${created.id}")
                println("NEXT_SEQ_AFTER_PUSH=${database.syncCursor().seq}")
            }
        } finally {
            client.close()
            database.close()
            directory.deleteRecursively()
        }
    }
}
