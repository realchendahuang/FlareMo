package dev.flaremo.core.db

import kotlin.random.Random

/**
 * UUIDv7（RFC 9562）：前 48 位是毫秒时间戳，其余随机。
 *
 * 为什么不用 v4：v7 按时间有序，主键索引不碎片；而且 ID 由客户端生成，
 * 离线创建的记录在同步前就能被引用（与 Apple 端 `UUIDv7` 同一算法）。
 */
internal object Ids {
    fun uuidV7(nowMillis: Long = currentTimeMillis()): String {
        val bytes = ByteArray(16)
        // 48 位毫秒时间戳（大端）
        bytes[0] = ((nowMillis shr 40) and 0xFF).toByte()
        bytes[1] = ((nowMillis shr 32) and 0xFF).toByte()
        bytes[2] = ((nowMillis shr 24) and 0xFF).toByte()
        bytes[3] = ((nowMillis shr 16) and 0xFF).toByte()
        bytes[4] = ((nowMillis shr 8) and 0xFF).toByte()
        bytes[5] = (nowMillis and 0xFF).toByte()
        val random = Random.nextBytes(10)
        random.copyInto(bytes, destinationOffset = 6)
        // version = 7
        bytes[6] = ((bytes[6].toInt() and 0x0F) or 0x70).toByte()
        // variant = 10xx
        bytes[8] = ((bytes[8].toInt() and 0x3F) or 0x80).toByte()

        val hex = buildString(36) {
            for ((index, byte) in bytes.withIndex()) {
                if (index == 4 || index == 6 || index == 8 || index == 10) append('-')
                val value = byte.toInt() and 0xFF
                append("0123456789abcdef"[value shr 4])
                append("0123456789abcdef"[value and 0x0F])
            }
        }
        return hex
    }
}
