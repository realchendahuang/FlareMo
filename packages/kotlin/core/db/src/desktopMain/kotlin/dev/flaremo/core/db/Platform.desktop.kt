package dev.flaremo.core.db

import java.time.Instant

internal actual fun currentTimeMillis(): Long = System.currentTimeMillis()

internal actual fun nowIso(): String = Instant.ofEpochMilli(currentTimeMillis()).toString()

internal actual fun isoPlusSeconds(iso: String, seconds: Long): String =
    runCatching { Instant.parse(iso).plusSeconds(seconds).toString() }
        .getOrElse {
            Instant.ofEpochMilli(currentTimeMillis() + seconds * 1000).toString()
        }
