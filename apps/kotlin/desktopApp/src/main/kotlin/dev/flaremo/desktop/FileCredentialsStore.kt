package dev.flaremo.desktop

import dev.flaremo.core.network.CredentialsStore
import dev.flaremo.core.network.InstanceCredentials
import java.io.File

/**
 * 桌面端的凭据存储：`~/.flaremo/credentials.json` 旁边的一个纯文本文件。
 *
 * 为什么不是 JSON：这一层现在只需要 5 个稳定字段，用换行分隔的纯文本
 * 读写零依赖、出错时也能用编辑器看一眼。**这是 M1 前的临时实现**：
 * - Windows 应该换 DPAPI（`CryptProtectData`）/ 系统凭据管理器；
 * - macOS 应该换 Keychain。
 * 现在至少把文件权限收成 0600，令牌不以明文进日志、不进仓库。
 */
class FileCredentialsStore(private val file: File) : CredentialsStore {
    override fun load(): InstanceCredentials? = runCatching {
        if (!file.exists()) return null
        val lines = file.readLines()
        if (lines.size < 2) return null
        val baseUrl = lines[0].trim()
        val accessToken = lines[1].trim()
        if (baseUrl.isEmpty() || accessToken.isEmpty()) return null
        InstanceCredentials(
            baseUrl = baseUrl,
            accessToken = accessToken,
            refreshToken = lines.getOrNull(2)?.trim()?.takeIf { it.isNotEmpty() },
            expiresAtEpochMillis = lines.getOrNull(3)?.trim()?.toLongOrNull(),
            clientName = lines.getOrNull(4)?.trim()?.takeIf { it.isNotEmpty() },
        )
    }.getOrNull()

    override fun save(credentials: InstanceCredentials) {
        file.parentFile?.mkdirs()
        file.writeText(
            listOf(
                credentials.baseUrl,
                credentials.accessToken,
                credentials.refreshToken.orEmpty(),
                credentials.expiresAtEpochMillis?.toString().orEmpty(),
                credentials.clientName.orEmpty(),
            ).joinToString("\n"),
        )
        // 只给当前用户读写（POSIX 权限；Windows 上由 ACL 继承兜底）。
        runCatching {
            file.setReadable(false, false)
            file.setReadable(true, true)
            file.setWritable(false, false)
            file.setWritable(true, true)
        }
    }

    override fun clear() {
        file.delete()
    }
}
