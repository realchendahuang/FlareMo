package dev.flaremo.core.db

import java.io.File
import kotlin.io.path.createTempDirectory
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 本地库的端到端行为：建库、写入、读回、软删、outbox。
 *
 * 测试只跑在 JVM 目标上（`:core-db:desktopTest`）：Android 目标要设备/模拟器，
 * 而 SQLite 语义两边完全一致（同一个 BundledSQLiteDriver）。
 */
class FlareMoDatabaseTest {
    private val directory: File = createTempDirectory("flaremo-db-test").toFile()
    private val database = FlareMoDatabase(File(directory, "library.sqlite").absolutePath)
    private val repository = SqliteMemoRepository(database)

    @AfterTest
    fun tearDown() {
        database.close()
        directory.deleteRecursively()
    }

    @Test
    fun `新建的速记会落库并出现在列表里`() {
        val created = repository.create("第一条速记")
        assertEquals(1, repository.count())
        val listed = repository.list()
        assertEquals(1, listed.size)
        assertEquals(created.id, listed.first().id)
        assertEquals("第一条速记", listed.first().content)
        // 客户端的 id 是 UUIDv7（时间有序，36 字符带连字符）
        assertEquals(36, created.id.length)
        assertEquals('7', created.id[14])
    }

    @Test
    fun `写入同时入队 outbox（同步层接上之前的待办账）`() {
        repository.create("要同步的一条")
        assertEquals(1, repository.pendingSyncCount())
    }

    @Test
    fun `置顶会改变排序并落库`() {
        val first = repository.create("先写的")
        repository.create("后写的")
        repository.setPinned(first.id, true)

        val listed = repository.list()
        assertEquals(first.id, listed.first().id, "置顶的应当排在最前")
        assertTrue(listed.first().pinned)
    }

    @Test
    fun `软删之后不再出现在时间线，但行还在`() {
        val memo = repository.create("会被删掉的一条")
        repository.delete(memo.id)
        assertEquals(0, repository.list().size)
        assertEquals(0, repository.count())
    }

    @Test
    fun `重开数据库能读回之前写的数据`() {
        repository.create("跨重启还在")
        database.close()

        val reopened = FlareMoDatabase(File(directory, "library.sqlite").absolutePath)
        try {
            val listed = SqliteMemoRepository(reopened).list()
            assertEquals(1, listed.size)
            assertEquals("跨重启还在", listed.first().content)
        } finally {
            reopened.close()
        }
    }
}
