import Foundation
import GRDB

/// 本文件负责：本地库的 DDL —— 事实层 + 本地表 + 派生层（FTS5 trigram）。
///
/// **本地库是服务端 D1 的副本，不做迁移链**（docs/native-clients.md §7.7
/// 「冲突与重建」）：结构一旦变化就 bump 版本、保留 outbox、整库重建、再全量
/// 对齐。因此这里的 DDL 是「当前形态」的一次性描述，不写 ALTER TABLE 链。
///
/// 列/类型/默认值的来源：
/// - `packages/db/src/schema/memos.ts`、`content.ts`、`tasks.ts`、
///   `rows.ts`（当前 D1 事实源）；
/// - `migrations/*.sql` 里各表的最终建表形态；
/// - 迁移 **0048**（docs/native-clients.md §4.3）：`memos.version` /
///   `attachments.version` / `articles.version` / `memo_relations.updated_at`。
///   0048 是 M0 的产物，本地 v1 直接按「0048 之后」的形态建库，这样
///   `expected_version` 乐观锁与 `sync_changes.version` 都有落点。
///
/// 与 D1 的**有意差异**（都在注释里写明理由）：
/// 1. 不声明外键：本地没有 `users` / `projects` 父表，而事实层是同步写进来的
///    副本，hydrate 分批可能出现「子行先到」；完整性由服务端与同步契约保证。
///    `PRAGMA foreign_keys=ON` 仍然开着，留给本地表与将来可能的本地父子关系。
/// 2. 索引只保留本地查询真正用得到的那些（D1 的配额/清理/SSE 索引本地无意义），
///    另加少量 local-only 索引（如时间线排序），见各行注释。
public enum DatabaseSchema {
    /// 事实层 + 本地表的结构版本。任何 DDL 变化都要 +1（触发整库重建）。
    public static let version = 1

    /// 派生层（FTS）的结构版本。只影响 `memos_fts` 的定义时 +1，触发派生层
    /// 「整层删掉重建」（§7.7「派生层不许出现无法重算的数据」）。存进
    /// `PRAGMA application_id`，不额外发明表。
    public static let derivedVersion = 1

    /// 派生层 FTS5 虚表名（与服务端同名，便于对照）。
    public static let ftsTableName = "memos_fts"

    /// 事实层表（按同步契约的四类实体 + 任务）。
    public static let factTableNames = [
        "memo_relations", "attachments", "articles", "tasks", "memos",
    ]

    // MARK: - 建库

