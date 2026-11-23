package dev.flaremo.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.flaremo.core.db.MemoRepository
import dev.flaremo.core.model.Memo
import dev.flaremo.core.sync.SyncController
import dev.flaremo.ui.components.MemoCard
import dev.flaremo.ui.theme.FlareMoTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

/**
 * 桌面端根视图（Windows 走这一份；开发期在 macOS 的 JVM 上验证）。
 *
 * 布局与 Apple 端 `FMWorkspaceRoot` 同一套数学：
 * `[留白 10 | 侧栏 312 | 拖拽条 8 | 内容列 640 | 留白]`，整组居中。
 */
@Composable
fun FlareMoDesktopApp(
    repository: MemoRepository,
    sync: SyncController? = null,
    modifier: Modifier = Modifier,
) {
    FlareMoTheme {
        val colors = FlareMoTheme.colors
        var memos by remember { mutableStateOf<List<Memo>>(repository.list()) }
        val syncState = sync?.state?.collectAsState()?.value
        LaunchedEffect(syncState?.lastSyncAtEpochMillis, syncState?.memoCount) {
            memos = repository.list()
        }

        Row(modifier = modifier.fillMaxSize().background(colors.background)) {
            Spacer(Modifier.width(10.dp))
            Column(modifier = Modifier.width(312.dp).fillMaxHeight()) {
                Box(modifier = Modifier.weight(1f)) {
                    Sidebar(memoCount = memos.size)
                }
                SyncSidebarPanel(
                    sync = sync,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 10.dp),
                )
            }
            Spacer(Modifier.width(8.dp))
            ContentColumn(
                memos = memos,
                onTogglePin = { memo ->
                    repository.setPinned(memo.id, !memo.pinned)
                    memos = repository.list()
                },
                onDelete = { memo ->
                    repository.delete(memo.id)
                    memos = repository.list()
                },
                modifier = Modifier.width(640.dp).fillMaxHeight(),
            )
            Spacer(Modifier.weight(1f))
        }
    }
}

@Composable
private fun Sidebar(memoCount: Int) {
    val colors = FlareMoTheme.colors
    val typography = FlareMoTheme.typography

    Column(modifier = Modifier.width(312.dp).fillMaxHeight().padding(horizontal = 10.dp)) {
        Spacer(Modifier.height(14.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(22.dp)
                    .clip(RoundedCornerShape(7.dp))
                    .background(Brush.linearGradient(listOf(colors.brand400, colors.brandCoral))),
            )
            Spacer(Modifier.width(8.dp))
            Text("FlareMo", style = typography.title, color = colors.foreground)
        }
        Spacer(Modifier.height(12.dp))

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(colors.secondary.copy(alpha = 0.5f))
                .padding(vertical = 10.dp),
        ) {
            StatCell(Modifier.weight(1f), "$memoCount", "记录")
            StatCell(Modifier.weight(1f), "4", "标签")
            StatCell(Modifier.weight(1f), "1", "连续天数")
        }
        Spacer(Modifier.height(14.dp))

        for ((index, label) in listOf("记录", "回顾", "待办", "文章").withIndex()) {
            NavRow(label = label, active = index == 0)
        }

        Spacer(Modifier.height(18.dp))
        Text("标签", style = typography.label, color = colors.mutedForeground, modifier = Modifier.padding(horizontal = 10.dp))
        Spacer(Modifier.height(6.dp))
        for (tag in listOf("产品", "读书", "灵感", "会议", "旅行")) {
            NavRow(label = "# $tag", active = false, showIcon = false)
        }

        Spacer(Modifier.weight(1f))
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 14.dp, start = 10.dp)) {
            Box(
                modifier = Modifier.size(22.dp).clip(CircleShape).background(colors.secondary),
                contentAlignment = Alignment.Center,
            ) { Text("我", style = typography.caption, color = colors.mutedForeground) }
            Spacer(Modifier.width(8.dp))
            Text("我", style = typography.navigation, color = colors.foreground.copy(alpha = 0.7f))
        }
    }
}

@Composable
private fun StatCell(modifier: Modifier, value: String, label: String) {
    val colors = FlareMoTheme.colors
    val typography = FlareMoTheme.typography
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = typography.headline, color = colors.foreground)
        Text(label, style = typography.caption, color = colors.mutedForeground)
    }
}

@Composable
private fun NavRow(label: String, active: Boolean, showIcon: Boolean = true) {
    val colors = FlareMoTheme.colors
    val typography = FlareMoTheme.typography

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(32.dp)
            .clip(RoundedCornerShape(10.dp))
            .then(
                if (active) {
                    Modifier
                        .background(colors.card)
                        .border(1.dp, colors.border.copy(alpha = 0.7f), RoundedCornerShape(10.dp))
                } else {
                    Modifier
                },
            )
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showIcon) {
            Box(
                modifier = Modifier
                    .size(16.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(if (active) colors.primary.copy(alpha = 0.15f) else colors.muted),
            )
            Spacer(Modifier.width(10.dp))
        } else {
            Spacer(Modifier.width(0.dp))
        }
        Text(
            text = label,
            style = typography.navigation.copy(fontWeight = if (active) FontWeight.Medium else FontWeight.Normal),
            color = if (active) colors.foreground else colors.foreground.copy(alpha = 0.7f),
        )
    }
}

@Composable
private fun ContentColumn(
    memos: List<Memo>,
    onTogglePin: (Memo) -> Unit,
    onDelete: (Memo) -> Unit,
    modifier: Modifier,
) {
    val colors = FlareMoTheme.colors
    val typography = FlareMoTheme.typography

    Column(modifier = modifier.fillMaxHeight()) {
        Row(
            modifier = Modifier.fillMaxWidth().height(56.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("记录", style = typography.title, color = colors.foreground)
            Spacer(Modifier.weight(1f))
            Box(
                modifier = Modifier
                    .width(168.dp)
                    .height(28.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(colors.secondary.copy(alpha = 0.55f)),
                contentAlignment = Alignment.CenterStart,
            ) {
                Text("  搜索", style = typography.caption, color = colors.mutedForeground)
            }
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            for (memo in memos) {
                MemoCard(
                    memo = memo,
                    onTogglePin = { onTogglePin(memo) },
                    onDelete = { onDelete(memo) },
                )
            }
            Spacer(Modifier.height(64.dp))
        }
    }
}
