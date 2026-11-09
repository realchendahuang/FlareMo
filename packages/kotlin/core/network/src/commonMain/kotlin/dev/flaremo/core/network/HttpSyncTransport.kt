package dev.flaremo.core.network

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * 真实同步传输层：Ktor + HTTP。
 *
 * 线格式以 `docs/native-clients.md` §4.4 为准，与 Apple 端
 * `URLSessionSyncTransport.swift` 逐请求对齐（同一套端点、同一套状态码语义）。
 *
 * 上送走既有 REST（服务端没有批量 push 端点）：
 * - create → `POST /api/app/memos`（body 带客户端 `id`，服务端按 id 幂等）
 * - update/delete → `PATCH /api/app/memos/:id`
 * 逐条发而不是批量，是服务端的现状；引擎侧的接口不变。
 */
class HttpSyncTransport(
    private val client: HttpClient,
    private val credentials: InstanceCredentials,
) : SyncTransport {
    private val baseUrl: String = credentials.normalizedBaseUrl
    private val authorization: String = "Bearer ${credentials.accessToken}"

    // MARK: 拉

    override suspend fun fetchChanges(since: Int, limit: Int): SyncChangesPage {
        val response = client.get("$baseUrl/api/app/sync/changes") {
            header(HttpHeaders.Authorization, authorization)
            parameter("since", since)
            parameter("limit", limit)
        }
        val body = readSuccessBody(response)
        return decodeOrThrow("changes") {
            FlareMoJson.decodeFromString(SyncChangesPage.serializer(), body)
        }
    }

    // MARK: 补正文

    override suspend fun hydrate(request: HydrateRequest): HydrateResponse {
        val response = client.post("$baseUrl/api/app/sync/hydrate") {
            header(HttpHeaders.Authorization, authorization)
            contentType(ContentType.Application.Json)
            setBody(FlareMoJson.encodeToString(HydrateRequest.serializer(), request))
        }
        val body = readSuccessBody(response)
        return decodeOrThrow("hydrate") {
            FlareMoJson.decodeFromString(HydrateResponse.serializer(), body)
        }
    }

    // MARK: 推

    override suspend fun push(request: PushRequest): PushResponse {
        val results = request.operations.map { pushOne(it) }
        return PushResponse(results)
    }

    private suspend fun pushOne(operation: PushOperation): PushResult {
        return try {
            val response: HttpResponse = when (operation.op) {
                "create" -> client.post("$baseUrl/api/app/memos") {
                    header(HttpHeaders.Authorization, authorization)
                    contentType(ContentType.Application.Json)
                    setBody(operation.payload.toString())
                }
                "update", "delete" -> client.patch("$baseUrl/api/app/memos/${operation.entityId}") {
                    header(HttpHeaders.Authorization, authorization)
                    contentType(ContentType.Application.Json)
                    setBody(buildPatchBody(operation).toString())
                }
                else -> return PushResult(
                    idempotencyKey = operation.idempotencyKey,
                    status = "error",
                    message = "不支持的操作：${operation.op}",
                )
            }

            val text = response.bodyAsText()
            when (response.status.value) {
                in 200..299 -> {
                    // 服务端的 memo DTO 与 hydrate 的 RemoteMemo 不同形；
                    // 解不出来不影响「已上送」这个事实，version 仅用于诊断。
                    val memo = runCatching {
                        FlareMoJson.decodeFromString(RemoteMemo.serializer(), text)
                    }.getOrNull()
                    PushResult(
                        idempotencyKey = operation.idempotencyKey,
                        status = "applied",
                        version = memo?.version,
                        serverMemo = memo,
                    )
                }
                401, 403 -> throw ApiError.Unauthorized()
                409 -> {
                    // 冲突：服务端带回最新正文时用它覆盖本地（LWW，§4.5）。
                    val memo = runCatching {
                        FlareMoJson.decodeFromString(RemoteMemo.serializer(), text)
                    }.getOrNull()
                    PushResult(
                        idempotencyKey = operation.idempotencyKey,
                        status = "conflict",
                        version = memo?.version,
                        serverMemo = memo,
                    )
                }
                else -> PushResult(
                    idempotencyKey = operation.idempotencyKey,
                    status = "error",
                    message = "HTTP ${response.status.value}",
                )
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: ApiError) {
            throw error
        } catch (error: Throwable) {
            PushResult(
                idempotencyKey = operation.idempotencyKey,
                status = "error",
                message = error.message ?: "传输失败",
            )
        }
    }

    /** PATCH 的 body：outbox 里记的字段 + 乐观锁版本 + 删除时改 status。 */
    private fun buildPatchBody(operation: PushOperation): JsonObject = buildJsonObject {
        operation.payload.forEach { (key, value) -> put(key, value) }
        operation.expectedVersion?.let { put("expected_version", it) }
        if (operation.op == "delete") {
            put("status", "trashed")
        }
    }

    // MARK: 状态码 → 错误语义

    private suspend fun readSuccessBody(response: HttpResponse): String {
        val status = response.status.value
        val text = response.bodyAsText()
        if (status in 200..299) return text
        throw when (status) {
            401, 403 -> ApiError.Unauthorized()
            410 -> ApiError.CursorExpired()
            404 -> ApiError.NotFound()
            409 -> ApiError.Conflict(text)
            else -> ApiError.Retryable("HTTP $status：${text.take(300)}")
        }
    }

    private fun <T> decodeOrThrow(what: String, parse: () -> T): T = try {
        parse()
    } catch (error: CancellationException) {
        throw error
    } catch (error: Throwable) {
        throw ApiError.Decoding("解析 $what 响应失败：${error.message}", error)
    }
}
