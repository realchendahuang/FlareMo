import type { MemoRow, UserRow } from "@flaremo/db";
import { describe, expect, it } from "vitest";
import { compileMemoFilter } from "./memo-filter";

const user = {
  id: "users/owner",
} as UserRow;

const memo = {
  id: "memos/one",
  content: "roadmap for urgent launch",
  pinned: true,
  visibility: "public",
  status: "normal",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  payload: {
    tags: ["urgent", "launch"],
    property: { has_link: true },
  },
} as MemoRow;

describe("Memos CEL filter", () => {
  it("evaluates upstream-style boolean, string and list macros", () => {
    const matches = compileMemoFilter(
      'pinned == true && content.contains("roadmap") && tags.exists(t, t == "urgent")',
    );
    expect(matches?.(memo, user)).toBe(true);
  });

  it("supports timestamp and now/duration expressions", () => {
    expect(
      compileMemoFilter(
        'created_ts > timestamp("2020-01-01T00:00:00Z") && updated_ts <= now',
      )?.(memo, user),
    ).toBe(true);
  });

  it("rejects invalid expressions and limits input size", () => {
    expect(() => compileMemoFilter("pinned ==")).toThrow(
      "Invalid Memos CEL filter",
    );
    expect(() => compileMemoFilter("x".repeat(4_097))).toThrow(
      "Memos filter is too long",
    );
  });
});
