package dev.flaremo.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.dp
import dev.flaremo.core.db.MemoRepository
import dev.flaremo.core.model.Memo
import dev.flaremo.core.sync.SyncController
import dev.flaremo.ui.components.MemoCard
import dev.flaremo.ui.theme.FlareMoTheme

/**
 * 移动端根视图（Android）。
 *
 * 和桌面不是同一套布局，是同一套设计语言：手机上「打开就写」是唯一重要的路径，
 * 所以输入框常驻吸底、时间线在它上面滚动。对应 Apple 端 `FMPhoneRoot`。
 */
@Composable
fun FlareMoPhoneApp(
    repository: MemoRepository,
    sync: SyncController? = null,
    modifier: Modifier = Modifier,
) {
    FlareMoTheme {
        val colors = FlareMoTheme.colors
        var draft by remember { mutableStateOf("") }
        // 读的就是本地库；写完立刻重读（v1 的数据量下重读是亚毫秒级）。
        var memos by remember { mutableStateOf<List<Memo>>(repository.list()) }
        // 同步跑完（或本地条数变了）就重读本地库；v1 的数据量下重读是亚毫秒级。
        val syncState = sync?.state?.collectAsState()?.value
        LaunchedEffect(syncState?.lastSyncAtEpochMillis, syncState?.memoCount) {
            memos = repository.list()
        }

        Column(
            modifier = modifier
                .fillMaxSize()
                .background(colors.background)
                // enableEdgeToEdge 之后内容会画到状态栏/导航栏底下，
                // 这里统一避让；输入条也就自然落在导航条上方。
                .safeDrawingPadding(),
        ) {
            PhoneHeader()
            PhoneSyncStrip(sync = sync)
            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(
                    start = 16.dp, end = 16.dp, top = 4.dp, bottom = 16.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(memos, key = { it.id }) { memo ->
                    MemoCard(
                        memo = memo,
                        onTogglePin = {
                            repository.setPinned(memo.id, !memo.pinned)
                            memos = repository.list()
                        },
                        onDelete = {
                            repository.delete(memo.id)
                            memos = repository.list()
                        },
                    )
                }
            }
            ComposerBar(
                draft = draft,
                onDraftChange = { draft = it },
                onSend = {
                    val trimmed = draft.trim()
                    if (trimmed.isNotEmpty()) {
                        repository.create(trimmed)
                        draft = ""
                        memos = repository.list()
                    }
                },
            )
        }
    }
}

@Composable
private fun PhoneHeader() {
    val colors = FlareMoTheme.colors
    val typography = FlareMoTheme.typography

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(20.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(Brush.linearGradient(listOf(colors.brand400, colors.brandCoral))),
        )
        Spacer(Modifier.width(8.dp))
        Text("FlareMo", style = typography.headline, color = colors.foreground)
        Spacer(Modifier.weight(1f))
        Text("搜索", style = typography.caption, color = colors.mutedForeground)
    }
}

@Composable
private fun ComposerBar(draft: String, onDraftChange: (String) -> Unit, onSend: () -> Unit) {
    val colors = FlareMoTheme.colors
    val typography = FlareMoTheme.typography
    val hasContent = draft.isNotBlank()

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.card.copy(alpha = 0.92f)),
    ) {
        Spacer(
            modifier = Modifier
                .fillMaxWidth()
                .height(0.5.dp)
                .background(colors.border.copy(alpha = 0.5f)),
        )
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(modifier = Modifier.weight(1f)) {
                if (draft.isEmpty()) {
                    Text("记点什么…", style = typography.body, color = colors.mutedForeground.copy(alpha = 0.8f))
                }
                BasicTextField(
                    value = draft,
                    onValueChange = onDraftChange,
                    textStyle = typography.body.copy(color = colors.foreground),
                    cursorBrush = SolidColor(colors.primary),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Spacer(Modifier.width(10.dp))
            Box(
                modifier = Modifier
                    .size(30.dp)
                    .clip(CircleShape)
                    .clickable(enabled = hasContent, onClick = onSend)
                    .background(
                        if (hasContent) {
                            Brush.linearGradient(listOf(colors.brand400, colors.brandCoral))
                        } else {
                            Brush.linearGradient(listOf(colors.muted, colors.muted))
                        },
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Text("↑", style = typography.caption, color = if (hasContent) colors.primaryForeground else colors.mutedForeground)
            }
        }
    }
}
