package dev.flaremo.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.dp
import dev.flaremo.core.model.Memo
import dev.flaremo.ui.SampleMemos
import dev.flaremo.ui.theme.FlareMoTheme

/**
 * 一张速记卡片。
 *
 * 尺寸照 Apple 端 `FMMemoCard` / Web 端 `memo-card.tsx`：
 * 圆角 14、水平内边距 16、垂直 14、发丝线描边、卡片面色。
 * 置顶用左侧一条 3dp 的渐变竖条，不用粗边框。
 */
@Composable
fun MemoCard(memo: Memo, modifier: Modifier = Modifier) {
    val colors = FlareMoTheme.colors
    val radii = FlareMoTheme.radii
    val typography = FlareMoTheme.typography

    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(radii.card))
            .background(colors.card)
            .border(1.dp, colors.border.copy(alpha = 0.6f), RoundedCornerShape(radii.card)),
    ) {
        if (memo.pinned) {
            Spacer(
                modifier = Modifier
                    .padding(vertical = 14.dp)
                    .width(3.dp)
                    .height(28.dp)
                    .background(
                        Brush.verticalGradient(listOf(colors.brand400, colors.brandCoral)),
                    ),
            )
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Text(
                    text = SampleMemos.timeLabel(memo.createdAt),
                    style = typography.caption,
                    color = colors.mutedForeground,
                )
                Spacer(Modifier.width(8.dp))
                for (tag in memo.tags) {
                    Text(
                        text = tag,
                        style = typography.caption,
                        color = colors.primary,
                        modifier = Modifier
                            .padding(end = 4.dp)
                            .clip(RoundedCornerShape(radii.sm))
                            .background(colors.primary.copy(alpha = 0.08f))
                            .padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                }
            }

            Text(
                text = memo.content,
                style = typography.body,
                color = colors.foreground,
            )
        }
    }
}
