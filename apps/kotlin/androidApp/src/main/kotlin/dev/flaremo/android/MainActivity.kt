package dev.flaremo.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import dev.flaremo.core.db.FlareMoDatabase
import dev.flaremo.core.db.SqliteMemoRepository
import dev.flaremo.core.network.DevicePairingClient
import dev.flaremo.core.network.HttpSyncTransport
import dev.flaremo.core.network.createFlareMoHttpClient
import dev.flaremo.core.sync.SyncController
import dev.flaremo.ui.FlareMoPhoneApp
import io.ktor.client.HttpClient
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

/**
 * Android 唯一的 Activity。
 *
 * 界面全在 `:shared:ui` 的 `FlareMoPhoneApp()` 里，和桌面端共用同一套 Compose 代码。
 * 本地库放在应用私有目录（`filesDir`），参与系统备份、不需要任何存储权限。
 *
 * 同步循环挂在自己的 CoroutineScope 上：onStart 起、onStop 停（§7.5 前台才跑）。
 */
class MainActivity : ComponentActivity() {
    private lateinit var database: FlareMoDatabase
    private lateinit var httpClient: HttpClient
    private lateinit var sync: SyncController

    /**
     * 同步循环的宿主 scope：onStart 起、onStop 停（§7.5 前台才跑）。
     * 用 Dispatchers.IO：同步里既有网络也有阻塞 SQLite 调用，不能压在主线程。
     */
    private val syncScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        // v1 在主线程开库（SQLite open + 建表是毫秒级）。
        database = FlareMoDatabase(File(filesDir, "library.sqlite").absolutePath)
        val repository = SqliteMemoRepository(database)

        httpClient = createFlareMoHttpClient()
        sync = SyncController(
            database = database,
            credentialsStore = AndroidCredentialsStore(applicationContext),
            pairingClient = DevicePairingClient(httpClient),
            transportFactory = { credentials -> HttpSyncTransport(httpClient, credentials) },
            defaultClientName = "FlareMo Android",
        )

        setContent {
            FlareMoPhoneApp(repository = repository, sync = sync)
        }
    }

    override fun onStart() {
        super.onStart()
        sync.start(syncScope)
    }

    override fun onStop() {
        sync.stop()
        super.onStop()
    }

    override fun onDestroy() {
        syncScope.cancel()
        httpClient.close()
        database.close()
        super.onDestroy()
    }
}
