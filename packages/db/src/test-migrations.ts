import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Minimal structural view of the D1 binding used by tests (Miniflare's
 * `getD1Database()` result and the Workers `D1Database` global both satisfy
 * it). Keeps this module dependency-free.
 */
export interface FlaremoMigrationDatabase {
  prepare(query: string): { run(): Promise<unknown> };
}

interface MigrationJournalEntry {
  tag: string;
}

interface MigrationJournal {
  entries: MigrationJournalEntry[];
}

type LoadedMigration = { tag: string; statements: string[] };

let migrationsCache: LoadedMigration[] | undefined;

/**
 * Resolved relative to this source file so the helper works from any
 * workspace package under vitest: <repo>/packages/db/src -> <repo>/migrations.
 */
function migrationsDirectory(): string {
  return fileURLToPath(new URL("../../../migrations/", import.meta.url));
}

function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function loadFlaremoMigrations(): Promise<LoadedMigration[]> {
  if (migrationsCache) return migrationsCache;
  const directory = migrationsDirectory();
  const journal = JSON.parse(
    await readFile(`${directory}/meta/_journal.json`, "utf8"),
  ) as MigrationJournal;
  const migrations = await Promise.all(
    journal.entries.map(async (entry) => ({
      tag: entry.tag,
      statements: splitStatements(
        await readFile(`${directory}/${entry.tag}.sql`, "utf8"),
      ),
    })),
  );
  migrationsCache = migrations;
  return migrations;
}

export interface ApplyFlaremoMigrationsOptions {
  /**
   * Only apply migrations whose journal tag is strictly before this tag
   * (lexicographic, matching the zero-padded drizzle tags).
   */
  beforeTag?: string;
  /**
   * Only apply migrations whose journal tag is greater than or equal to this
   * tag (lexicographic).
   */
  fromTag?: string;
}

/**
 * Applies the full drizzle migration list from <repo>/migrations, in journal
 * order, to the given D1 database. Tests must call this instead of hand-rolled
 * migration lists so schema drift cannot accumulate between suites.
 *
 * The migration set is read from the drizzle journal, so a newly generated
 * migration is picked up automatically with no per-test edits.
 */
export async function applyFlaremoMigrations(
  database: FlaremoMigrationDatabase,
  options: ApplyFlaremoMigrationsOptions = {},
): Promise<void> {
  const { beforeTag, fromTag } = options;
  const migrations = await loadFlaremoMigrations();
  for (const migration of migrations) {
    if (beforeTag !== undefined && !(migration.tag < beforeTag)) continue;
    if (fromTag !== undefined && !(migration.tag >= fromTag)) continue;
    for (const statement of migration.statements) {
      await database.prepare(statement).run();
    }
  }
}
