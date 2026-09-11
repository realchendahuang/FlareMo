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

// Universe of the timeline search operator stack: a single local day maps to
// `after:D before:D+1`, which the backend reads as [D 00:00, D+1 00:00) UTC.
export function dayFilterQuery(day: string): string {
  return `after:${day} before:${nextDay(day)}`;
}
