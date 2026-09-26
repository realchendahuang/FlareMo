import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatTimestamp } from "./date-format";

describe("formatDate", () => {
  it("renders the medium date the reader-expiry rows show", () => {
    expect(formatDate("2026-09-20T00:00:00Z", "en-US")).toMatch(
      /^Sep \d{1,2}, 2026$/,
    );
    expect(formatDate("2026-09-20T12:00:00Z", "zh-CN")).toBe("2026年9月20日");
  });

  it("falls back to the raw input when the value is not a date", () => {
    expect(formatDate("not-a-date", "en-US")).toBe("not-a-date");
  });
});

describe("formatDateTime", () => {
  it("renders medium date + short time like the token expiry rows", () => {
    expect(formatDateTime("2026-01-05T15:07:00Z", "en-US")).toMatch(
      /^Jan \d{1,2}, 2026(,)? \d{1,2}:\d{2} (AM|PM)$/,
    );
    // The wall-clock hour depends on the host time zone (CI runs in UTC),
    // so only the zh-CN shape is pinned here.
    expect(formatDateTime("2026-01-05T15:07:00Z", "zh-CN")).toMatch(
      /^2026年1月\d{1,2}日 \d{2}:07$/,
    );
  });
});

describe("formatTimestamp", () => {
  it("matches the default toLocaleString of the memory revisions list", () => {
    const value = "2026-09-20T08:30:00Z";
    expect(formatTimestamp(value)).toBe(new Date(value).toLocaleString());
    expect(formatTimestamp("not-a-date")).toBe(
      new Date("not-a-date").toLocaleString(),
    );
  });
});
