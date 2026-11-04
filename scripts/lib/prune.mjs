import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/** Default number of drill directories to keep. */
export const DEFAULT_DRILL_KEEP = 10;

/**
 * Parse the retention count from a CLI value or environment fallback.
 * Invalid, missing or negative input falls back to the default so a typo can
 * never silently delete every drill in the directory.
 */
export function parseKeepCount(value, fallback = DEFAULT_DRILL_KEEP) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

/**
 * Pick the drill directories that fall outside the retention window.
 * Names are `drill-<ISO timestamp>`, so a lexicographic reverse sort is
 * chronological. Anything that is not a drill directory is left alone.
 */
export function selectDrillDirectoriesToRemove(names, keep) {
  const drills = names
    .filter((name) => name.startsWith("drill-"))
    .sort()
    .reverse();
  return drills.slice(Math.max(0, keep));
}

/**
 * Remove drill directories beyond the retention window under `root`.
 * Returns the removed directory names. Recursive and idempotent: a missing
 * root or an already-removed child is a no-op.
 */
export function pruneDrillBackups(root, keep) {
  let names = [];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const stale = selectDrillDirectoriesToRemove(names, keep);
  for (const name of stale) {
    rmSync(join(root, name), { recursive: true, force: true });
  }
  return stale;
}
