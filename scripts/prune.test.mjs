import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_DRILL_KEEP,
  parseKeepCount,
  pruneDrillBackups,
  selectDrillDirectoriesToRemove,
} from "./lib/prune.mjs";

test("parseKeepCount keeps valid counts and falls back on garbage", () => {
  assert.equal(parseKeepCount("3"), 3);
  assert.equal(parseKeepCount(" 0 "), 0);
  assert.equal(parseKeepCount(undefined), DEFAULT_DRILL_KEEP);
  assert.equal(parseKeepCount(""), DEFAULT_DRILL_KEEP);
  assert.equal(parseKeepCount("abc"), DEFAULT_DRILL_KEEP);
  assert.equal(parseKeepCount("-2"), DEFAULT_DRILL_KEEP);
});

test("selectDrillDirectoriesToRemove keeps the newest drills only", () => {
  const names = [
    "drill-2026-06-28T17-17-47-950Z",
    "drill-2026-11-02T06-24-28-252Z",
    "drill-2026-09-15T03-00-00-000Z",
    "not-a-drill",
  ];
  assert.deepEqual(selectDrillDirectoriesToRemove(names, 1), [
    "drill-2026-09-15T03-00-00-000Z",
    "drill-2026-06-28T17-17-47-950Z",
  ]);
  assert.deepEqual(selectDrillDirectoriesToRemove(names, 0).length, 3);
  assert.deepEqual(selectDrillDirectoriesToRemove(names, 10), []);
});

test("pruneDrillBackups removes stale directories and ignores unrelated files", () => {
  const root = mkdtempSync(join(tmpdir(), "flaremo-drill-prune-"));
  try {
    for (const name of [
      "drill-2026-06-28T17-17-47-950Z",
      "drill-2026-09-15T03-00-00-000Z",
      "drill-2026-11-02T06-24-28-252Z",
    ]) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, "report.md"), "drill");
    }
    mkdirSync(join(root, "keep-me"));
    writeFileSync(join(root, "keep-me", "notes.txt"), "unrelated");

    const removed = pruneDrillBackups(root, 1);
    assert.deepEqual(removed, [
      "drill-2026-09-15T03-00-00-000Z",
      "drill-2026-06-28T17-17-47-950Z",
    ]);
    assert.deepEqual(readdirSync(root).sort(), [
      "drill-2026-11-02T06-24-28-252Z",
      "keep-me",
    ]);

    // Idempotent second run: nothing left to remove.
    assert.deepEqual(pruneDrillBackups(root, 1), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
