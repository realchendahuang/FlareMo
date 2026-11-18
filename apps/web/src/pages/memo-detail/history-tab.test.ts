import { describe, expect, it } from "vitest";
import { computeLineDiff } from "./history-tab";

describe("computeLineDiff", () => {
  it("returns an empty diff when revision and current content are identical", () => {
    expect(computeLineDiff("第一行\n第二行", "第一行\n第二行")).toEqual([]);
  });

  it("identifies unchanged, removed, and added lines in order", () => {
    const before = "标题\n旧段落\n保留结尾";
    const after = "标题\n新段落一\n新段落二\n保留结尾";

    expect(computeLineDiff(before, after)).toEqual([
      { kind: "same", text: "标题" },
      { kind: "removed", text: "旧段落" },
      { kind: "added", text: "新段落一" },
      { kind: "added", text: "新段落二" },
      { kind: "same", text: "保留结尾" },
    ]);
  });

  it("falls back to linear replacement when a note exceeds the LCS line cap", () => {
    const before = Array.from({ length: 305 }, (_, i) => `old-${i}`).join("\n");
    const after = "new-0\nnew-1";

    const diff = computeLineDiff(before, after);
    expect(diff).toHaveLength(307);
    expect(diff.slice(0, 305).every((line) => line.kind === "removed")).toBe(
      true,
    );
    expect(diff.slice(305)).toEqual([
      { kind: "added", text: "new-0" },
      { kind: "added", text: "new-1" },
    ]);
  });
});
