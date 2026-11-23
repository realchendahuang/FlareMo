package dev.flaremo.core.network

import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp

/** 桌面（Windows/macOS）：同一份 OkHttp JVM 引擎，与 Android 行为一致。 */
actual fun createPlatformHttpEngine(): HttpClientEngine = OkHttp.create()
