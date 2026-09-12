import { describe, expect, it } from "vitest";
import {
  createSlugger,
  extractOutline,
  headingText,
  slugifyHeading,
} from "./markdown-outline";

describe("outline slugging", () => {
  it("slugifies latin and CJK headings", () => {
    expect(slugifyHeading("Project Plan")).toBe("project-plan");
    expect(slugifyHeading("第一章 · 总览")).toBe("第一章-总览");
  });

  it("de-duplicates repeated headings", () => {
    const slug = createSlugger();
    expect(slug("Overview")).toBe("overview");
    expect(slug("Overview")).toBe("overview-1");
    expect(slug("Overview")).toBe("overview-2");
  });

  it("falls back to a stable slug for punctuation-only headings", () => {
    expect(slugifyHeading("!!!")).toBe("section");
  });
});

describe("outline extraction", () => {
  it("collects headings in document order with depth", () => {
    const outline = extractOutline(
      ["# 标题", "正文", "## 小节 A", "### 细节", "## 小节 A"].join("\n"),
    );

    expect(outline).toEqual([
      { depth: 1, text: "标题", id: "标题" },
      { depth: 2, text: "小节 A", id: "小节-a" },
      { depth: 3, text: "细节", id: "细节" },
      { depth: 2, text: "小节 A", id: "小节-a-1" },
    ]);
  });

  it("strips inline markdown from outline labels", () => {
    expect(headingText("`code` and **bold** and [link](https://x.test)")).toBe(
      "code and bold and link",
    );
  });

  it("ignores headings inside fences and blockquotes", () => {
    const outline = extractOutline(
      ["```", "# 代码里的井号", "```", "> # 引用里的井号", "# 真正的标题"].join(
        "\n",
      ),
    );

    expect(outline).toEqual([
      { depth: 1, text: "真正的标题", id: "真正的标题" },
    ]);
  });

  it("requires a space after the hash, matching CommonMark", () => {
    expect(extractOutline("#没有空格")).toEqual([]);
  });

  it("returns an empty outline for plain prose", () => {
    expect(extractOutline("没有任何标题的一段话。")).toEqual([]);
  });
});
