import { describe, expect, it } from "vitest";
import {
  buildActivityCountMap,
  sumActivityCountsForDays,
} from "./time-horizon";

describe("sumActivityCountsForDays", () => {
  it("sums only the requested local days", () => {
    const counts = buildActivityCountMap([
      { date: "2026-01-05", count: 3 },
      { date: "2026-01-06", count: 2 },
      { date: "2026-01-07", count: 4 },
      { date: "2026-01-08", count: 0 },
    ]);

    expect(sumActivityCountsForDays(counts, ["2026-01-05", "2026-01-07"])).toBe(
      7,
    );
    expect(sumActivityCountsForDays(counts, ["2026-01-06"])).toBe(2);
  });

  it("treats missing and zero-count days as zero", () => {
    expect(
      sumActivityCountsForDays(new Map([["2026-01-01", 5]]), [
        "2026-01-01",
        "2026-01-02",
      ]),
    ).toBe(5);
  });
});
