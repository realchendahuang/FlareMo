package dev.flaremo.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import dev.flaremo.ui.FlareMoPhoneApp

/**
 * Android 唯一的 Activity。
 *
 * 界面全在 `:shared:ui` 的 `FlareMoPhoneApp()` 里，和桌面端共用同一套 Compose 代码——
 * 这也是选 Compose Multiplatform 而不是两端各写一遍的理由。
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            FlareMoPhoneApp()
        }
    }
}
