// Pure date/grid helpers shared by the calendar page and the mini calendar.
// All day keys are plain `YYYY-MM-DD` strings, matching what tasks store in
// `due_at` and what the `/api/app/calendar` aggregate returns.

export type WeekStart = "sunday" | "monday";

export function todayKey(now = new Date()): string {
  return isoDay(now);
}

export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function nextDay(key: string): string {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return isoDay(date);
}

export function addDays(days: number, fromKey: string): string {
  const date = new Date(`${fromKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return isoDay(date);
}

export function addMonths(months: number, fromKey: string): string {
  const date = new Date(`${fromKey}T12:00:00`);
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  return isoDay(date);
}

export function monthOf(key: string): string {
  return key.slice(0, 7);
}

export type CalendarDay = {
  key: string;
  // False for the leading/trailing days that pad the grid on other months.
  inMonth: boolean;
};

const WEEKDAY_ORDER: Record<WeekStart, number[]> = {
  sunday: [0, 1, 2, 3, 4, 5, 6],
  monday: [1, 2, 3, 4, 5, 6, 0],
};

// Builds a 6 x 7 grid (weeks x weekdays) covering the month of `year`/
// `monthIndex` so every month renders at the same height.
export function buildMonthGrid(
  monthKey: string,
  weekStart: WeekStart,
): CalendarDay[] {
  const base = new Date(`${monthKey}-01T12:00:00`);
  const year = base.getFullYear();
  const month = base.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const lead = WEEKDAY_ORDER[weekStart].indexOf(firstWeekday);

  const days: CalendarDay[] = [];
  const cursor = new Date(year, month, 1 - lead);
  for (let i = 0; i < 42; i += 1) {
    const key = isoDay(cursor);
    days.push({
      key,
      inMonth: cursor.getMonth() === month,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function weekdayLabels(
  weekStart: WeekStart,
  formatter: (dayNumber: number) => string,
): string[] {
  return WEEKDAY_ORDER[weekStart].map(formatter);
}

export function compareDayKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Locale-aware titles: zh shows 「2026年9月」 / 「9月16日」, en shows
// "September 2026" / "Sep 16". Built by hand instead of Date#split so the
// two locales never leak each other's separators.
export function formatMonthTitle(monthKey: string, locale: string): string {
  const date = new Date(`${monthKey}-15T12:00:00`);
  return locale.startsWith("en")
    ? date.toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

export function formatDayTitle(dayKey: string, locale: string): string {
  const date = new Date(`${dayKey}T12:00:00`);
  if (locale.startsWith("en")) {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

// Universe of the timeline search operator stack: a single local day maps to
// `after:D before:D+1`, which the backend reads as [D 00:00, D+1 00:00) UTC.
export function dayFilterQuery(day: string): string {
  return `after:${day} before:${nextDay(day)}`;
}

// Inverse of dayFilterQuery: a query that is exactly one local day maps back
// to its day key so the UI can render it as a date chip instead of raw query
// syntax. Anything else (extra operators, free text, a partial range) stays a
// genuine text query.
export function dayFilterFromQuery(query: string): string | null {
  const fields = new Map<string, string>();
  for (const token of query.split(/\s+/)) {
    if (!token) continue;
    const colon = token.indexOf(":");
    if (colon <= 0) return null;
    fields.set(token.slice(0, colon), token.slice(colon + 1));
  }
  const start = fields.get("after");
  const end = fields.get("before");
  if (fields.size !== 2 || !start || !end) return null;
  return end === nextDay(start) ? start : null;
}
