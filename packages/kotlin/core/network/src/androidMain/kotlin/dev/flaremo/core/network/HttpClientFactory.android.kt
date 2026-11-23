package dev.flaremo.core.network

import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.cio.CIO

/**
 * Android：CIO 引擎。
 *
 * 为什么不是文档 §6.3 首选的 OkHttp：ktor-client-okhttp 3.6.1 依赖的
 * okhttp-android 5.5.1 要求 compileSdk 37，而项目版本钉在 36；
 * CIO 是纯 Kotlin 实现（无 Android AAR），对 M0 的 REST/SSE 需求完全够用。
 */
actual fun createPlatformHttpEngine(): HttpClientEngine = CIO.create()
