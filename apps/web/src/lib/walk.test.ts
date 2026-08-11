import { describe, expect, it } from "vitest";
import type { Memo } from "@/api";
import { seasonOf, summarizeWalk, yearOf } from "./walk";

function memo(content: string, createTime: string): Memo {
  return {
    name: `memos/${content}`,
    id: content,
    content,
    visibility: "private",
    state: "normal",
    pinned: false,
    payload: {},
    create_time: createTime,
    update_time: createTime,
    display_time: createTime,
    creator: "users/owner",
  };
}

describe("summarizeWalk", () => {
  it("counts steps, characters, and the creation time span", () => {
    const summary = summarizeWalk([
      { memo: memo("four", "2024-05-01T08:00:00.000Z"), via: null },
      { memo: memo("六字符的内容", "2023-03-01T08:00:00.000Z"), via: null },
      { memo: memo("x", "2025-11-20T08:00:00.000Z"), via: null },
    ]);

    expect(summary.count).toBe(3);
    expect(summary.characters).toBe(4 + 6 + 1);
    expect(summary.earliest).toBe("2023-03-01T08:00:00.000Z");
    expect(summary.latest).toBe("2025-11-20T08:00:00.000Z");
  });

  it("returns a null span for an empty walk", () => {
    expect(summarizeWalk([])).toEqual({
      count: 0,
      characters: 0,
      earliest: null,
      latest: null,
    });
  });
});

describe("seasonOf", () => {
  it("maps months to northern-hemisphere seasons", () => {
    expect(seasonOf("2024-03-01T00:00:00.000Z")).not.toBeNull();
    expect(seasonOf("2025-01-15T12:00:00")).toBe("winter");
    expect(seasonOf("2025-04-15T12:00:00")).toBe("spring");
    expect(seasonOf("2025-07-15T12:00:00")).toBe("summer");
    expect(seasonOf("2025-10-15T12:00:00")).toBe("autumn");
    expect(seasonOf("2025-12-15T12:00:00")).toBe("winter");
    expect(seasonOf("not-a-date")).toBeNull();
  });
});

describe("yearOf", () => {
  it("extracts the local year", () => {
    expect(yearOf("2023-08-11T10:00:00")).toBe(2023);
    expect(yearOf("not-a-date")).toBeNull();
  });
});
