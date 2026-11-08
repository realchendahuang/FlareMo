package dev.flaremo.core.db

/**
 * 本地库 DDL。
 *
 * 与 Apple 端 `FlareMoCore/Database/DatabaseSchema.swift`、以及服务端 D1 的 memos 表
 * 保持同一批列名与语义（软删 `deleted_at`、`version` 乐观锁、ISO 毫秒文本时间）。
 *
 * 本地库是副本：**不写迁移链**。schema 变了就 bump [SCHEMA_VERSION]，
 * 打开时发现版本不一致 → 整库重建（outbox 里的待上送操作另存后回灌，见 §7.7）。
 */
internal const val SCHEMA_VERSION = 1

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

    /** 待上送队列。列与 Apple 端一致，同步层将来两端共用同一套语义。 */
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
            next_attempt_at TEXT NOT NULL,
            created_at      TEXT NOT NULL
        )
    """

    /** 同步水位：单行表（id 恒为 1）。 */
    const val CREATE_SYNC_STATE = """
        CREATE TABLE IF NOT EXISTS sync_state (
            id            INTEGER PRIMARY KEY CHECK (id = 1),
            seq           INTEGER NOT NULL DEFAULT 0,
            generation    INTEGER NOT NULL DEFAULT 0,
            last_pull_at  TEXT,
            last_push_at  TEXT
        )
    """

    const val SEED_SYNC_STATE = """
        INSERT OR IGNORE INTO sync_state (id, seq, generation) VALUES (1, 0, 0)
    """
}
