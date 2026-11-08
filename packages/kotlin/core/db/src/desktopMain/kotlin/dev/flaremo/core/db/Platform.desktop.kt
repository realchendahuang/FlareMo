package dev.flaremo.core.db

import java.time.Instant

internal actual fun currentTimeMillis(): Long = System.currentTimeMillis()

internal actual fun nowIso(): String = Instant.ofEpochMilli(currentTimeMillis()).toString()
