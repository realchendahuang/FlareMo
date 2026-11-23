package dev.flaremo.android

import android.content.Context
import dev.flaremo.core.network.CredentialsStore
import dev.flaremo.core.network.InstanceCredentials

/**
 * Android 的凭据存储：`SharedPreferences` 明文。
 *
 * **这是 M1 前的临时实现**（任务里明确允许）：M1 换
 * `EncryptedSharedPreferences`（androidx.security-crypto）或 `EncryptedFile`。
 * 现在至少：不写日志、不导出（`allowBackup="false"` 见 manifest）、不放进仓库。
 * 配对 UI 这一版只在桌面端，Android 通过同一份 SharedPreferences 键位
 * （可用 `adb shell` 预置）参与联调，M1 补手机端配对入口。
 */
class AndroidCredentialsStore(context: Context) : CredentialsStore {
    private val preferences =
        context.getSharedPreferences("flaremo_credentials", Context.MODE_PRIVATE)

    override fun load(): InstanceCredentials? {
        val baseUrl = preferences.getString(KEY_BASE_URL, null) ?: return null
        val accessToken = preferences.getString(KEY_ACCESS_TOKEN, null) ?: return null
        if (baseUrl.isBlank() || accessToken.isBlank()) return null
        return InstanceCredentials(
            baseUrl = baseUrl,
            accessToken = accessToken,
            refreshToken = preferences.getString(KEY_REFRESH_TOKEN, null),
            expiresAtEpochMillis = preferences.getLong(KEY_EXPIRES_AT, 0L).takeIf { it > 0L },
            clientName = preferences.getString(KEY_CLIENT_NAME, null),
        )
    }

    override fun save(credentials: InstanceCredentials) {
        preferences.edit()
            .putString(KEY_BASE_URL, credentials.baseUrl)
            .putString(KEY_ACCESS_TOKEN, credentials.accessToken)
            .putString(KEY_REFRESH_TOKEN, credentials.refreshToken)
            .putLong(KEY_EXPIRES_AT, credentials.expiresAtEpochMillis ?: 0L)
            .putString(KEY_CLIENT_NAME, credentials.clientName)
            .apply()
    }

    override fun clear() {
        preferences.edit().clear().apply()
    }

    private companion object {
        const val KEY_BASE_URL = "base_url"
        const val KEY_ACCESS_TOKEN = "access_token"
        const val KEY_REFRESH_TOKEN = "refresh_token"
        const val KEY_EXPIRES_AT = "expires_at"
        const val KEY_CLIENT_NAME = "client_name"
    }
}
