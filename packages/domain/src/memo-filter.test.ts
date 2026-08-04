import type { MemoRow, UserRow } from "@flaremo/db";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("matches Memos creator identity, numeric id, and virtual tag membership", () => {
    expect(
      compileMemoFilter(
        'creator == "users/owner" && creator_id == 1 && tag in ["urgent"]',
      )?.(memo, user),
    ).toBe(true);

    expect(compileMemoFilter('tag in ["missing"]')?.(memo, user)).toBe(false);

    const caseSensitive = compileMemoFilter('tag in ["URGENT"]');
    expect(caseSensitive?.(memo, user)).toBe(false);
  });

  it("supports the upstream set helpers and non-vacuous tags.all", () => {
    expect(
      compileMemoFilter(
        'sets.contains(tags, ["urgent", "launch"]) && sets.intersects(tags, ["launch"])',
      )?.(memo, user),
    ).toBe(true);
    expect(
      compileMemoFilter('sets.equivalent(tags, ["launch", "urgent"])')?.(
        memo,
        user,
      ),
    ).toBe(true);

    const emptyTags = { ...memo, payload: { property: {} } } as MemoRow;
    expect(
      compileMemoFilter('tags.all(t, t.startsWith("work"))')?.(emptyTags, user),
    ).toBe(false);
  });

  it("freezes now once when the filter is compiled", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T00:00:00.000Z"));
    const matches = compileMemoFilter(
      'created_ts < now && now < timestamp("2026-08-05T00:00:00Z")',
    );
    vi.setSystemTime(new Date("2026-08-06T00:00:00.000Z"));
    expect(matches?.(memo, user)).toBe(true);
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