    /// 创建事实层 + 本地表，并把 `PRAGMA user_version` 写成当前结构版本。
    /// 调用方负责把它放进事务里。
    public static func createBaseTables(_ db: Database, version: Int = version) throws {
        // MARK: ① 事实层：memos
        // 对应 packages/db/src/schema/memos.ts + 迁移 0003(client_id) /
        // 0012(embedding_*) / 0019(embedding_chunks) / 0020(team_id) /
        // 0048(version)。D1 的 `pinned DEFAULT false` 在 SQLite 里就是 0。
        try db.execute(
            sql: """
                CREATE TABLE IF NOT EXISTS memos (
                    id text PRIMARY KEY NOT NULL,
                    user_id text NOT NULL,
                    team_id text,
                    content text NOT NULL,
                    visibility text NOT NULL DEFAULT 'private',
                    status text NOT NULL DEFAULT 'normal',
                    pinned integer NOT NULL DEFAULT 0,
                    source text NOT NULL DEFAULT 'web',
                    client_id text,
                    payload text NOT NULL DEFAULT '{}',
                    created_at text NOT NULL,
                    updated_at text NOT NULL,
                    deleted_at text,
                    embedding_status text NOT NULL DEFAULT 'not_indexed',
                    embedding_version text,
                    embedded_at text,
                    embedding_error text,
                    embedding_chunks integer,
                    version integer NOT NULL DEFAULT 1
                )
                """)
        try db.execute(
            sql: """
                CREATE UNIQUE INDEX IF NOT EXISTS memos_user_client_id_idx
                    ON memos (user_id, client_id)
                """)
        try db.execute(
            sql: """
                CREATE INDEX IF NOT EXISTS memos_user_status_pinned_created_id_idx
                    ON memos (user_id, status, pinned, created_at, id)
                """)
        try db.execute(
            sql: """
                CREATE INDEX IF NOT EXISTS memos_user_created_id_idx
                    ON memos (user_id, created_at, id)
                """)
        try db.execute(
            sql: """
                CREATE INDEX IF NOT EXISTS memos_user_updated_id_idx
                    ON memos (user_id, updated_at, id)
                """)
        // local-only：本地库是「当前用户可见的一整份副本」，查询不再带 user_id
        // 前缀（团队空间的行 user_id 是作者而非当前用户），因此给时间线排序
        // 建一个真正能被 seek 的索引。
        try db.execute(
            sql: """
                CREATE INDEX IF NOT EXISTS memos_status_pinned_created_id_idx
                    ON memos (status, pinned, created_at, id)
                """)

        // MARK: ① 事实层：memo_relations（评论 = memo 行 + 本表的 comment 关系）
        // 迁移 0000 建表（联合主键）+ 0048 加 updated_at。
        try db.execute(
            sql: """
                CREATE TABLE IF NOT EXISTS memo_relations (
                    memo_id text NOT NULL,
                    related_memo_id text NOT NULL,
                    type text NOT NULL DEFAULT 'reference',
                    created_at text NOT NULL,
                    updated_at text NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
                    PRIMARY KEY (memo_id, related_memo_id, type)
                )
                """)
        try db.execute(
            sql: """
                CREATE INDEX IF NOT EXISTS memo_relations_related_type_memo_idx
                    ON memo_relations (related_memo_id, type, memo_id)
                """)

        // MARK: ① 事实层：attachments（只存元数据）
        // content.ts + 0002(state/etag) / 0004(client_id) / 0029(article_id) /
        // 0041(thumbnail_size) / 0048(version)。
        try db.execute(
            sql: """
                CREATE TABLE IF NOT EXISTS attachments (
                    id text PRIMARY KEY NOT NULL,
                    user_id text NOT NULL,
                    memo_id text,
                    article_id text,
                    r2_key text NOT NULL,
                    filename text NOT NULL,
                    content_type text,
                    size integer NOT NULL DEFAULT 0,
                    thumbnail_size integer NOT NULL DEFAULT 0,
                    state text NOT NULL DEFAULT 'ready',
                    client_id text,
                    etag text,
                    payload text NOT NULL DEFAULT '{}',
                    created_at text NOT NULL,
                    updated_at text NOT NULL,
                    deleted_at text,
                    version integer NOT NULL DEFAULT 1
                )
                """)
        try db.execute(
            sql: """
                CREATE UNIQUE INDEX IF NOT EXISTS attachments_user_client_id_idx
                    ON attachments (user_id, client_id)
                """)
        try db.execute(
            sql: """
                CREATE INDEX IF NOT EXISTS attachments_user_created_idx
                    ON attachments (user_id, created_at)
                """)
        try db.execute(
            sql: """
                CREATE INDEX IF NOT EXISTS attachments_memo_created_idx
                    ON attachments (memo_id, created_at)
                """)
        try db.execute(
            sql: """
                CREATE INDEX IF NOT EXISTS attachments_article_idx
                    ON attachments (article_id)
                """)

        // MARK: ① 事实层：articles
        // content.ts + 0029 建表 + 0048(version)。
        try db.execute(
            sql: """
                CREATE TABLE IF NOT EXISTS articles (
                    id text PRIMARY KEY NOT NULL,
                    user_id text NOT NULL,
                    team_id text,
                    slug text NOT NULL,
                    title text NOT NULL,
                    description text,
                    content text NOT NULL,
                    status text NOT NULL DEFAULT 'draft',
                    cover_attachment_id text,
                    lang text,
                    published_at text,
                    created_at text NOT NULL,
                    updated_at text NOT NULL,
                    deleted_at text,
                    version integer NOT NULL DEFAULT 1
                )
                """)
        try db.execute(
            sql: """
                CREATE UNIQUE INDEX IF NOT EXISTS articles_slug_idx
                    ON articles (slug)
                """)
        try db.execute(
            sql: """
                CREATE INDEX IF NOT EXISTS articles_user_status_updated_idx
                    ON articles (user_id, status, updated_at)
                """)

        // MARK: ① 事实层：tasks
        // tasks.ts + 迁移 0025（project_id 放宽为可空、新增 source_memo_id /
        // deleted_at）。tasks 没有 version 列：它不参与 0048 的乐观锁。
        try db.execute(
            sql: """
                CREATE TABLE IF NOT EXISTS tasks (
                    id text PRIMARY KEY NOT NULL,
                    user_id text NOT NULL,
                    project_id text,
                    source_memo_id text,
                    title text NOT NULL,
                    notes text,
                    status text NOT NULL DEFAULT 'todo',
                    priority text NOT NULL DEFAULT 'none',
                    due_at text,
                    sort_order integer NOT NULL DEFAULT 0,
                    completed_at text,
                    deleted_at text,
                    created_at text NOT NULL,
                    updated_at text NOT NULL
                )
                """)
        try db.execute(
            sql: """
                CREATE INDEX IF NOT EXISTS tasks_user_project_status_sort_idx
                    ON tasks (user_id, project_id, status, sort_order)
                """)
        try db.execute(
            sql: """
                CREATE INDEX IF NOT EXISTS tasks_user_due_idx ON tasks (user_id, due_at)
                """)
        try db.execute(
            sql: """
                CREATE INDEX IF NOT EXISTS tasks_recycle_sweep_idx
                    ON tasks (deleted_at) WHERE deleted_at IS NOT NULL
                """)

        // MARK: ③ 本地表：outbox（列集合见 §7.7「写入路径」）
        try db.execute(
            sql: """
                CREATE TABLE IF NOT EXISTS outbox (
                    id text PRIMARY KEY NOT NULL,
                    op text NOT NULL,
                    entity text NOT NULL,
                    entity_id text NOT NULL,
                    payload text NOT NULL DEFAULT '{}',
                    idempotency_key text NOT NULL,
                    depends_on text,
                    attempts integer NOT NULL DEFAULT 0,
                    next_attempt_at text,
                    created_at text NOT NULL
                )
                """)
        // local-only：同一个幂等键只应存在一条待上送行（防重复入队）。
        try db.execute(
            sql: """
                CREATE UNIQUE INDEX IF NOT EXISTS outbox_idempotency_key_idx
                    ON outbox (idempotency_key)
                """)
        // local-only：单写者取下一批的排序键。
        try db.execute(
            sql: """
                CREATE INDEX IF NOT EXISTS outbox_pending_idx
                    ON outbox (next_attempt_at, created_at, id)
                """)

        // MARK: ③ 本地表：sync_state（单行水位）
        // seq 覆盖四类实体的一个单调游标（§4.4）；generation 换代标记（410 /
        // 整库重建）；最后拉取/推送时间用于诊断。
        try db.execute(
            sql: """
                CREATE TABLE IF NOT EXISTS sync_state (
                    id integer PRIMARY KEY CHECK (id = 1),
                    seq integer NOT NULL DEFAULT 0,
                    generation integer NOT NULL DEFAULT 0,
                    last_pull_at text,
                    last_push_at text
                )
                """)
        try db.execute(
            sql: """
                INSERT OR IGNORE INTO sync_state (id, seq, generation) VALUES (1, 0, 0)
                """)

        // MARK: ③ 本地表：blobs（文件系统里的二进制的元数据）
        try db.execute(
            sql: """
                CREATE TABLE IF NOT EXISTS blobs (
                    sha256 text PRIMARY KEY NOT NULL,
                    bytes integer NOT NULL DEFAULT 0,
                    mime text,
                    remote_key text,
                    state text NOT NULL DEFAULT 'staged',
                    last_used_at text
                )
                """)
        // local-only：LRU 淘汰候选扫描。
        try db.execute(
            sql: """
                CREATE INDEX IF NOT EXISTS blobs_state_last_used_idx
                    ON blobs (state, last_used_at)
                """)

        try db.execute(sql: "PRAGMA user_version = \(version)")
    }

