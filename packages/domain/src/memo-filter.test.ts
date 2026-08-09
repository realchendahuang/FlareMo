import type { AttachmentRow, MemoRow, UserRow } from "@flaremo/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileAttachmentFilter, compileMemoFilter } from "./memo-filter";

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

const attachment = {
  id: "attachments/one",
  filename: "report.pdf",
  contentType: "application/pdf",
  memoId: "memos/one",
  createdAt: "2026-08-01T00:00:00.000Z",
} as AttachmentRow;

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
        'created_ts > timestamp(1704067200) && updated_ts <= now - duration("1h")',
      )?.(memo, user),
    ).toBe(true);
  });

  it("supports upstream size and timestamp accessor functions", () => {
    expect(compileMemoFilter("size(content) == 25")?.(memo, user)).toBe(true);
    expect(compileMemoFilter("content.size() > 20")?.(memo, user)).toBe(true);
    expect(compileMemoFilter("size(tags) == 2")?.(memo, user)).toBe(true);
    expect(
      compileMemoFilter("created_ts.getFullYear() == 2026")?.(memo, user),
    ).toBe(true);
    expect(compileMemoFilter("created_ts.getMonth() == 7")?.(memo, user)).toBe(
      true,
    );
    expect(() => compileMemoFilter('created_ts.getMonth("UTC") == 7')).toThrow(
      /timezone argument/,
    );
    expect(() => compileMemoFilter("now.getFullYear() == 2026")).toThrow(
      /timestamp fields/,
    );
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

  it("keeps tag aliases atomic across boolean expressions and supports hierarchy", () => {
    const hierarchical = {
      ...memo,
      pinned: false,
      payload: { tags: ["book/fiction"], property: {} },
    } as MemoRow;
    expect(compileMemoFilter('tag in ["book"]')?.(hierarchical, user)).toBe(
      true,
    );

    const pinnedWithoutTags = {
      ...memo,
      pinned: true,
      payload: { tags: [], property: {} },
    } as MemoRow;
    expect(
      compileMemoFilter('tag in ["book"] || pinned')?.(pinnedWithoutTags, user),
    ).toBe(true);
    expect(
      compileMemoFilter('tag in ["book"] && pinned')?.(pinnedWithoutTags, user),
    ).toBe(false);
    expect(
      compileMemoFilter('!(tag in ["book"])')?.(pinnedWithoutTags, user),
    ).toBe(true);
  });

  it("uses case-insensitive string matching and validates regexes once", () => {
    expect(compileMemoFilter('content.contains("ROADMAP")')?.(memo, user)).toBe(
      true,
    );
    expect(compileMemoFilter('content.startsWith("ROAD")')?.(memo, user)).toBe(
      true,
    );
    expect(compileMemoFilter('content.endsWith("LAUNCH")')?.(memo, user)).toBe(
      true,
    );
    expect(
      compileMemoFilter('content.matches("road.*launch")')?.(memo, user),
    ).toBe(true);
    expect(() => compileMemoFilter('content.matches("[")')).toThrow(
      "Invalid Memos CEL filter",
    );
    expect(() => compileMemoFilter('content.matches("(?=road)")')).toThrow(
      "Invalid Memos CEL filter",
    );
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
    expect(() => compileMemoFilter("1")).toThrow(
      "filter must evaluate to a boolean",
    );
    expect(() => compileMemoFilter('timestamp("garbage") < now')).toThrow(
      "Invalid Memos CEL filter",
    );
    expect(() =>
      compileMemoFilter('duration("garbage") > duration("1s")'),
    ).toThrow("Invalid Memos CEL filter");
    expect(() => compileMemoFilter('visibility < "PUBLIC"')).toThrow(
      "Invalid Memos CEL filter",
    );
    expect(() => compileMemoFilter('tag == "urgent"')).toThrow(
      "Invalid Memos CEL filter",
    );
    expect(() => compileMemoFilter("tags.map(t, t)")).toThrow(
      "Invalid Memos CEL filter",
    );
    expect(() =>
      compileMemoFilter('content.substring(0, 2) == "road"'),
    ).toThrow("Invalid Memos CEL filter");
    expect(() => compileMemoFilter('created_ts.getHours("UTC") >= 0')).toThrow(
      "timezone argument",
    );
    expect(() => compileMemoFilter("size(pinned)")).toThrow(
      "Invalid Memos CEL filter",
    );
  });

  it("normalizes only code and preserves string literals", () => {
    expect(
      compileMemoFilter('sets . contains ( tags, ["urgent"] )')?.(memo, user),
    ).toBe(true);
    const singleTagMemo = {
      ...memo,
      payload: { tags: ["urgent"], property: {} },
    } as MemoRow;
    expect(
      compileMemoFilter('tags . all (t, t.startsWith("URGENT"))')?.(
        singleTagMemo,
        user,
      ),
    ).toBe(true);

    const literalMemo = { ...memo, content: "sets.contains(" } as MemoRow;
    expect(
      compileMemoFilter('content.contains("sets.contains(")')?.(
        literalMemo,
        user,
      ),
    ).toBe(true);
  });
});

describe("Memos Attachment CEL filter", () => {
  it("supports text matching, in, memo identity, and time arithmetic", () => {
    expect(
      compileAttachmentFilter(
        'filename.contains("REPORT") && mime_type in ["application/pdf", "image/png"]',
      )?.(attachment),
    ).toBe(true);
    expect(
      compileAttachmentFilter(
        'memo_id == "memos/one" && create_time < now + duration("1h")',
      )?.(attachment),
    ).toBe(true);
    expect(
      compileAttachmentFilter('memo == "memos/missing"')?.(attachment),
    ).toBe(false);
  });

  it("preserves nullable memo_id semantics for unbound attachments", () => {
    const unbound = { ...attachment, memoId: null } as AttachmentRow;
    expect(compileAttachmentFilter("memo_id == null")?.(unbound)).toBe(true);
    expect(compileAttachmentFilter("memo_id != null")?.(unbound)).toBe(false);
    expect(compileAttachmentFilter("memo_id != null")?.(attachment)).toBe(true);
  });

  it("supports attachment regexes and rejects fields outside the pinned schema", () => {
    expect(
      compileAttachmentFilter('mime_type.matches("^application/")')?.(
        attachment,
      ),
    ).toBe(true);
    expect(() => compileAttachmentFilter("tags.exists(t, true)")).toThrow(
      "Invalid Memos CEL filter",
    );
    expect(() => compileAttachmentFilter("unknown == true")).toThrow(
      "Invalid Memos CEL filter",
    );
  });
});
