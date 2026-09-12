import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildMonthGrid,
  dayFilterFromQuery,
  dayFilterQuery,
  isoDay,
  monthOf,
  nextDay,
  todayKey,
  weekdayLabels,
} from "./calendar-date";

describe("isoDay / todayKey", () => {
  it("formats local dates", () => {
    expect(isoDay(new Date(2026, 8, 12))).toBe("2026-09-12");
  });

  it("keeps today in local time zone", () => {
    expect(todayKey(new Date(2026, 8, 12, 23, 59))).toBe("2026-09-12");
    expect(todayKey(new Date(2026, 8, 12, 0, 0))).toBe("2026-09-12");
  });
});

describe("nextDay", () => {
  it("crosses month boundaries", () => {
    expect(nextDay("2026-08-31")).toBe("2026-09-01");
  });
});

describe("addMonths", () => {
  it("clamps overflow when navigating from a 31st", () => {
    expect(monthOf(addMonths(1, "2026-01-31"))).toBe("2026-02");
    expect(monthOf(addMonths(-1, "2026-03-31"))).toBe("2026-02");
    expect(monthOf(addMonths(12, "2026-09-02"))).toBe("2027-09");
  });
});

describe("buildMonthGrid", () => {
  it("produces a 6x7 grid anchored to the week start", () => {
    const mondayFirst = buildMonthGrid("2026-09", "monday");
    expect(mondayFirst).toHaveLength(42);
    // 2026-09-01 is a Tuesday.
    expect(mondayFirst[0]).toEqual({ key: "2026-08-31", inMonth: false });
    expect(mondayFirst[1]).toEqual({ key: "2026-09-01", inMonth: true });
    expect(mondayFirst[7].key).toBe("2026-09-07");

    const sundayFirst = buildMonthGrid("2026-09", "sunday");
    expect(sundayFirst[0]).toEqual({ key: "2026-08-30", inMonth: false });
    expect(sundayFirst[2]).toEqual({ key: "2026-09-01", inMonth: true });
  });

  it("starts Monday-first weeks with Monday and Sunday-first with Sunday", () => {
    expect(
      new Date(
        `${buildMonthGrid("2026-09", "monday")[0].key}T12:00:00`,
      ).getDay(),
    ).toBe(1);
    expect(
      new Date(
        `${buildMonthGrid("2026-09", "sunday")[0].key}T12:00:00`,
      ).getDay(),
    ).toBe(0);
  });
});

describe("weekdayLabels", () => {
  it("orders weekday labels by week start", () => {
    expect(weekdayLabels("sunday", (day) => `${day + 1}`)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
    ]);
    expect(weekdayLabels("monday", (day) => `${day + 1}`)).toEqual([
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "1",
    ]);
  });
});

describe("dayFilterFromQuery / dayFilterQuery", () => {
  it("round-trips a single-day filter", () => {
    expect(dayFilterFromQuery(dayFilterQuery("2026-09-16"))).toBe("2026-09-16");
  });

  it("accepts the operators in either order", () => {
    expect(dayFilterFromQuery("before:2026-09-17 after:2026-09-16")).toBe(
      "2026-09-16",
    );
  });

  it("rejects free text, extra operators, and open ranges", () => {
    expect(dayFilterFromQuery("meeting after:2026-09-16")).toBe(null);
    expect(dayFilterFromQuery("after:2026-09-16 before:2026-10-01")).toBe(null);
    expect(dayFilterFromQuery("after:2026-09-16")).toBe(null);
    expect(dayFilterFromQuery("")).toBe(null);
  });
});
