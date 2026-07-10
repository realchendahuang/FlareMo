import { describe, expect, it } from "vitest";
import { buildMonthLabels } from "../lib/activity";

describe("buildMonthLabels", () => {
  it("derives month labels from the current activity window", () => {
    const start = new Date("2026-04-18T12:00:00Z");
    const activity = Array.from({ length: 84 }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + index);
      return { date: date.toISOString().slice(0, 10), count: 0 };
    });

    expect(
      buildMonthLabels(activity, "en-US")
        .map((month) => month.label)
        .filter((label) => label !== ""),
    ).toEqual(["Apr", "May", "Jun", "Jul"]);
  });
});
