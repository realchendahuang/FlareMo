package dev.flaremo.desktop

import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import dev.flaremo.ui.FlareMoDesktopApp

/**
 * 桌面入口。
 *
 * 窗口尺寸与 Apple 端一致（1360×860，最小 980×620），
 * 这样同一套布局数学在两端看起来是同一个产品。
 */
fun main() = application {
    Window(
        onCloseRequest = ::exitApplication,
        title = "FlareMo",
        state = rememberWindowState(size = DpSize(1360.dp, 860.dp)),
    ) {
        FlareMoDesktopApp()
    }
}
