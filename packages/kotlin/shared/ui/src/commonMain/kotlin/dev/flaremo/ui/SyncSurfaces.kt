package dev.flaremo.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.dp
import dev.flaremo.core.sync.SyncController
import dev.flaremo.core.sync.SyncUiState
import dev.flaremo.ui.theme.FlareMoTheme

/**
 * 两端共用的同步界面件。
 *
 * 状态来自 [SyncController] 的 StateFlow，交互只有三个：立即同步、配对新实例、断开。
 * 不做轮询、不发请求——真正的调度在 :core-sync 的后台循环里。
 */

/** 手机端一行状态条：状态点 + 文案 + 立即同步。 */
@Composable
fun PhoneSyncStrip(sync: SyncController?, modifier: Modifier = Modifier) {
    if (sync == null) return
    val state by sync.state.collectAsState()
    val scope = rememberCoroutineScope()
    val colors = FlareMoTheme.colors
    val typography = FlareMoTheme.typography

    Row(
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SyncDot(connected = state.connected, syncing = state.syncing)
        Spacer(Modifier.width(6.dp))
        Text(
            text = phoneStatusText(state),
            style = typography.caption,
            color = if (state.lastError != null) colors.destructive else colors.mutedForeground,
        )
        Spacer(Modifier.weight(1f))
        Text(
            text = if (state.syncing) "同步中…" else "立即同步",
            modifier = Modifier
                .clip(RoundedCornerShape(6.dp))
                .clickable(enabled = !state.syncing) { sync.syncNow(scope) }
                .padding(horizontal = 8.dp, vertical = 4.dp),
            style = typography.caption,
            color = if (state.syncing) colors.mutedForeground else colors.primary,
        )
    }
}

private fun phoneStatusText(state: SyncUiState): String = when {
    state.lastError != null -> "同步出错：${state.lastError}"
    !state.connected -> "未连接实例"
    state.syncing -> "正在同步…"
    else -> "已连接 · 待发送 ${state.pendingCount} 条"
}

/**
 * 桌面侧栏底部的同步面板：断开时是「实例地址 + 配对」入口，
 * 配对中显示配对码，连上以后显示状态与两个动作。
 */
@Composable
fun SyncSidebarPanel(sync: SyncController?, modifier: Modifier = Modifier) {
    if (sync == null) return
    val state by sync.state.collectAsState()
    val pairing by sync.pairing.collectAsState()
    val scope = rememberCoroutineScope()
    val colors = FlareMoTheme.colors
    val typography = FlareMoTheme.typography
    var baseUrlInput by remember { mutableStateOf("") }
    val prompt = pairing

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(colors.secondary.copy(alpha = 0.45f))
            .padding(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SyncDot(connected = state.connected, syncing = state.syncing)
            Spacer(Modifier.width(6.dp))
            Text(
                text = if (state.connected) "已连接" else "未连接",
                style = typography.label,
                color = colors.foreground,
            )
            Spacer(Modifier.weight(1f))
            if (state.syncing) {
                Text("同步中…", style = typography.caption, color = colors.mutedForeground)
            }
        }

        when {
            // 未连接 + 配对中：显示配对码，等浏览器里授权。
            !state.connected && prompt != null -> {
                Spacer(Modifier.height(6.dp))
                Text("配对码 ${prompt.userCode}", style = typography.cardTitle, color = colors.foreground)
                Text(
                    "在浏览器打开 ${prompt.verificationUri} 输入配对码",
                    style = typography.caption,
                    color = colors.mutedForeground,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "取消配对",
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .clickable { sync.cancelPairing() }
                        .padding(horizontal = 6.dp, vertical = 3.dp),
                    style = typography.label,
                    color = colors.mutedForeground,
                )
            }
            // 未连接：实例地址输入 + 配对按钮。
            !state.connected -> {
                Spacer(Modifier.height(6.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(28.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(colors.card)
                        .border(1.dp, colors.border.copy(alpha = 0.7f), RoundedCornerShape(8.dp)),
                ) {
                    if (baseUrlInput.isEmpty()) {
                        Text(
                            "  https://flaremo.example.com",
                            style = typography.caption,
                            color = colors.mutedForeground.copy(alpha = 0.8f),
                            modifier = Modifier.align(Alignment.CenterStart),
                        )
                    }
                    BasicTextField(
                        value = baseUrlInput,
                        onValueChange = { baseUrlInput = it },
                        singleLine = true,
                        textStyle = typography.caption.copy(color = colors.foreground),
                        cursorBrush = SolidColor(colors.primary),
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
                    )
                }
                Spacer(Modifier.height(6.dp))
                Text(
                    "配对这台实例",
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .clickable(enabled = baseUrlInput.isNotBlank()) {
                            sync.connect(scope, baseUrlInput)
                        }
                        .padding(horizontal = 6.dp, vertical = 3.dp),
                    style = typography.label,
                    color = if (baseUrlInput.isNotBlank()) colors.primary else colors.mutedForeground,
                )
            }
            // 已连接：地址 + 计数 + 动作。
            else -> {
                Spacer(Modifier.height(4.dp))
                Text(
                    state.baseUrl?.removePrefix("https://")?.removePrefix("http://").orEmpty(),
                    style = typography.caption,
                    color = colors.mutedForeground,
                )
                Text(
                    "待发送 ${state.pendingCount} 条 · 本地 ${state.memoCount} 条",
                    style = typography.caption,
                    color = colors.mutedForeground,
                )
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "立即同步",
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .clickable(enabled = !state.syncing) { sync.syncNow(scope) }
                            .padding(horizontal = 6.dp, vertical = 3.dp),
                        style = typography.label,
                        color = if (state.syncing) colors.mutedForeground else colors.primary,
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(
                        "断开",
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .clickable { sync.disconnect() }
                            .padding(horizontal = 6.dp, vertical = 3.dp),
                        style = typography.label,
                        color = colors.mutedForeground,
                    )
                }
            }
        }

        state.lastError?.let { error ->
            Spacer(Modifier.height(4.dp))
            Text(error, style = typography.caption, color = colors.destructive)
        }
    }
}

@Composable
private fun SyncDot(connected: Boolean, syncing: Boolean) {
    val colors = FlareMoTheme.colors
    Box(
        modifier = Modifier
            .size(6.dp)
            .clip(CircleShape)
            .background(
                when {
                    syncing -> colors.primary
                    connected -> colors.primary
                    else -> colors.mutedForeground.copy(alpha = 0.6f)
                },
            ),
    )
}
