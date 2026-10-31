// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MemoContent } from "./memo-content";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("MemoContent", () => {
  it("renders single newline as <br> via remark-breaks", () => {
    const raw = "第一行\n第二行";
    const html = renderToStaticMarkup(<MemoContent content={raw} />);
    expect(html).toContain("第一行<br/>\n第二行");
  });

  it("keeps the blank lines a note was written with", () => {
    const html = renderToStaticMarkup(
      <MemoContent content={"212\n\n\n\nhh"} />,
    );
    // One blank line separates the paragraphs; each one beyond it stays.
    expect(html.match(/<p><br\/>/g)).toHaveLength(2);
    expect(html).toContain("<p>212</p>");
    expect(html).toContain("<p>hh</p>");
  });

  it("does not invent blank lines inside a code block", () => {
    const html = renderToStaticMarkup(
      <MemoContent content={"```\n212\n\n\nhh\n```"} />,
    );
    expect(html).toContain("<pre>");
    expect(html).not.toContain("<p><br");
  });

  it("leaves a real blockquote untouched", () => {
    const html = renderToStaticMarkup(<MemoContent content={"> 原文引用"} />);
    expect(html).toContain("<blockquote>");
    expect(html).toContain("原文引用");
  });

  it("shows a lone hash instead of swallowing it as an empty heading", () => {
    const html = renderToStaticMarkup(<MemoContent content={"#\n\n212"} />);
    expect(html).toContain("<p>#</p>");
    expect(html).not.toContain("<h1");
    expect(html).toContain("<p>212</p>");
  });

  it("keeps indentation and runs of spaces", () => {
    const html = renderToStaticMarkup(
      <MemoContent content={"a  b\n    indented"} />,
    );
    expect(html).toContain("a  b");
    expect(html).toContain("indented");
    expect(html).not.toContain("<pre>");
  });

  it("still renders a real heading and a real tag", () => {
    const html = renderToStaticMarkup(
      <MemoContent content={"# 标题\n\n#tag"} />,
    );
    expect(html).toContain("<h1");
    expect(html).toContain("标题");
    expect(html).toContain('class="memo-tag"');
  });

  it("renders two newlines as distinct paragraphs", () => {
    const raw = "第一段\n\n第二段";
    const html = renderToStaticMarkup(<MemoContent content={raw} />);
    expect(html).toContain("<p>第一段</p>\n<p>第二段</p>");
  });
});
