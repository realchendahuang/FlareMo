import { describe, expect, it } from "vitest";
import { onThisDayWindows, YEARS_LOOKBACK } from "./review-deck";

describe("onThisDayWindows", () => {
  it("lists the same month-day in each past year, newest first", () => {
    expect(onThisDayWindows("2026-10-31", 3)).toEqual([
      "2025-10-31",
      "2024-10-31",
      "2023-10-31",
    ]);
  });

  it("skips years where the day never happened", () => {
    // 2024 was a leap year; 2023, 2022 and 2021 had no Feb 29.
    expect(onThisDayWindows("2024-02-29", 4)).toEqual(["2020-02-29"]);
  });

  it("stays a fixed length however large the corpus is", () => {
    expect(onThisDayWindows("2026-05-01")).toHaveLength(YEARS_LOOKBACK);
  });
});
