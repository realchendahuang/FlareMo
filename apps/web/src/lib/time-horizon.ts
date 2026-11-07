/**
 * Pure aggregation and day-key arithmetic behind the four time-horizon views.
 *
 * Everything here used to be computed inline inside the view components; it
 * lives on its own so the counting rules — which hour lands in which quadrant,
 * which memo lands in which quarter-hour slot, how a week or month range is
 * derived — are testable without React. The bodies are moved verbatim, so the
 * numbers are unchanged.
 *
 * Day keys are the app-wide `YYYY-MM-DD` strings of lib/calendar-date.
 */
import { isoDay } from "./calendar-date";

export type HourlyActivity = {
  date: string;
  hour: number;
  count: number;
};

/**
 * Trailing span, in local days, of the `activity` array the stats endpoint
 * returns. Sized to the widest view in the time horizon — the year grid — so no
 * cell renders a structural zero. The endpoint's own default is 84 days, which
 * is what a client that does not care (the share-image card, which only reads
 * `active_days`) still gets.
 */
export const ACTIVITY_WINDOW_DAYS = 366;

export type DayQuadrants = [number, number, number, number];

/**
 * Local noon on the given day key. Noon keeps the key stable across DST
 * transitions, which is why every helper here builds dates at 12:00.
 */
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

export function yearOf(key: string): number {
  return Number(key.slice(0, 4));
}

/** The day key `days` days away from `key` (negative moves backwards). */
export function shiftDayKey(key: string, days: number): string {
  const date = parseDayKey(key);
  date.setDate(date.getDate() + days);
  return isoDay(date);
}

/** First and last day of the month the key names, both as day keys. */
export function monthRangeOf(monthKey: string): {
  from: string;
  to: string;
} {
  const [monthYear, monthMonth] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(monthYear, monthMonth, 0).getDate();
  return {
    from: `${monthKey}-01`,
    to: `${monthKey}-${String(daysInMonth).padStart(2, "0")}`,
  };
}

/**
 * First and last day of the week grid, falling back to `fallback` for a grid
 * that does not span a whole week.
 */
export function weekRangeOf(
  days: Array<{ key: string }>,
  fallback: string,
): { from: string; to: string } {
  return {
    from: days[0]?.key ?? fallback,
    to: days[6]?.key ?? fallback,
  };
}

/** Day key -> note count, for the days that have any. */
export function buildActivityCountMap(
  activity: Array<{ date: string; count: number }>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of activity) {
    if (entry.count > 0) map.set(entry.date, entry.count);
  }
  return map;
}

/** Sum the activity counts for a concrete list of local day keys. */
export function sumActivityCountsForDays(
  countMap: ReadonlyMap<string, number>,
  dayKeys: readonly string[],
): number {
  let total = 0;
  for (const key of dayKeys) total += countMap.get(key) ?? 0;
  return total;
}

/**
 * Day key -> four quadrant totals from hourly records:
 * q0: 00-06h (深夜), q1: 06-12h (上午), q2: 12-18h (下午), q3: 18-24h (晚上).
 */
export function buildDayQuadrants(
  hourlyData: HourlyActivity[],
): Map<string, DayQuadrants> {
  const qMap = new Map<string, DayQuadrants>();
  for (const h of hourlyData) {
    if (!qMap.has(h.date)) qMap.set(h.date, [0, 0, 0, 0]);
    const current = qMap.get(h.date);
    if (!current) continue;
    const qIdx = Math.floor(h.hour / 6);
    if (qIdx >= 0 && qIdx < 4) {
      current[qIdx] += h.count;
    }
  }
  return qMap;
}

/** Hour of day -> note count, for the hours that have any. */
export function buildHourCountMap(
  hourlyData: HourlyActivity[],
): Map<number, number> {
  const map = new Map<number, number>();
  for (const item of hourlyData) {
    if (item.count > 0) map.set(item.hour, item.count);
  }
  return map;
}

/** `${dayKey}_${hour}` -> note count, for the cells that have any. */
export function buildWeekSlotCountMap(
  hourlyData: HourlyActivity[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const h of hourlyData) {
    if (h.count > 0) map.set(`${h.date}_${h.hour}`, h.count);
  }
  return map;
}

/**
 * Quarter-hour slot (0 to 95) -> note count, from exact memo creation
 * timestamps: hour * 4 + floor(minute / 15).
 */
export function buildMemoSlotCountMap(
  memos: Array<{ id: string; create_time: string }>,
): Map<number, number> {
  const map = new Map<number, number>();
  for (const m of memos) {
    const d = new Date(m.create_time);
    const slot = d.getHours() * 4 + Math.floor(d.getMinutes() / 15);
    map.set(slot, (map.get(slot) ?? 0) + 1);
  }
  return map;
}
