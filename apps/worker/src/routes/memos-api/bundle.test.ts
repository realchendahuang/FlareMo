import { describe, expect, it } from "vitest";
import {
  type BundleJsonEstimateInput,
  estimateBundleJsonBytes,
} from "./bundle";

function emptyBundle(): BundleJsonEstimateInput {
  return {
    version: 7,
    exported_at: "2026-11-05T00:00:00.000Z",
    memos: [],
    attachments: [],
    relations: [],
    shares: [],
    projects: [],
    tasks: [],
    task_activity: [],
  };
}

describe("export bundle JSON size estimate", () => {
  it("matches JSON.stringify exactly for non-ASCII records and every array", () => {
    const bundle = {
      ...emptyBundle(),
      memos: [
        { name: "memos/一", content: "中文与 emoji 🪶", payload: { n: 1 } },
      ],
      attachments: [{ name: "attachments/a", filename: "图.png", size: 1 }],
      relations: [{ memo: "memos/一", related_memo: "memos/二" }],
      shares: [{ name: "shares/a", revoked_at: null }],
      projects: [{ name: "projects/a", title: "项目" }],
      tasks: [{ name: "tasks/a", title: "待办", notes: "x\ny" }],
      task_activity: [{ action: "created", changes: { escaped: '\\"' } }],
    };
    const expected = new TextEncoder().encode(
      JSON.stringify(bundle),
    ).byteLength;
    expect(estimateBundleJsonBytes(bundle)).toBe(expected);
  });

  it("stops before serializing records after the budget is crossed", () => {
    const first = { name: "memos/first", content: "x".repeat(32) };
    const poison = {
      toJSON() {
        throw new Error("tail record should not be serialized");
      },
    };
    const bundle = { ...emptyBundle(), memos: [first, poison] };
    const emptyBytes = estimateBundleJsonBytes(emptyBundle());
    const firstRecordBytes = new TextEncoder().encode(
      JSON.stringify(first),
    ).byteLength;
    // The first record takes the running total exactly one byte over budget;
    // the estimator must return before reaching the poisoned tail record.
    const maxBytes = emptyBytes + firstRecordBytes - 1;
    expect(estimateBundleJsonBytes(bundle, maxBytes)).toBe(maxBytes + 1);
  });
});
