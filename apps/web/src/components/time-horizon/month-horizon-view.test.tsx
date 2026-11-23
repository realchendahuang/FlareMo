import { describe, expect, it } from "vitest";
import {
  aggregateHourlyDailyTotals,
  type HourlyActivityRow,
} from "./month-horizon-view";

function row(date: string, hour: number, count: number): HourlyActivityRow {
  return { date, hour, count };
}

describe("aggregateHourlyDailyTotals", () => {
  it("sums every hour of the same day into one total", () => {
    const totals = aggregateHourlyDailyTotals([
      row("2026-10-01", 0, 0),
      row("2026-10-01", 9, 2),
      row("2026-10-01", 21, 3),
      row("2026-10-02", 12, 1),
    ]);

    expect(totals.get("2026-10-01")).toBe(5);
    expect(totals.get("2026-10-02")).toBe(1);
    expect(totals.size).toBe(2);
  });

  it("returns an empty map for an empty or missing hour array", () => {
    expect(aggregateHourlyDailyTotals([]).size).toBe(0);
    expect(aggregateHourlyDailyTotals(undefined).size).toBe(0);
  });

  it("keeps zero-count days present so the fallback stays per-day", () => {
    const totals = aggregateHourlyDailyTotals([
      row("2026-02-01", 8, 0),
      row("2026-02-02", 8, 4),
    ]);

    // A day the hourly query returned as all-zero must be present with 0, so
    // the view does not fall back to the (today-anchored) notesCountMap.
    expect(totals.has("2026-02-01")).toBe(true);
    expect(totals.get("2026-02-01")).toBe(0);
    expect(totals.get("2026-02-02")).toBe(4);
  });
});
