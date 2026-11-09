package dev.flaremo.core.db

/**
 * 本地库 DDL。
 *
 * 与 Apple 端 `FlareMoCore/Database/DatabaseSchema.swift`、以及服务端 D1 的 memos 表
 * 保持同一批列名与语义（软删 `deleted_at`、`version` 乐观锁、ISO 毫秒文本时间）。
 *
 * 本地库是副本：**不写迁移链**。schema 变了就 bump [SCHEMA_VERSION]，
 * 打开时发现版本不一致 → 整库重建（§7.7）。
 */
internal const val SCHEMA_VERSION = 2

internal object Schema {
    const val CREATE_MEMOS = """
        CREATE TABLE IF NOT EXISTS memos (
            id         TEXT PRIMARY KEY NOT NULL,
            content    TEXT NOT NULL,
            status     TEXT NOT NULL DEFAULT 'normal',
            pinned     INTEGER NOT NULL DEFAULT 0,
            source     TEXT NOT NULL DEFAULT 'native',
            tags       TEXT NOT NULL DEFAULT '',
            payload    TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            version    INTEGER NOT NULL DEFAULT 1
        )
    """

    const val CREATE_MEMOS_TIMELINE_INDEX = """
        CREATE INDEX IF NOT EXISTS memos_timeline_idx
        ON memos (status, pinned DESC, created_at DESC, id DESC)
    """

    /** 待上送队列。列与 Apple 端一致，同步层两端共用同一套语义。 */
    const val CREATE_OUTBOX = """
        CREATE TABLE IF NOT EXISTS outbox (
            id              TEXT PRIMARY KEY NOT NULL,
            op              TEXT NOT NULL,
            entity          TEXT NOT NULL,
            entity_id       TEXT NOT NULL,
            payload         TEXT NOT NULL DEFAULT '{}',
            idempotency_key TEXT NOT NULL UNIQUE,
            depends_on      TEXT,
            attempts        INTEGER NOT NULL DEFAULT 0,
            next_attempt_at TEXT,
            created_at      TEXT NOT NULL
        )
    """

    /** 单行水位：`seq` 覆盖四类实体的一个单调游标；`generation` 是换代标记。 */
    const val CREATE_SYNC_STATE = """
        CREATE TABLE IF NOT EXISTS sync_state (
            id           INTEGER PRIMARY KEY CHECK (id = 1),
            seq          INTEGER NOT NULL DEFAULT 0,
            generation   INTEGER NOT NULL DEFAULT 0,
            last_pull_at TEXT,
            last_push_at TEXT
        )
    """

    const val SEED_SYNC_STATE = """
        INSERT OR IGNORE INTO sync_state (id, seq, generation) VALUES (1, 0, 0)
    """

    /**
     * 通用键值设置：实例地址、上次同步时间、配对登记的名字等。
     * 令牌不放这里（平台各自的安全存储），这张表只存非秘密的同步元数据。
     */
    const val CREATE_APP_SETTINGS = """
        CREATE TABLE IF NOT EXISTS app_settings (
            key   TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        )
    """
}
