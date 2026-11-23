import { describe, expect, it } from "vitest";
import {
  extractTags,
  normalizeMemoTags,
  normalizeTag,
  removeTagFromContent,
  rewriteTagInContent,
  tagPrefixMatches,
} from "./tags";

describe("tag normalization", () => {
  it("strips a leading hash, lowercases, and keeps the path shape", () => {
    expect(normalizeTag("#工作/项目A")).toBe("工作/项目a");
    expect(normalizeTag("工作/项目A")).toBe("工作/项目a");
    expect(normalizeTag("  #Tags/Sub  ")).toBe("tags/sub");
  });

  it("normalizes path segments and drops empty or oversized values", () => {
    expect(normalizeTag("#工作/ 项目A ")).toBe("工作/项目a");
    expect(normalizeTag("#工作/")).toBe("工作");
    expect(normalizeTag("#/")).toBeUndefined();
    expect(normalizeTag("")).toBeUndefined();
    expect(normalizeTag("a".repeat(101))).toBeUndefined();
    expect(normalizeTag("a".repeat(100))).toBe("a".repeat(100));
  });

  it("deduplicates and sorts a list of tags", () => {
    expect(normalizeMemoTags(["#B", "#a", "#A/1", "#b"])).toEqual([
      "a",
      "a/1",
      "b",
    ]);
  });
});

describe("extractTags", () => {
  it("extracts plain and hierarchical tags from content", () => {
    expect(
      extractTags(
        "今日 #工作/项目A 推进顺利，#生活/运动 也坚持了，#紧急 事项已处理",
      ),
    ).toEqual(["工作/项目a", "生活/运动", "紧急"]);
  });

  it("stops at punctuation and ignores tags inside words", () => {
    expect(extractTags("#tag，继续")).toEqual(["tag"]);
    expect(extractTags("no#taghere")).toEqual([]);
    expect(extractTags("foo #bar-1 #baz_2")).toEqual(["bar-1", "baz_2"]);
  });

  it("handles multiple tags and leading-tag content", () => {
    expect(extractTags("#lead content #a #b/c")).toEqual(["lead", "a", "b/c"]);
  });

  it("ignores tags inside fenced code blocks and inline code (issue #152)", () => {
    const content = [
      "前言 #正文",
      "",
      "```ts",
      "// #apple #foobar",
      "#!/bin/bash",
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

  it("keeps a tag right before a fence rewritable", () => {
    expect(extractTags("#正文\n\n```\nconst x = 1;\n```")).toEqual(["正文"]);
  });

  it("handles unclosed fences, info strings, and multiple blocks", () => {
    expect(extractTags("#a\n```js\n#b\n#c")).toEqual(["a"]);
    expect(extractTags("#a\n```\n#b\n```\n#c\n~~~\n#d\n~~~\n#e")).toEqual([
      "a",
      "c",
      "e",
    ]);
  });

  it("does not let a ``` fence close a ~~~ block", () => {
    expect(extractTags("正文 #a\n~~~\n#b\n```\n#c\n~~~\n#d")).toEqual([
      "a",
      "d",
    ]);
  });
});

describe("tagPrefixMatches", () => {
  it("matches the tag itself and descendants", () => {
    expect(tagPrefixMatches("工作", "工作")).toBe(true);
    expect(tagPrefixMatches("工作", "工作/项目a")).toBe(true);
    expect(tagPrefixMatches("工作", "工作/项目a/子")).toBe(true);
  });

  it("does not match siblings or unrelated tags", () => {
    expect(tagPrefixMatches("工作", "生活")).toBe(false);
    expect(tagPrefixMatches("工作", "工作x")).toBe(false);
    expect(tagPrefixMatches("工作/项目a", "工作")).toBe(false);
  });
});

describe("rewriteTagInContent", () => {
  it("rewrites a tag and its subtree while keeping unrelated text", () => {
    expect(
      rewriteTagInContent(
        "看 #工作 与 #工作/项目A 和 #工作者",
        "工作",
        "知识/工作",
      ),
    ).toBe("看 #知识/工作 与 #知识/工作/项目A 和 #工作者");
  });

  it("rewrites at the start of content and after punctuation", () => {
    expect(rewriteTagInContent("#工作 开始", "工作", "知识")).toBe(
      "#知识 开始",
    );
    expect(rewriteTagInContent("记录，#工作 事项", "工作", "知识")).toBe(
      "记录，#知识 事项",
    );
  });

  it("does not rewrite hyphenated or word-embedded tags", () => {
    expect(rewriteTagInContent("#工作-1 和 #工作x", "工作", "知识")).toBe(
      "#工作-1 和 #工作x",
    );
  });

  it("matches tag casing case-insensitively", () => {
    expect(rewriteTagInContent("见 #工作/项目A", "工作", "知识/工作")).toBe(
      "见 #知识/工作/项目A",
    );
  });

  it("rewrites prose around fenced blocks but never the code", () => {
    expect(
      rewriteTagInContent(
        '#工作 正文\n\n```js\nconst s = "#工作";\n```\n\n行内 `#工作` 结束 #工作',
        "工作",
        "知识",
      ),
    ).toBe(
      '#知识 正文\n\n```js\nconst s = "#工作";\n```\n\n行内 `#工作` 结束 #知识',
    );
    expect(
      rewriteTagInContent("~~~\n#工作\n~~~\n正文 #工作", "工作", "知识"),
    ).toBe("~~~\n#工作\n~~~\n正文 #知识");
  });

  it("keeps an unclosed fence literal to the end", () => {
    expect(rewriteTagInContent("正文 #工作\n```\n#工作", "工作", "知识")).toBe(
      "正文 #知识\n```\n#工作",
    );
  });

  it("keeps inline-code literals in reading order", () => {
    expect(rewriteTagInContent("行内 `#工作` 结束 #工作", "工作", "知识")).toBe(
      "行内 `#工作` 结束 #知识",
    );
  });
});

describe("removeTagFromContent", () => {
  it("removes exact tags while keeping child tags and text", () => {
    expect(
      removeTagFromContent("记录 #工作/项目A 和 #工作 的进展 #工作者", "工作"),
    ).toBe("记录 #工作/项目A 和  的进展 #工作者");
  });

  it("removes a leading tag cleanly", () => {
    expect(removeTagFromContent("#工作 内容", "工作")).toBe(" 内容");
  });

  it("matches tag casing case-insensitively", () => {
    expect(
      removeTagFromContent("写 #知识/工作/项目A 笔记", "知识/工作/项目a"),
    ).toBe("写  笔记");
  });

  it("removes prose tags but never fenced code", () => {
    expect(removeTagFromContent("正文 #工作\n\n```\n#工作\n```", "工作")).toBe(
      "正文 \n\n```\n#工作\n```",
    );
  });
});
