package dev.flaremo.core.db

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import dev.flaremo.core.model.Memo

/**
 * 本地 SQLite（androidx.sqlite + BundledSQLiteDriver）。
 *
 * 连接参数照 §7.7 的五条 PRAGMA：
 * - `journal_mode=WAL`：读写并发（一个写连接 + 多个读）
 * - `synchronous=FULL`：速记是「打完字就合盖」的场景，宁可多一次 fsync 也不能丢
 * - `foreign_keys=ON`、`busy_timeout=5000`、`temp_store=MEMORY`
 *
 * SQLite 由 BundledSQLiteDriver 自带，版本钉在依赖里，不依赖系统/ROM 的版本。
 */
class FlareMoDatabase(private val path: String) {
    private val connection: SQLiteConnection = BundledSQLiteDriver().open(path)

    init {
        configure()
        migrateIfNeeded()
        createSchema()
    }

    // MARK: 连接参数

    private fun configure() {
        exec("PRAGMA journal_mode=WAL")
        exec("PRAGMA synchronous=FULL")
        exec("PRAGMA foreign_keys=ON")
        exec("PRAGMA busy_timeout=5000")
        exec("PRAGMA temp_store=MEMORY")
    }

    /** 本地库是副本，不做迁移：版本不一致就整库重建（§7.7）。 */
    private fun migrateIfNeeded() {
        val current = queryLong("PRAGMA user_version")
        if (current != 0L && current != SCHEMA_VERSION.toLong()) {
            exec("DROP TABLE IF EXISTS memos")
            exec("DROP TABLE IF EXISTS outbox")
            exec("DROP TABLE IF EXISTS sync_state")
        }
        exec("PRAGMA user_version=$SCHEMA_VERSION")
    }

    private fun createSchema() {
        exec(Schema.CREATE_MEMOS)
        exec(Schema.CREATE_MEMOS_TIMELINE_INDEX)
        exec(Schema.CREATE_OUTBOX)
        exec(Schema.CREATE_SYNC_STATE)
        exec(Schema.SEED_SYNC_STATE)
    }

    // MARK: 读

    fun listMemos(limit: Int = 200): List<Memo> {
        val sql = """
            SELECT id, content, pinned, tags, created_at, updated_at
            FROM memos
            WHERE status = 'normal' AND deleted_at IS NULL
            ORDER BY pinned DESC, created_at DESC, id DESC
            LIMIT ?
        """
        val statement = connection.prepare(sql)
        try {
            statement.bindInt(1, limit)
            val result = mutableListOf<Memo>()
            while (statement.step()) {
                val tagsRaw = statement.getText(3)
                result += Memo(
                    id = statement.getText(0),
                    content = statement.getText(1),
                    createdAt = statement.getText(4),
                    updatedAt = statement.getText(5),
                    pinned = statement.getInt(2) != 0,
                    tags = if (tagsRaw.isEmpty()) emptyList() else tagsRaw.split('\n'),
                )
            }
            return result
        } finally {
            statement.close()
        }
    }

    fun countMemos(): Int = queryLong(
        "SELECT COUNT(*) FROM memos WHERE status = 'normal' AND deleted_at IS NULL",
    ).toInt()

    fun pendingOutboxCount(): Int = queryLong("SELECT COUNT(*) FROM outbox").toInt()

    // MARK: 写

    /** 新建一条速记：实体 + outbox 在同一个事务里提交（§7.7 写入路径）。 */
    fun insertMemo(
        id: String,
        content: String,
        tags: List<String>,
        now: String,
        source: String,
    ) {
        exec("BEGIN IMMEDIATE")
        try {
            val tagsRaw = tags.joinToString("\n")
            val insert = connection.prepare(
                """
                INSERT INTO memos (id, content, status, pinned, source, tags, created_at, updated_at, version)
                VALUES (?, ?, 'normal', 0, ?, ?, ?, ?, 1)
                """,
            )
            try {
                insert.bindText(1, id)
                insert.bindText(2, content)
                insert.bindText(3, source)
                insert.bindText(4, tagsRaw)
                insert.bindText(5, now)
                insert.bindText(6, now)
                insert.step()
            } finally {
                insert.close()
            }

            val enqueue = connection.prepare(
                """
                INSERT INTO outbox (id, op, entity, entity_id, payload, idempotency_key, attempts, next_attempt_at, created_at)
                VALUES (?, 'create', 'memo', ?, '{}', ?, 0, ?, ?)
                """,
            )
            try {
                enqueue.bindText(1, Ids.uuidV7())
                enqueue.bindText(2, id)
                enqueue.bindText(3, id) // 幂等键 = 实体 id（与服务端 client_id 对齐）
                enqueue.bindText(4, now)
                enqueue.bindText(5, now)
                enqueue.step()
            } finally {
                enqueue.close()
            }
            exec("COMMIT")
        } catch (error: Throwable) {
            exec("ROLLBACK")
            throw error
        }
    }

    fun setPinned(id: String, pinned: Boolean) {
        val statement = connection.prepare(
            "UPDATE memos SET pinned = ?, updated_at = ?, version = version + 1 WHERE id = ?",
        )
        try {
            statement.bindInt(1, if (pinned) 1 else 0)
            statement.bindText(2, nowIso())
            statement.bindText(3, id)
            statement.step()
        } finally {
            statement.close()
        }
    }

    /** 软删：镜像服务端的 tombstone 语义（status + deleted_at + version）。 */
    fun softDelete(id: String) {
        val now = nowIso()
        val statement = connection.prepare(
            "UPDATE memos SET status = 'trashed', deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?",
        )
        try {
            statement.bindText(1, now)
            statement.bindText(2, now)
            statement.bindText(3, id)
            statement.step()
        } finally {
            statement.close()
        }
    }

    fun close() {
        connection.close()
    }

    // MARK: 内部

    private fun exec(sql: String) {
        val statement = connection.prepare(sql)
        try {
            statement.step()
        } finally {
            statement.close()
        }
    }

    private fun queryLong(sql: String): Long {
        val statement = connection.prepare(sql)
        return try {
            if (statement.step()) statement.getLong(0) else 0L
        } finally {
            statement.close()
        }
    }
}
