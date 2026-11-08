package dev.flaremo.core.model

/**
 * 一条速记。
 *
 * 字段刻意与 Apple 端 `FlareMoCore.Models.Memo` 及服务端 D1 的 memos 表一一对应：
 * 两端共用同一套语义，同步层才不需要做字段翻译。
 */
data class Memo(
    val id: String,
    val content: String,
    /** ISO-8601 毫秒文本，与服务端 `toISOString()` 逐字节一致。 */
    val createdAt: String,
    val updatedAt: String,
    val pinned: Boolean = false,
    val tags: List<String> = emptyList(),
    val commentCount: Int = 0,
    val hasAttachment: Boolean = false,
) {
    /** 列表里显示的第一行（速记没有标题，第一行就是它的"标题"）。 */
    val firstLine: String
        get() = content.lineSequence().firstOrNull { it.isNotBlank() } ?: ""
}
