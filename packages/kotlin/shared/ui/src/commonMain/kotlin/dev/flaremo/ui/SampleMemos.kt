package dev.flaremo.ui

import dev.flaremo.core.model.Memo

/**
 * 界面先用这组假数据点亮。
 *
 * 接上 `core:db`（Room）之后，这里会被 `MemoRepository` 的 `Flow<List<Memo>>` 替掉；
 * 视图层只认 `List<Memo>`，所以替换时界面代码不用动。
 */
object SampleMemos {
    val all: List<Memo> = listOf(
        Memo(
            id = "0199aa00-0000-7000-8000-000000000101",
            content = "把「同步」想清楚了一半：本地库才是事实源，网络只负责搬运变化。\n打开 App 那一刻不该等任何请求。",
            createdAt = "2026-11-08T16:40:00.000Z",
            updatedAt = "2026-11-08T16:40:00.000Z",
            pinned = true,
            tags = listOf("产品"),
        ),
        Memo(
            id = "0199aa00-0000-7000-8000-000000000102",
            content = "读到一句话：克制不是少做，而是做的每一件都值得占位置。",
            createdAt = "2026-11-08T13:20:00.000Z",
            updatedAt = "2026-11-08T13:20:00.000Z",
            tags = listOf("读书"),
        ),
        Memo(
            id = "0199aa00-0000-7000-8000-000000000103",
            content = "今天过了客户端的技术选型：\n1. Apple 侧 SwiftUI + GRDB\n2. Kotlin 侧 Compose Multiplatform\n3. 契约只写一遍",
            createdAt = "2026-11-08T09:05:00.000Z",
            updatedAt = "2026-11-08T09:05:00.000Z",
            tags = listOf("会议", "产品"),
            commentCount = 2,
        ),
        Memo(
            id = "0199aa00-0000-7000-8000-000000000104",
            content = "机场的咖啡比想象中好喝。以后尽量不坐早班机。",
            createdAt = "2026-11-07T22:10:00.000Z",
            updatedAt = "2026-11-07T22:10:00.000Z",
            tags = listOf("旅行"),
            hasAttachment = true,
        ),
    )

    /** 列表里显示的时间：今天显示时分，其它显示月日（与 Apple 端 MemoTimeLabel 同规则）。 */
    fun timeLabel(iso: String): String {
        // 简化版：直接取 ISO 的时分/月日；接上 kotlinx-datetime 之后换成真实时区换算。
        val datePart = iso.substringBefore("T")
        val timePart = iso.substringAfter("T").take(5)
        return "$datePart $timePart"
    }
}
