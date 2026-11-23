package dev.flaremo.core.db

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteStatement
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import dev.flaremo.core.model.Memo
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * 本地 SQLite（androidx.sqlite + BundledSQLiteDriver）。
 *
 * 连接参数照 §7.7 的五条 PRAGMA：
 * - `journal_mode=WAL`：读写并发（一个写连接 + 多个读）
 * - `synchronous=FULL`：速记是「打完字就合盖」的场景，宁可多一次 fsync 也不能丢
 * - `foreign_keys=ON`、`busy_timeout=5000`、`temp_store=MEMORY`
 *
 * SQLite 由 BundledSQLiteDriver 自带，版本钉在依赖里，不依赖系统/ROM 的版本。
 *
 * 本文件同时承担两类写路径（刻意分开，§7.7）：
 * - **本地写**：实体 + outbox 同一事务提交，等同步层上送；
 * - **远端落库**（[applyRemoteMemos] / [markRemoteDeleted]）：服务端已是事实，
 *   绝不产生 outbox 行，否则会无限回环。
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
            exec("DROP TABLE IF EXISTS app_settings")
        }
        exec("PRAGMA user_version=$SCHEMA_VERSION")
    }

    private fun createSchema() {
        exec(Schema.CREATE_MEMOS)
        exec(Schema.CREATE_MEMOS_TIMELINE_INDEX)
        exec(Schema.CREATE_OUTBOX)
        exec(Schema.CREATE_SYNC_STATE)
        exec(Schema.SEED_SYNC_STATE)
        exec(Schema.CREATE_APP_SETTINGS)
    }

    // MARK: 时钟（同步层/界面需要，跨模块复用同一套实现）

    fun currentIsoTimestamp(): String = nowIso()

    fun currentEpochMillis(): Long = currentTimeMillis()

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

    // MARK: 写（本地动作 = 实体 + outbox 一个事务）

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
            val insert = connection.prepare(
                """
                INSERT INTO memos (
                    id, content, status, pinned, source, tags, payload,
                    created_at, updated_at, deleted_at, version
                ) VALUES (?, ?, 'normal', 0, ?, ?, '{}', ?, ?, NULL, 1)
                """,
            )
            try {
                insert.bindText(1, id)
                insert.bindText(2, content)
                insert.bindText(3, source)
                insert.bindText(4, tags.joinToString("\n"))
                insert.bindText(5, now)
                insert.bindText(6, now)
                insert.step()
            } finally {
                insert.close()
            }

            val payload = buildJsonObject {
                // 服务端 M0 契约：POST /api/app/memos 接受客户端 id，离线创建的行
                // 同步前就能被引用；payload.client_id 是服务端的幂等键。
                put("id", id)
                put("content", content)
                put("visibility", "private")
                put("source", source)
                put("created_at", now)
                put("updated_at", now)
                putJsonObject("payload") {
                    put("client_id", id)
                    if (tags.isNotEmpty()) {
                        putJsonArray("tags") { tags.forEach { add(it) } }
                    }
                }
            }
            enqueueOutbox(
                op = "create",
                entityId = id,
                payload = payload.toString(),
                idempotencyKey = id,
                createdAt = now,
            )
            exec("COMMIT")
        } catch (error: Throwable) {
            exec("ROLLBACK")
            throw error
        }
    }

    /** 置顶 / 取消置顶：改本地 + 入 outbox（带更新前的版本号做乐观锁）。 */
    fun setPinned(id: String, pinned: Boolean) {
        exec("BEGIN IMMEDIATE")
        try {
            val version = queryMemoVersion(id)
            if (version == null) {
                exec("ROLLBACK")
                return
            }
            val now = nowIso()
            val update = connection.prepare(
                "UPDATE memos SET pinned = ?, updated_at = ?, version = version + 1 WHERE id = ?",
            )
            try {
                update.bindInt(1, if (pinned) 1 else 0)
                update.bindText(2, now)
                update.bindText(3, id)
                update.step()
            } finally {
                update.close()
            }
            val payload = buildJsonObject {
                put("pinned", pinned)
                put("expected_version", version)
            }
            enqueueOutbox(
                op = "update",
                entityId = id,
                payload = payload.toString(),
                idempotencyKey = Ids.uuidV7(),
                createdAt = now,
            )
            exec("COMMIT")
        } catch (error: Throwable) {
            exec("ROLLBACK")
            throw error
        }
    }

    /** 软删：镜像服务端的 tombstone 语义（status + deleted_at + version）。 */
    fun softDelete(id: String) {
        exec("BEGIN IMMEDIATE")
        try {
            val version = queryMemoVersion(id)
            if (version == null) {
                exec("ROLLBACK")
                return
            }
            val now = nowIso()
            val update = connection.prepare(
                """
                UPDATE memos
                SET status = 'trashed', deleted_at = ?, updated_at = ?, version = version + 1
                WHERE id = ?
                """,
            )
            try {
                update.bindText(1, now)
                update.bindText(2, now)
                update.bindText(3, id)
                update.step()
            } finally {
                update.close()
            }
            val payload = buildJsonObject {
                put("status", "trashed")
                put("expected_version", version)
            }
            enqueueOutbox(
                op = "delete",
                entityId = id,
                payload = payload.toString(),
                idempotencyKey = Ids.uuidV7(),
                createdAt = now,
            )
            exec("COMMIT")
        } catch (error: Throwable) {
            exec("ROLLBACK")
            throw error
        }
    }

    // MARK: 同步：水位

    fun syncCursor(): SyncCursor {
        val statement = connection.prepare("SELECT seq, generation FROM sync_state WHERE id = 1")
        return try {
            if (statement.step()) {
                SyncCursor(seq = statement.getInt(0), generation = statement.getInt(1))
            } else {
                SyncCursor()
            }
        } finally {
            statement.close()
        }
    }

    /** 水位只前进不后退（重放同一页不会把游标拉回去）。 */
    fun advanceSeq(nextSeq: Int) {
        val statement = connection.prepare(
            "UPDATE sync_state SET seq = ? WHERE id = 1 AND seq < ?",
        )
        try {
            statement.bindInt(1, nextSeq)
            statement.bindInt(2, nextSeq)
            statement.step()
        } finally {
            statement.close()
        }
    }

    fun recordPull(now: String = nowIso()) {
        updateTimestamp("last_pull_at", now)
    }

    fun recordPush(now: String = nowIso()) {
        updateTimestamp("last_push_at", now)
    }

    /**
     * 收到 410：换代 + 水位归零 + 清空事实层（保留 outbox 与设置），
     * 下一轮从 seq=0 全量对齐（§7.7）。
     */
    fun prepareFullResync() {
        exec("BEGIN IMMEDIATE")
        try {
            exec("UPDATE sync_state SET seq = 0, generation = generation + 1 WHERE id = 1")
            exec("DELETE FROM memos")
            exec("COMMIT")
        } catch (error: Throwable) {
            exec("ROLLBACK")
            throw error
        }
    }

    // MARK: 同步：outbox 单写者队列

    /** 取下一批可发送的行：按 created_at 串行、跳过未到重试时间的行。 */
    fun outboxNextBatch(limit: Int = 20, now: String = nowIso()): List<OutboxRow> {
        val sql = """
            SELECT o.id, o.op, o.entity, o.entity_id, o.payload, o.idempotency_key,
                   o.attempts, o.next_attempt_at, o.created_at
            FROM outbox o
            WHERE (o.next_attempt_at IS NULL OR o.next_attempt_at <= ?)
              AND (o.depends_on IS NULL OR NOT EXISTS (
                    SELECT 1 FROM outbox d WHERE d.id = o.depends_on))
            ORDER BY o.created_at, o.id
            LIMIT ?
        """
        val statement = connection.prepare(sql)
        try {
            statement.bindText(1, now)
            statement.bindInt(2, limit)
            val result = mutableListOf<OutboxRow>()
            while (statement.step()) {
                result += OutboxRow(
                    id = statement.getText(0),
                    op = statement.getText(1),
                    entity = statement.getText(2),
                    entityId = statement.getText(3),
                    payload = statement.getText(4),
                    idempotencyKey = statement.getText(5),
                    attempts = statement.getInt(6),
                    nextAttemptAt = if (statement.isNull(7)) null else statement.getText(7),
                    createdAt = statement.getText(8),
                )
            }
            return result
        } finally {
            statement.close()
        }
    }

    /** 上送成功：删行（幂等）。 */
    fun outboxComplete(id: String) {
        val statement = connection.prepare("DELETE FROM outbox WHERE id = ?")
        try {
            statement.bindText(1, id)
            statement.step()
        } finally {
            statement.close()
        }
    }

    /**
     * 上送失败：`attempts += 1`，按指数退避写 `next_attempt_at`。
     * 第 1 次失败 2s、第 2 次 4s、第 3 次 8s……上限 300s（与 Apple 端一致）。
     *
     * @return 新的失败次数；行不存在时返回 null。
     */
    fun outboxRecordFailure(id: String, now: String = nowIso()): Int? {
        val attempts = queryLong("SELECT attempts FROM outbox WHERE id = ?", id)?.toInt() ?: return null
        val nextAttempt = attempts + 1
        val delaySeconds = backoffSecondsFor(nextAttempt)
        val statement = connection.prepare(
            "UPDATE outbox SET attempts = ?, next_attempt_at = ? WHERE id = ?",
        )
        try {
            statement.bindInt(1, nextAttempt)
            statement.bindText(2, isoPlusSeconds(now, delaySeconds))
            statement.bindText(3, id)
            statement.step()
        } finally {
            statement.close()
        }
        return nextAttempt
    }

    private fun backoffSecondsFor(attempt: Int): Long {
        val exponent = attempt.coerceIn(1, 9)
        var value = 1L
        repeat(exponent) { value *= 2 }
        return value.coerceAtMost(300)
    }

    // MARK: 同步：远端落库（不写 outbox）

    fun applyRemoteMemos(memos: List<RemoteMemoRow>) {
        if (memos.isEmpty()) return
        exec("BEGIN IMMEDIATE")
        try {
            val statement = connection.prepare(
                """
                INSERT INTO memos (
                    id, content, status, pinned, source, tags, payload,
                    created_at, updated_at, deleted_at, version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    content    = excluded.content,
                    status     = excluded.status,
                    pinned     = excluded.pinned,
                    source     = excluded.source,
                    tags       = excluded.tags,
                    payload    = excluded.payload,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    deleted_at = excluded.deleted_at,
                    version    = excluded.version
                """,
            )
            try {
                for (memo in memos) {
                    statement.bindText(1, memo.id)
                    statement.bindText(2, memo.content)
                    statement.bindText(3, memo.status)
                    statement.bindInt(4, if (memo.pinned) 1 else 0)
                    statement.bindText(5, memo.source)
                    statement.bindText(6, memo.tags.joinToString("\n"))
                    statement.bindText(7, memo.payloadJson)
                    statement.bindText(8, memo.createdAt)
                    statement.bindText(9, memo.updatedAt)
                    if (memo.deletedAt == null) {
                        statement.bindNull(10)
                    } else {
                        statement.bindText(10, memo.deletedAt)
                    }
                    statement.bindInt(11, memo.version)
                    statement.step()
                    statement.reset()
                    statement.clearBindings()
                }
            } finally {
                statement.close()
            }
            exec("COMMIT")
        } catch (error: Throwable) {
            exec("ROLLBACK")
            throw error
        }
    }

    /** 服务端说这条没了：本地落墓碑（保留行，等 30 天清理）。 */
    fun markRemoteDeleted(ids: List<String>, now: String = nowIso()) {
        if (ids.isEmpty()) return
        exec("BEGIN IMMEDIATE")
        try {
            val statement = connection.prepare(
                """
                UPDATE memos
                SET status = 'trashed', deleted_at = ?, updated_at = ?, version = version + 1
                WHERE id = ? AND deleted_at IS NULL
                """,
            )
            try {
                for (id in ids) {
                    statement.bindText(1, now)
                    statement.bindText(2, now)
                    statement.bindText(3, id)
                    statement.step()
                    statement.reset()
                    statement.clearBindings()
                }
            } finally {
                statement.close()
            }
            exec("COMMIT")
        } catch (error: Throwable) {
            exec("ROLLBACK")
            throw error
        }
    }

    // MARK: 设置（实例地址、上次同步时间等非秘密状态的通用键值表）

    fun getSetting(key: String): String? {
        val statement = connection.prepare("SELECT value FROM app_settings WHERE key = ?")
        return try {
            statement.bindText(1, key)
            if (statement.step()) statement.getText(0) else null
        } finally {
            statement.close()
        }
    }

    fun setSetting(key: String, value: String) {
        val statement = connection.prepare(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
        )
        try {
            statement.bindText(1, key)
            statement.bindText(2, value)
            statement.step()
        } finally {
            statement.close()
        }
    }

    // MARK: 内部

    private fun enqueueOutbox(
        op: String,
        entityId: String,
        payload: String,
        idempotencyKey: String,
        createdAt: String,
    ) {
        val statement = connection.prepare(
            """
            INSERT INTO outbox (
                id, op, entity, entity_id, payload, idempotency_key,
                depends_on, attempts, next_attempt_at, created_at
            ) VALUES (?, ?, 'memo', ?, ?, ?, NULL, 0, NULL, ?)
            """,
        )
        try {
            statement.bindText(1, Ids.uuidV7())
            statement.bindText(2, op)
            statement.bindText(3, entityId)
            statement.bindText(4, payload)
            statement.bindText(5, idempotencyKey)
            statement.bindText(6, createdAt)
            statement.step()
        } finally {
            statement.close()
        }
    }

    private fun queryMemoVersion(id: String): Int? {
        val statement = connection.prepare("SELECT version FROM memos WHERE id = ?")
        return try {
            statement.bindText(1, id)
            if (statement.step()) statement.getInt(0) else null
        } finally {
            statement.close()
        }
    }

    private fun updateTimestamp(column: String, value: String) {
        val statement = connection.prepare("UPDATE sync_state SET $column = ? WHERE id = 1")
        try {
            statement.bindText(1, value)
            statement.step()
        } finally {
            statement.close()
        }
    }

    private fun queryText(sql: String, param: String): String? {
        val statement = connection.prepare(sql)
        return try {
            statement.bindText(1, param)
            if (statement.step()) statement.getText(0) else null
        } finally {
            statement.close()
        }
    }

    private fun exec(sql: String) {
        val statement: SQLiteStatement = connection.prepare(sql)
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

    private fun queryLong(sql: String, param: String): Long? {
        val statement = connection.prepare(sql)
        return try {
            statement.bindText(1, param)
            if (statement.step()) statement.getLong(0) else null
        } finally {
            statement.close()
        }
    }

    // MARK: 诊断 / 测试用的只读查询

    /** 行状态（normal / archived / trashed）；不存在返回 null。同步测试断言墓碑用。 */
    fun memoStatus(id: String): String? = queryText("SELECT status FROM memos WHERE id = ?", id)

    fun memoDeletedAt(id: String): String? =
        queryText("SELECT deleted_at FROM memos WHERE id = ?", id)

    /** outbox 全部行（测试/诊断用，按入队顺序）。 */
    fun outboxAll(): List<OutboxRow> {
        val statement = connection.prepare(
            """
            SELECT id, op, entity, entity_id, payload, idempotency_key,
                   attempts, next_attempt_at, created_at
            FROM outbox ORDER BY created_at, id
            """,
        )
        return try {
            val rows = mutableListOf<OutboxRow>()
            while (statement.step()) {
                rows += OutboxRow(
                    id = statement.getText(0),
                    op = statement.getText(1),
                    entity = statement.getText(2),
                    entityId = statement.getText(3),
                    payload = statement.getText(4),
                    idempotencyKey = statement.getText(5),
                    attempts = statement.getInt(6),
                    nextAttemptAt = if (statement.isNull(7)) null else statement.getText(7),
                    createdAt = statement.getText(8),
                )
            }
            rows
        } finally {
            statement.close()
        }
    }

    fun close() {
        connection.close()
    }
}
