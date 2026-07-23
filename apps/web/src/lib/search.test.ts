import { describe, expect, it } from "vitest";
import {
  buildSearchExcerpt,
  getSearchTerms,
  splitHighlightedText,
} from "./search";

describe("memo search previews", () => {
  it("keeps text terms while removing supported filters", () => {
    expect(
      getSearchTerms(
        "project plan has:attachment is:pinned before:2026-07-01 in:archive",
      ),
    ).toEqual(["project", "plan"]);
    expect(getSearchTerms("before:2026-02-30")).toEqual([
      "before",
      "2026-02-30",
    ]);
  });

  it("builds and highlights a compact preview around a match", () => {
    const excerpt = buildSearchExcerpt(
      "The first thought is intentionally far away from the needle lantern.",
      "needle",
      32,
    );

    expect(excerpt?.text).toContain("needle");
    expect(
      splitHighlightedText(excerpt?.text ?? "", excerpt?.terms ?? []),
    ).toContainEqual(
      expect.objectContaining({
        text: "needle",
        highlighted: true,
      }),
    );
  });
});