    // MARK: - 派生层

    /// 确保 `memos_fts`（FTS5 + trigram）与同步触发器存在且版本正确。
    ///
    /// 为什么用 external content（`content='memos'`）：派生层不许存无法重算的
    /// 数据（§7.7）；GRDB 的 `synchronize(withTable:)` 会建 external content 虚表
    /// 和 `AFTER INSERT/UPDATE/DELETE` 三个触发器，正文只有一份（`memos.content`）。
    ///
    /// 为什么是 trigram：服务端 `memos_fts` 用 unicode61，CJK 连续文本被当单
    /// token，中文实际走 LIKE 降级；本地改用 trigram 后中文 ≥3 字能走索引，
    /// **<3 字符仍降级 LIKE**（§5.4 硬约束，M1 验收「中文两字搜索」）。
    public static func ensureDerivedLayer(_ db: Database, version: Int = derivedVersion) throws {
        let currentVersion = try Int.fetchOne(db, sql: "PRAGMA application_id") ?? 0
        let ftsExists = try tableExists(db, ftsTableName)
        if ftsExists && currentVersion == version {
            return
        }
        if ftsExists {
            // 派生层整层删除重建（版本变了就说明定义变了）。
            try db.dropFTS5SynchronizationTriggers(forTable: ftsTableName)
            try db.execute(sql: "DROP TABLE \(ftsTableName)")
        }
        try db.create(virtualTable: ftsTableName, using: FTS5()) { table in
            table.tokenizer = FTS5TokenizerDescriptor(components: ["trigram"])
            table.column("content")
            table.synchronize(withTable: "memos")
        }
        try db.execute(sql: "PRAGMA application_id = \(version)")
    }

    /// 清空事实层（收到 410 / 需要全量对齐时调用）。
    ///
    /// 保留 outbox 与 blobs：本地未上送的写与未确认的文件不能因为服务端历史被
    /// 裁剪而丢（§7.7「收到 410 → generation++ → 清空事实层（保留 outbox）→
    /// 全量对齐」）。FTS 由外部内容表的删除触发器跟随清空，再 rebuild 兜底。
    public static func clearFactLayer(_ db: Database) throws {
        for table in factTableNames {
            try db.execute(sql: "DELETE FROM \(table)")
        }
        if try tableExists(db, ftsTableName) {
            try db.execute(sql: "INSERT INTO \(ftsTableName)(\(ftsTableName)) VALUES('rebuild')")
        }
    }

    // MARK: - 工具

    static func tableExists(_ db: Database, _ name: String) throws -> Bool {
        try db.tableExists(name)
    }
}
