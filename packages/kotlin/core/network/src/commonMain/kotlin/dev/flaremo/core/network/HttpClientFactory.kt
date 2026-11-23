package dev.flaremo.core.network

import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

/**
 * 平台 HTTP 引擎。
 *
 * Android 与桌面都用 OkHttp（同一份 JVM 实现），差异只留在这一行 actual 里；
 * 换成 CIO / Darwin / WinHttp 时，上层传输层不用动。
 */
expect fun createPlatformHttpEngine(): HttpClientEngine

/**
 * 线格式的 JSON 策略。
 *
 * 显式用 `@SerialName` 写 snake_case，而不是依赖命名策略：契约字段名是硬约束，
 * 写出来才能在 diff 里 review（与 Apple 端 `convertFromSnakeCase` 等价，但更直白）。
 */
val FlareMoJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    explicitNulls = false
    isLenient = false
}

/** 建一个 Ktor client：30s 请求超时、15s 连接超时，错误状态码交给传输层自己映射。 */
fun createFlareMoHttpClient(): HttpClient = HttpClient(createPlatformHttpEngine()) {
    expectSuccess = false
    install(ContentNegotiation) {
        json(FlareMoJson)
    }
    install(HttpTimeout) {
        requestTimeoutMillis = 30_000
        connectTimeoutMillis = 15_000
        socketTimeoutMillis = 30_000
    }
}
