package dev.flaremo.desktop

import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import dev.flaremo.core.db.FlareMoDatabase
import dev.flaremo.core.db.SqliteMemoRepository
import dev.flaremo.core.network.DevicePairingClient
import dev.flaremo.core.network.HttpSyncTransport
import dev.flaremo.core.network.createFlareMoHttpClient
import dev.flaremo.core.sync.SyncController
import dev.flaremo.ui.FlareMoDesktopApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import java.io.File

/**
 * 桌面入口（Windows 走同一份）。
 *
 * 窗口尺寸与 Apple 端一致（1360×860），本地库与配对凭据放在 `~/.flaremo/`，
 * 路径与 Apple 端的 Application Support 布局保持心智一致。
 *
 * 同步循环跟着进程活：窗口开着的这段时间每 30 秒跑一轮（前台才跑，§7.5）。
 */
fun main() {
    val directory = File(System.getProperty("user.home"), ".flaremo")
    directory.mkdirs()
    val database = FlareMoDatabase(File(directory, "library.sqlite").absolutePath)
    val repository = SqliteMemoRepository(database)

    val httpClient = createFlareMoHttpClient()
    // 同步里既有网络也有阻塞 SQLite 调用，统一放 IO 线程。
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val sync = SyncController(
        database = database,
        credentialsStore = FileCredentialsStore(File(directory, "credentials.txt")),
        pairingClient = DevicePairingClient(httpClient),
        transportFactory = { credentials -> HttpSyncTransport(httpClient, credentials) },
        defaultClientName = "FlareMo Windows",
    )
    sync.start(scope)

    application {
        Window(
            onCloseRequest = {
                sync.stop()
                scope.cancel()
                httpClient.close()
                database.close()
                exitApplication()
            },
            title = "FlareMo",
            state = rememberWindowState(size = DpSize(1360.dp, 860.dp)),
        ) {
            FlareMoDesktopApp(repository = repository, sync = sync)
        }
    }
}
