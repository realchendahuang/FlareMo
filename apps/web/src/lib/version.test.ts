import { describe, expect, it } from "vitest";
import { compareVersions } from "./version";

describe("compareVersions", () => {
  it("compares semantic versions without lexicographic mistakes", () => {
    expect(compareVersions("0.3.0", "0.2.10")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
  });
});
