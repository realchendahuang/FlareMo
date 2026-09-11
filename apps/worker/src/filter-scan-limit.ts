import {
  DEFAULT_MEMO_FILTER_SCAN_LIMIT,
  parseMemoFilterScanLimit,
} from "@flaremo/domain";
import type { FlareMoEnv } from "./env";

/**
 * CEL filters that cannot be fully pushed down to SQL scan candidate rows in
 * JS (rows charged against the D1 read quota). Deployments can cap that scan
 * with FLAREMO_MEMO_FILTER_SCAN_LIMIT; the default stays generous for
 * self-hosted single-owner installs. Invalid or out-of-range values fall
 * back to the default rather than silently disabling the guard.
 */
const SCAN_LIMIT_FLOOR = 100;
const SCAN_LIMIT_CEILING = 50_000;

export function memoFilterScanLimit(env: FlareMoEnv): number {
  const parsed = parseMemoFilterScanLimit(env.FLAREMO_MEMO_FILTER_SCAN_LIMIT);
  if (parsed === undefined) return DEFAULT_MEMO_FILTER_SCAN_LIMIT;
  return Math.min(Math.max(parsed, SCAN_LIMIT_FLOOR), SCAN_LIMIT_CEILING);
}
