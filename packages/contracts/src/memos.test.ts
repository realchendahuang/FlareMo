import { describe, expect, it } from "vitest";
import { parseMemoSearchQuery } from "./search-query";

describe("parseMemoSearchQuery", () => {
  it("separates valid search filters from full-text terms", () => {
    expect(
      parseMemoSearchQuery(
        "project launch has:attachment is:pinned after:2026-04-01 before:2026-05-01 in:archive",
      ),
    ).toEqual({
      text: "project launch",
      hasAttachment: true,
      isPinned: true,
      after: "2026-04-01",
      before: "2026-05-01",
      scope: "archive",
    });
  });

  it("keeps invalid filter-like terms in the full-text query", () => {
    expect(
      parseMemoSearchQuery(
        "before:2026-02-30 after:not-a-date in:archived has:attachments",
      ),
    ).toEqual({
      text: "before:2026-02-30 after:not-a-date in:archived has:attachments",
      hasAttachment: false,
      isPinned: false,
    });
  });
});
