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
  "auth_organizations",
  "auth_members",
  "auth_invitations",
  "memos",
  "memos_sse_events",
  "memo_tags",
  "memo_revisions",
  "memo_relations",
  "memo_review_marks",
  "reactions",
  "shortcuts",
  "memos_webhooks",
  "memos_webhook_events",
  "push_subscriptions",
  "memos_webhook_deliveries",
  "memos_notifications",
  "articles",
  "attachments",
  "shares",
  "settings",
  "voice_service_config",
  "integration_config",
  "data_tasks",
  "import_task_rows",
  "member_removal_jobs",
  "memory_items",
  "memory_revisions",
  "memory_relations",
  "memory_resource_links",
  "memory_evidence",
  "memory_events",
  "memory_rejections",
  "memory_compile_archives",
  "usage_counters",
  "projects",
  "tasks",
  "task_activity",
];

// Derived tables that must not be restored verbatim, because a stale copy
// would be indistinguishable from truth and the rebuild is cheap:
//
// - `embedding_tasks` drives the Vectorize index. Do not restore old
//   success/dead rows into an empty replacement index: POST_RESTORE_DERIVED_SQL
//   turns eligible source resources into fresh, durable reindex work instead.
// - `memo_hourly_counts` is a per-author activity aggregate whose own module
//   says `memos` is authoritative and the daily recalibration rebuilds it. The
//   restore clears the rows so the counters are recomputed from restored memos
//   rather than replayed from a dump that may predate the newest writes.
export const REBUILDABLE_TABLES = ["embedding_tasks", "memo_hourly_counts"];

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
 *
 * `memo_hourly_counts` is rebuilt here too, from the restored `memos` rows: the
 * counters are derived, and recomputing them is one grouped INSERT rather than
 * a replay that could disagree with the dumps' memos.
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
    // Inferred proposals are deliberately excluded from the vector index so an
    // unconfirmed guess can never drive an agent; recovery must not resurrect
    // them as indexable work either.
    "WHERE `status` = 'active' AND `verification` != 'inferred';",
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
    "FROM `memory_items` WHERE `status` = 'active' AND `verification` != 'inferred';",
  ].join(" "),
  "-- Rebuild the per-author activity counters from the restored memos.",
  "DELETE FROM `memo_hourly_counts`;",
  [
    "INSERT INTO `memo_hourly_counts`",
    "(`user_id`, `utc_hour`, `normal_count`, `archived_count`, `trashed_count`, `updated_at`)",
    "SELECT `user_id`, substr(`created_at`, 1, 13),",
    "       sum(CASE WHEN `status` = 'normal' THEN 1 ELSE 0 END),",
    "       sum(CASE WHEN `status` = 'archived' THEN 1 ELSE 0 END),",
    "       sum(CASE WHEN `status` = 'trashed' THEN 1 ELSE 0 END),",
    `       ${restoreNow}`,
    "FROM `memos` WHERE `created_at` IS NOT NULL",
    "GROUP BY `user_id`, substr(`created_at`, 1, 13)",
    // Buckets whose counters all landed on zero are tombstones the write path
    // prunes anyway; the domain read path treats a missing row as zero.
    "HAVING sum(CASE WHEN `status` IN ('normal', 'archived', 'trashed') THEN 1 ELSE 0 END) > 0;",
  ].join(" "),
];

export function buildOrderedDataRestore(dataDump) {
  const dumpLines = dataDump.split("\n");
  const lines = ["PRAGMA defer_foreign_keys=TRUE;"];

  // Migrations seed rows of their own (0020 backfills the default team). A
  // fresh DB is therefore not empty, so clear every source-of-truth table
  // before replaying the dump — the restore stays idempotent and replays the
  // backed-up rows verbatim instead of colliding with migration-seeded ones.
  // FKs are deferred above, so deletion order is safe.
  for (const table of RESTORE_TABLES) {
    lines.push(`DELETE FROM \`${table}\`;`);
  }

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
