import { describe, expect, it } from "vitest";
import {
  extractTags,
  formatMemoRelativeTime,
  formatMemoTime,
  memoExcerpt,
  memoTitle,
} from "./memo";

// A fixed locale keeps the assertions about the formatter's decision (is the
// year spelled out), not about the runner's default locale.
const LOCALE = "en-US";

function at(year: number, month = 8, day = 20, hour = 20, minute = 43) {
  return new Date(Date.UTC(year, month, day, hour, minute)).toISOString();
}

describe("formatMemoTime", () => {
  it("omits the year for memos from the current year", () => {
    const thisYear = new Date().getFullYear();
    const formatted = formatMemoTime(at(thisYear), LOCALE);
    expect(formatted).not.toContain(String(thisYear));
  });

  it("includes the year for memos from another year (issue #143)", () => {
    const thisYear = new Date().getFullYear();
    const otherYear = thisYear - 1;
    const formatted = formatMemoTime(at(otherYear), LOCALE);
    expect(formatted).toContain(String(otherYear));
  });

  it("includes the year for future-dated memos instead of dropping it", () => {
    const future = new Date().getFullYear() + 1;
    expect(formatMemoTime(at(future), LOCALE)).toContain(String(future));
  });

  it("returns an empty string for unparsable values", () => {
    expect(formatMemoTime("not-a-date", LOCALE)).toBe("");
  });
});

describe("formatMemoRelativeTime", () => {
  it("falls back to the absolute format past a week, keeping the year rule", () => {
    const old = new Date(Date.now() - 30 * 86_400_000);
    const thisYear = new Date().getFullYear();
    const formatted = formatMemoRelativeTime(old.toISOString(), LOCALE);
    if (old.getFullYear() === thisYear) {
      expect(formatted).not.toContain(String(thisYear));
    } else {
      expect(formatted).toContain(String(old.getFullYear()));
    }
  });
});

// The composer sends these tags as `payload.tags`, and the server trusts that
// field instead of re-parsing the content — so client extraction must match the
// server-side rules (`packages/domain/src/tags.ts`), code blocks included.
describe("extractTags", () => {
  it("extracts plain and hierarchical tags", () => {
    expect(extractTags("今日 #工作/项目A 推进，#生活 也坚持了")).toEqual([
      "工作/项目A",
      "生活",
    ]);
  });

  it("stops at punctuation and ignores tags inside words", () => {
    expect(extractTags("#tag，继续")).toEqual(["tag"]);
    expect(extractTags("no#taghere")).toEqual([]);
    expect(extractTags("foo #bar-1 #baz_2")).toEqual(["bar-1", "baz_2"]);
  });

  it("ignores tags inside fenced code blocks and inline code (issue #152)", () => {
    const content = [
      "前言 #正文",
      "",
      "```ts",
      "// #apple #foobar",
      "```",
      "",
      "~~~",
      "#include <stdio.h>",
      "~~~",
      "",
      "行内 `#inline` 保留 #尾部",
    ].join("\n");
    expect(extractTags(content)).toEqual(["正文", "尾部"]);
  });

  it("keeps a tag right before a fence and handles unclosed fences", () => {
    expect(extractTags("#正文\n\n```\nconst x = 1;\n```")).toEqual(["正文"]);
    expect(extractTags("正文 #a\n```\n#b")).toEqual(["a"]);
  });

  it("deduplicates repeated tags", () => {
    expect(extractTags("#a #a #b/a")).toEqual(["a", "b/a"]);
  });
});

describe("memoTitle", () => {
  it("strips the block syntax that reads as noise on one truncated line", () => {
    expect(memoTitle("## 阅读笔记：The Art of Noticing")).toBe(
      "阅读笔记：The Art of Noticing",
    );
    expect(memoTitle("- [ ] 依赖漏洞排期")).toBe("依赖漏洞排期");
    expect(memoTitle("> 简约不是少，而是没有多余。")).toBe(
      "简约不是少，而是没有多余。",
    );
    expect(memoTitle("1. 每天记录一件小事")).toBe("每天记录一件小事");
  });

  it("skips a leading blank line and a pure tag line", () => {
    expect(memoTitle("\n\n#产品 #删减")).toBe("");
    expect(memoTitle("#产品 #删减\n深夜想法：删掉比优化更有价值。")).toBe(
      "深夜想法：删掉比优化更有价值。",
    );
    // A heading marker followed by a space is a heading, not a tag run.
    expect(memoTitle("# 第三轮性能收口")).toBe("第三轮性能收口");
  });

  it("truncates long lines and leaves short ones intact", () => {
    const long = "长".repeat(100);
    expect(memoTitle(long, 10)).toBe(`${"长".repeat(10)}…`);
    expect(memoTitle("短句")).toBe("短句");
  });

  it("returns an empty string for a memo with no prose", () => {
    expect(memoTitle("")).toBe("");
    expect(memoTitle("```\ncode only\n```")).toBe("");
  });
});

describe("memoTitle inline markup", () => {
  it("drops emphasis, code and strikethrough delimiters", () => {
    expect(
      memoTitle("深夜想法：**如果一个功能没人用，删掉它更有价值。**"),
    ).toBe("深夜想法：如果一个功能没人用，删掉它更有价值。");
    expect(memoTitle("用 `d1IdsPerStatement` 分块")).toBe(
      "用 d1IdsPerStatement 分块",
    );
    expect(memoTitle("~~作废~~ 改走手动部署")).toBe("作废 改走手动部署");
    expect(memoTitle("**整个标题都是粗体**")).toBe("整个标题都是粗体");
  });

  it("keeps link text and drops the URL", () => {
    expect(memoTitle("参考 [设计稿](https://example.com/a) 的第三节")).toBe(
      "参考 设计稿 的第三节",
    );
  });
});

describe("memoExcerpt", () => {
  it("joins every prose line without markdown syntax", () => {
    expect(
      memoExcerpt(
        "周末计划\n- [ ] 买菜\n- [x] 洗衣服\n\n```\ncode\n```\n#生活",
      ),
    ).toBe("周末计划 买菜 洗衣服");
  });

  it("truncates and returns an empty string without prose", () => {
    expect(memoExcerpt(`${"长".repeat(20)}\n${"长".repeat(20)}`, 10)).toBe(
      `${"长".repeat(10)}…`,
    );
    expect(memoExcerpt("#a #b")).toBe("");
  });
});
