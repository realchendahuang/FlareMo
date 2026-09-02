/**
 * The authoritative classification of every physical Drizzle table.
 *
 * `RESTORE_TABLES` are the D1 source of truth and must survive a disaster
 * recovery. `REBUILDABLE_TABLES` hold only work derived from that source; the
 * restore file recreates their pending work instead of restoring stale state.
 * Keep this list in dependency order because Wrangler emits one INSERT per
 * line and the recovery drills replay it into a freshly migrated database.
 */
export const RESTORE_TABLES = [
  "users",
  "auth_users",
  "auth_accounts",
  "auth_sessions",
  "auth_apikeys",
  "auth_verifications",
  "auth_user_links",
  "auth_bootstrap",
  "memos",
  "memos_sse_events",
  "memo_tags",
  "memo_revisions",
  "memo_relations",
  "reactions",
  "shortcuts",
  "memos_webhooks",
  "memos_webhook_events",
  "memos_webhook_deliveries",
  "memos_notifications",
  "attachments",
  "shares",
  "settings",
  "data_tasks",
  "memory_items",
  "memory_revisions",
  "memory_relations",
  "memory_resource_links",
  "usage_counters",
  "projects",
  "tasks",
  "task_activity",
];

// Vectorize is a derived index. Do not restore old success/dead task rows into
// an empty replacement index: POST_RESTORE_DERIVED_SQL turns eligible source
// resources into fresh, durable reindex work instead.
export const REBUILDABLE_TABLES = ["embedding_tasks"];

export const DERIVED_INDEX_TABLES = ["memos_fts", "memory_fts"];

export const ALL_CLASSIFIED_TABLES = [...RESTORE_TABLES, ...REBUILDABLE_TABLES];

export const TABLE_EXPORT_ARGS = RESTORE_TABLES.flatMap((table) => [
  "--table",
  table,
]);

const restoreNow = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/**
 * Run after source-table inserts. A restored deployment must bind a fresh or
 * explicitly cleared Vectorize index; these rows let the normal outbox rebuild
 * the index without pretending a copied D1 task status proves vectors exist.
 */
export const POST_RESTORE_DERIVED_SQL = [
  "-- Recreate durable embedding work from D1 source rows; Vectorize is derived.",
  "DELETE FROM `embedding_tasks`;",
  [
    "UPDATE `memos`",
    "SET `embedding_status` = 'pending', `embedding_version` = NULL,",
    "    `embedded_at` = NULL, `embedding_error` = NULL",
    "WHERE `status` IN ('normal', 'archived');",
  ].join(" "),
  [
    "UPDATE `memory_items`",
    "SET `embedding_status` = 'pending', `embedding_version` = NULL,",
    "    `embedded_at` = NULL, `embedding_error` = NULL",
    "WHERE `status` = 'active';",
  ].join(" "),
  [
    "INSERT INTO `embedding_tasks`",
    "(`id`, `user_id`, `resource_type`, `resource_id`, `operation`, `status`,",
    " `attempts`, `next_attempt_at`, `lease_until`, `last_error`, `created_at`, `updated_at`)",
    "SELECT 'restore:memo:' || `id`, `user_id`, 'memo', `id`, 'reindex', 'pending',",
    `       0, ${restoreNow}, NULL, NULL, ${restoreNow}, ${restoreNow}`,
    "FROM `memos` WHERE `status` IN ('normal', 'archived');",
  ].join(" "),
  [
    "INSERT INTO `embedding_tasks`",
    "(`id`, `user_id`, `resource_type`, `resource_id`, `operation`, `status`,",
    " `attempts`, `next_attempt_at`, `lease_until`, `last_error`, `created_at`, `updated_at`)",
    "SELECT 'restore:memory:' || `id`, `user_id`, 'memory', `id`, 'reindex', 'pending',",
    `       0, ${restoreNow}, NULL, NULL, ${restoreNow}, ${restoreNow}`,
    "FROM `memory_items` WHERE `status` = 'active';",
  ].join(" "),
];

export function buildOrderedDataRestore(dataDump) {
  const dumpLines = dataDump.split("\n");
  const lines = ["PRAGMA defer_foreign_keys=TRUE;"];

  for (const table of RESTORE_TABLES) {
    lines.push(
      ...dumpLines.filter(
        (line) =>
          line.startsWith(`INSERT INTO "${table}" `) ||
          line.startsWith(`INSERT INTO \`${table}\` `),
      ),
    );
  }

  lines.push(...POST_RESTORE_DERIVED_SQL);
  return `${lines.join("\n")}\n`;
}

export function buildPersistenceCountsQuery() {
  const counts = [...RESTORE_TABLES, ...DERIVED_INDEX_TABLES].map(
    (table) => `(SELECT COUNT(*) FROM \`${table}\`) AS \`${table}\``,
  );
  return `SELECT ${counts.join(", ")};`;
}

export function assertDerivedIndexesComplete(counts) {
  for (const [source, index] of [
    ["memos", "memos_fts"],
    ["memory_items", "memory_fts"],
  ]) {
    if (Number(counts[source]) !== Number(counts[index])) {
      throw new Error(
        `Derived FTS index is incomplete: ${index}=${counts[index]} ${source}=${counts[source]}`,
      );
    }
  }
}
