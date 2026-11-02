/**
 * Shared date formatting for admin / account / task list surfaces, styled
 * after calendar-date.ts's locale-aware Intl helpers (but for timestamps, not
 * calendar-grid keys).
 *
 * Three historically divergent renderings live here; their outputs are kept
 * byte-identical to the call sites they replaced:
 * - formatDate: medium date (reader expiry in admin + account profile).
 * - formatDateTime: medium date + short time (token expiry rows).
 * - formatTimestamp: the default `toLocaleString()` of the task activity
 *   list — intentionally NOT formatDateTime, which would change its visible
 *   output.
 */

// Medium date ("Sep 20, 2026" / "2026年9月20日"). An invalid value falls back
// to the raw input, so admin's reader-expiry label degrades to the server
// string instead of "Invalid Date".
export function formatDate(value: string, locale?: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

// Medium date + short time ("Jan 5, 2026, 3:07 PM"), used for personal
// access token expiry rows.
export function formatDateTime(
  value: string | number | Date,
  locale?: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

// Default-locale `toLocaleString()` rendering, kept verbatim from the task
// activity list.
export function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}
