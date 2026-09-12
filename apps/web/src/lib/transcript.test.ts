import { describe, expect, it } from "vitest";
import {
  detectTimestamps,
  formatClock,
  isTimestampHref,
  parseClock,
  parseTimestampHref,
  timestampHref,
  toTimestampHrefMarkdown,
} from "./transcript";

describe("transcript clock parsing", () => {
  it("parses MM:SS and HH:MM:SS into seconds", () => {
    expect(parseClock("12:30")).toBe(750);
    expect(parseClock("00:12:30")).toBe(750);
    expect(parseClock("01:00:00")).toBe(3600);
  });

  it("rejects invalid clocks instead of guessing", () => {
    expect(parseClock("1:99")).toBeNull();
    expect(parseClock("12:60")).toBeNull();
    expect(parseClock("100:00")).toBeNull();
    expect(parseClock("abc")).toBeNull();
    expect(parseClock("")).toBeNull();
  });

  it("formats seconds as MM:SS or HH:MM:SS", () => {
    expect(formatClock(750)).toBe("12:30");
    expect(formatClock(4350)).toBe("01:12:30");
    expect(formatClock(-5)).toBe("00:00");
  });
});

describe("transcript timestamp hrefs", () => {
  it("round-trips a seek target", () => {
    const href = timestampHref(750);
    expect(href).toBe("#flaremo-t=750");
    expect(isTimestampHref(href)).toBe(true);
    expect(parseTimestampHref(href)).toBe(750);
  });

  it("returns null for non-timestamp links", () => {
    expect(isTimestampHref("https://example.com")).toBe(false);
    expect(parseTimestampHref("#flaremo-t=abc")).toBeNull();
    expect(parseTimestampHref("#other=12")).toBeNull();
  });
});

describe("transcript markdown rewriting", () => {
  it("rewrites bracketed, parenthesised and bare leading markers", () => {
    const out = toTimestampHrefMarkdown(
      ["[00:12:30] 第一段", "(12:30) 第二段", "12:30 - 第三段"].join("\n"),
    );

    expect(out.split("\n")).toEqual([
      "[00:12:30](#flaremo-t=750) 第一段",
      "[12:30](#flaremo-t=750) 第二段",
      "[12:30](#flaremo-t=750) 第三段",
    ]);
  });

  it("keeps list markers ahead of the rewritten link", () => {
    expect(toTimestampHrefMarkdown("- 12:30 会议")).toBe(
      "- [12:30](#flaremo-t=750) 会议",
    );
  });

  it("leaves prose, headings and mid-line times untouched", () => {
    const content = "# 标题\n我们 12:30 开始\n普通一段话";
    expect(toTimestampHrefMarkdown(content)).toBe(content);
    expect(detectTimestamps(content)).toBe(false);
  });

  it("does not rewrite times inside fenced code or blockquotes", () => {
    const content = [
      "```",
      "12:30 not a cue",
      "```",
      "> 12:30 也是引用",
      "[00:01:00] 才是提示",
    ].join("\n");

    expect(toTimestampHrefMarkdown(content)).toBe(
      [
        "```",
        "12:30 not a cue",
        "```",
        "> 12:30 也是引用",
        "[00:01:00](#flaremo-t=60) 才是提示",
      ].join("\n"),
    );
  });

  it("returns content unchanged when there is no timestamp", () => {
    const content = "只有普通文字，没有任何时间标记。";
    expect(toTimestampHrefMarkdown(content)).toBe(content);
  });
});
