import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/** Default number of local drill directories to keep. */
export const DEFAULT_DRILL_KEEP = 10;
/** Default number of remote-restore drill directories to keep. */
export const DEFAULT_REMOTE_RESTORE_KEEP = 3;
/** Directory prefixes owned by the drill scripts. */
export const DRILL_PREFIXES = ["drill-", "remote-restore-"];

function prefixOf(name) {
  return DRILL_PREFIXES.find((prefix) => name.startsWith(prefix)) ?? null;
}

/**
 * Parse a retention count from a CLI value or environment fallback.
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
 *
 * Names are `drill-<ISO timestamp>` or `remote-restore-<ISO timestamp>`, so a
 * lexicographic reverse sort is chronological. Anything that is not produced
 * by a drill script is left alone.
 */
export function selectDrillDirectoriesToRemove(names, keep) {
  const drills = names
    .filter((name) => prefixOf(name) !== null)
    .sort()
    .reverse();
  return drills.slice(Math.max(0, keep));
}

/**
 * Remove drill directories beyond the retention window under `root`.
 *
 * Retention is per prefix: local drills and remote-restore drills accumulate
 * at different rates and remote ones carry production-derived rows, so the
 * remote window defaults to the newest 3. Returns the removed directory names.
 */
export function pruneDrillBackups(root, options = {}) {
  const drillKeep = options.drill ?? DEFAULT_DRILL_KEEP;
  const remoteKeep = options.remoteRestore ?? DEFAULT_REMOTE_RESTORE_KEEP;
  let names = [];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const drillNames = names.filter((name) => name.startsWith("drill-"));
  const remoteNames = names.filter((name) =>
    name.startsWith("remote-restore-"),
  );
  const stale = [
    ...selectDrillDirectoriesToRemove(drillNames, drillKeep),
    ...selectDrillDirectoriesToRemove(remoteNames, remoteKeep),
  ];
  for (const name of stale) {
    rmSync(join(root, name), { recursive: true, force: true });
  }
  return stale;
}
