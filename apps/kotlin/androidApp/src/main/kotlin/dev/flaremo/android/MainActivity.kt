package dev.flaremo.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import dev.flaremo.core.db.FlareMoDatabase
import dev.flaremo.core.db.SqliteMemoRepository
import dev.flaremo.ui.FlareMoPhoneApp
import java.io.File

/**
 * Android 唯一的 Activity。
 *
 * 界面全在 `:shared:ui` 的 `FlareMoPhoneApp()` 里，和桌面端共用同一套 Compose 代码。
 * 本地库放在应用私有目录（`filesDir`），参与系统备份、不需要任何存储权限。
 */
class MainActivity : ComponentActivity() {
    private lateinit var database: FlareMoDatabase

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        // v1 在主线程开库（SQLite open + 建表是毫秒级）；接了同步层之后挪到后台线程。
        database = FlareMoDatabase(File(filesDir, "library.sqlite").absolutePath)
        val repository = SqliteMemoRepository(database)

        setContent {
            FlareMoPhoneApp(repository = repository)
        }
    }

    override fun onDestroy() {
        database.close()
        super.onDestroy()
    }
}
