import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildOrderedDataRestore,
  RESTORE_TABLES,
} from "./persistence-manifest.mjs";

/**
 * `buildOrderedDataRestore` replays the D1 dump into a freshly migrated
 * database. Migration 0049 puts AFTER INSERT/UPDATE/DELETE triggers on memos,
 * attachments, articles and memo_relations that append to `sync_changes`, and
 * the derived-restore SQL updates every memo. Replaying `sync_changes` in the
 * normal order therefore restored 67 rows from a 26-row source: the entity
 * replay had already fabricated 41 changes with fresh `seq` values, which would
 * hand every native client a page of changes that never happened.
 *
 * The fix replays `sync_changes` after everything else, cleared first. These
 * tests pin that ordering, because a reordering looks harmless in review.
 */

function lineIndex(lines, predicate) {
  return lines.findIndex(predicate);
}

const DUMP = [
  "INSERT INTO \"users\" VALUES('u1', '2026-01-01T00:00:00.000Z');",
  "INSERT INTO \"sync_changes\" VALUES(1,'u1','memo','memos/a','insert',1,'2026-01-01T00:00:00.000Z');",
  "INSERT INTO \"sync_changes\" VALUES(2,'u1','memo','memos/b','insert',1,'2026-01-01T00:00:01.000Z');",
].join("\n");

const lines = buildOrderedDataRestore(DUMP).split("\n");

test("sync_changes is replayed after the derived restore SQL", () => {
  const derivedUpdate = lineIndex(lines, (line) =>
    line.startsWith("UPDATE `memos`"),
  );
  assert.notEqual(derivedUpdate, -1, "derived restore SQL should be present");

  const syncInsert = lineIndex(lines, (line) =>
    line.startsWith('INSERT INTO "sync_changes" '),
  );
  assert.notEqual(syncInsert, -1, "sync_changes rows should be replayed");
  assert.ok(
    syncInsert > derivedUpdate,
    "sync_changes must be replayed after the derived SQL, or the memo UPDATE trigger appends fabricated rows",
  );
});

test("sync_changes is cleared immediately before its own replay", () => {
  const inserts = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.startsWith('INSERT INTO "sync_changes" '));
  assert.equal(inserts.length, 2, "every backed-up row should be replayed");

  const firstInsert = inserts[0].index;
  const clearBefore = lines
    .slice(0, firstInsert)
    .filter((line) => line === "DELETE FROM `sync_changes`;");
  // Two clears on purpose: the first comes from the shared "clear every
  // source table" loop, the second removes the rows the entity triggers and
  // the derived SQL just fabricated. One alone is not enough.
  assert.equal(
    clearBefore.length,
    2,
    "the trigger-fabricated rows must be cleared before the replay",
  );
});

test("sync_changes is not replayed in the source-table loop", () => {
  const derivedUpdate = lineIndex(lines, (line) =>
    line.startsWith("UPDATE `memos`"),
  );
  const early = lines
    .slice(0, derivedUpdate)
    .filter((line) => line.startsWith('INSERT INTO "sync_changes" '));
  assert.deepEqual(
    early,
    [],
    "an early replay is exactly the bug: the entity triggers then append to it",
  );
});

test("no other table is deferred, and every restore table is cleared first", () => {
  const deferred = new Set();
  for (const table of RESTORE_TABLES) {
    const clears = lines.filter((line) => line === `DELETE FROM \`${table}\`;`);
    if (clears.length > 1) deferred.add(table);
    assert.ok(
      clears.length >= 1,
      `${table} should be cleared before the replay so the restore is idempotent`,
    );
  }
  assert.deepEqual(
    [...deferred],
    ["sync_changes"],
    "only trigger-fed tables should be double-cleared",
  );
});
