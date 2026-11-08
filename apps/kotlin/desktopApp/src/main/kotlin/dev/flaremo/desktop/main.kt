package dev.flaremo.desktop

import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import dev.flaremo.core.db.FlareMoDatabase
import dev.flaremo.core.db.SqliteMemoRepository
import dev.flaremo.ui.FlareMoDesktopApp
import java.io.File

/**
 * 桌面入口（Windows 走同一份）。
 *
 * 窗口尺寸与 Apple 端一致（1360×860），本地库放在 `~/.flaremo/`，
 * 路径与 Apple 端的 Application Support 布局保持心智一致。
 */
fun main() {
    val directory = File(System.getProperty("user.home"), ".flaremo")
    directory.mkdirs()
    val database = FlareMoDatabase(File(directory, "library.sqlite").absolutePath)
    val repository = SqliteMemoRepository(database)

    application {
        Window(
            onCloseRequest = {
                database.close()
                exitApplication()
            },
            title = "FlareMo",
            state = rememberWindowState(size = DpSize(1360.dp, 860.dp)),
        ) {
            FlareMoDesktopApp(repository = repository)
        }
    }
}
