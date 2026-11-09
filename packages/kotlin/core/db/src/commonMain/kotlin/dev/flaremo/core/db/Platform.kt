package dev.flaremo.core.db

/**
 * 平台时钟与时间文本运算。
 *
 * 不在 common 里直接引 java.time：Android 与桌面都有它，但 common 源码不能用。
 * 用 expect/actual 几行解决，比引入 kotlinx-datetime 轻。
 */
internal expect fun currentTimeMillis(): Long

/** 当前时间的 ISO-8601 毫秒文本，与服务端 `toISOString()` 同形（`...123Z`）。 */
internal expect fun nowIso(): String

/** ISO 文本 + N 秒（outbox 的指数退避用）。 */
internal expect fun isoPlusSeconds(iso: String, seconds: Long): String
