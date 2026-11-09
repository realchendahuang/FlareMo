package dev.flaremo.core.network

/**
 * 一台已配对实例的凭据。
 *
 * `accessToken` 就是 `memos_pat_…`，直接放进 `Authorization: Bearer`；
 * `refreshToken` 只在设备流拿到的一对里有（§4.9 续期要靠它）。
 */
data class InstanceCredentials(
    val baseUrl: String,
    val accessToken: String,
    val refreshToken: String? = null,
    /** access token 过期时间（epoch millis）；0/空表示不过期或未知。 */
    val expiresAtEpochMillis: Long? = null,
    /** 配对时登记在实例「已连接应用」里的名字。 */
    val clientName: String? = null,
) {
    /** 去掉末尾斜杠，拼 URL 时不会出现 `//api/...`。 */
    val normalizedBaseUrl: String
        get() = baseUrl.trim().trimEnd('/')
}

/**
 * 凭据持久化。
 *
 * Android 用 SharedPreferences（M1 换 EncryptedSharedPreferences / EncryptedFile，
 * 见实现里的注释），桌面用 `~/.flaremo/credentials.json`。接口留在 common，
 * 两边 App 各自实现，同步层不关心存哪里。
 */
interface CredentialsStore {
    fun load(): InstanceCredentials?
    fun save(credentials: InstanceCredentials)
    fun clear()
}

/**
 * 归一化用户输入的实例地址。
 *
 * 支持 `flaremo.example.com`、`http://localhost:8787`、`https://…/` 三种写法；
 * 不带 scheme 时，localhost/内网 IP 按 http，其它按 https（与 Apple 端一致）。
 */
object InstanceUrls {
    fun normalize(raw: String): String? {
        val trimmed = raw.trim().trimEnd('/')
        if (trimmed.isEmpty()) return null
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed
        val host = trimmed.substringBefore('/')
        val local = host.startsWith("localhost") ||
            host.startsWith("127.0.0.1") ||
            host.startsWith("0.0.0.0") ||
            host.startsWith("10.") ||
            host.startsWith("192.168.") ||
            host.startsWith("[::1]")
        return (if (local) "http://" else "https://") + trimmed
    }
}
