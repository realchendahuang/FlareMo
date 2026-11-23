package dev.flaremo.core.network

import io.ktor.client.HttpClient
import io.ktor.client.request.forms.FormDataContent
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.Parameters
import io.ktor.http.contentType
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * 设备授权（RFC 8628「配对码」）客户端。
 *
 * 对应服务端 `apps/worker/src/routes/connect-api.ts`：`POST /connect/device`
 * 申请配对码，`POST /connect/token`（form-urlencoded）轮询兑换令牌。
 * 状态机与 Apple 端 `DeviceAuthorizationClient.swift` 的表格一一对应。
 */

/** `POST /connect/device` 请求体。`client_type` 只能是 device/web/script。 */
@Serializable
private data class StartDeviceRequest(
    @SerialName("client_name") val clientName: String,
    @SerialName("client_type") val clientType: String,
    val scopes: List<String>,
)

/** `POST /connect/device` 响应（字段可选 + 默认值，旧实例少字段时不至于整条炸掉）。 */
@Serializable
data class DeviceAuthorization(
    @SerialName("device_code") val deviceCode: String,
    @SerialName("user_code") val userCode: String,
    @SerialName("verification_uri") val verificationUri: String,
    @SerialName("verification_uri_complete") val verificationUriComplete: String? = null,
    @SerialName("expires_in") val expiresIn: Int = 300,
    @SerialName("interval") val interval: Int = 5,
)

/** `POST /connect/token` 的成功响应。`access_token` 就是 `memos_pat_…`。 */
@Serializable
data class IssuedTokens(
    @SerialName("access_token") val accessToken: String,
    @SerialName("token_type") val tokenType: String = "Bearer",
    @SerialName("expires_in") val expiresIn: Int = 0,
    @SerialName("refresh_token") val refreshToken: String? = null,
    val scope: String = "",
)

/** 一次轮询的语义化结果。 */
sealed interface TokenPollResult {
    data class Issued(val tokens: IssuedTokens) : TokenPollResult
    data object Pending : TokenPollResult
    data object SlowDown : TokenPollResult
    data object Denied : TokenPollResult
    data object Expired : TokenPollResult
    data class Failure(val message: String) : TokenPollResult
}

@Serializable
private data class OAuthErrorResponse(
    val error: String? = null,
    @SerialName("error_description") val errorDescription: String? = null,
)

class DevicePairingClient(private val client: HttpClient) {
    // MARK: 1. 申请配对码

    suspend fun start(
        baseUrl: String,
        clientName: String,
        clientType: String = "device",
        scopes: List<String> = listOf("notes"),
    ): DeviceAuthorization {
        val normalized = InstanceUrls.normalize(baseUrl)
            ?: throw ApiError.Retryable("实例地址不合法：$baseUrl")
        val response = client.post("$normalized/connect/device") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.Accept, ContentType.Application.Json.toString())
            setBody(
                FlareMoJson.encodeToString(
                    StartDeviceRequest.serializer(),
                    StartDeviceRequest(clientName = clientName, clientType = clientType, scopes = scopes),
                ),
            )
        }
        val text = response.bodyAsText()
        if (response.status.value !in 200..299) {
            throw ApiError.Retryable("申请配对码失败（HTTP ${response.status.value}）：${text.take(200)}")
        }
        return try {
            FlareMoJson.decodeFromString(DeviceAuthorization.serializer(), text)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            throw ApiError.Decoding("解析配对响应失败：${error.message}", error)
        }
    }

    // MARK: 2. 轮询兑换

    suspend fun poll(baseUrl: String, deviceCode: String): TokenPollResult {
        val normalized = InstanceUrls.normalize(baseUrl)
            ?: return TokenPollResult.Failure("实例地址不合法：$baseUrl")
        val response = try {
            client.post("$normalized/connect/token") {
                setBody(
                    FormDataContent(
                        Parameters.build {
                            append("grant_type", DEVICE_CODE_GRANT_TYPE)
                            append("device_code", deviceCode)
                        },
                    ),
                )
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            return TokenPollResult.Failure(error.message ?: "网络错误")
        }
        val text = response.bodyAsText()
        val status = response.status.value

        if (status in 200..299) {
            val tokens = try {
                FlareMoJson.decodeFromString(IssuedTokens.serializer(), text)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                return TokenPollResult.Failure("解析令牌响应失败：${error.message}")
            }
            return if (tokens.accessToken.isBlank()) {
                TokenPollResult.Failure("令牌响应里没有 access_token")
            } else {
                TokenPollResult.Issued(tokens)
            }
        }

        val oauth = runCatching {
            FlareMoJson.decodeFromString(OAuthErrorResponse.serializer(), text)
        }.getOrNull()
        val code = oauth?.error
        if (status == 429 && (code == null || code == "slow_down")) return TokenPollResult.SlowDown
        return when (code) {
            "authorization_pending" -> TokenPollResult.Pending
            "slow_down" -> TokenPollResult.SlowDown
            "access_denied" -> TokenPollResult.Denied
            "expired_token", "invalid_grant" -> TokenPollResult.Expired
            else -> TokenPollResult.Failure(
                oauth?.errorDescription ?: code ?: "HTTP $status",
            )
        }
    }

    // MARK: 3. 续期

    /** 服务端每次刷新都会轮换 access/refresh 一对，调用方必须把新的 refreshToken 存回去。 */
    suspend fun refresh(baseUrl: String, refreshToken: String): IssuedTokens {
        val normalized = InstanceUrls.normalize(baseUrl)
            ?: throw ApiError.Retryable("实例地址不合法：$baseUrl")
        val response = client.post("$normalized/connect/token") {
            setBody(
                FormDataContent(
                    Parameters.build {
                        append("grant_type", REFRESH_TOKEN_GRANT_TYPE)
                        append("refresh_token", refreshToken)
                    },
                ),
            )
        }
        val text = response.bodyAsText()
        if (response.status.value !in 200..299) {
            throw ApiError.Unauthorized("刷新令牌失败（HTTP ${response.status.value}）")
        }
        return try {
            FlareMoJson.decodeFromString(IssuedTokens.serializer(), text)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            throw ApiError.Decoding("解析刷新响应失败：${error.message}", error)
        }
    }

    private companion object {
        const val DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
        const val REFRESH_TOKEN_GRANT_TYPE = "refresh_token"
    }
}
