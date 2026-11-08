import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InsightResultView, renderInsightValue } from "./insight-result-view";

function render(value: unknown) {
  return renderToStaticMarkup(<InsightResultView result={value} />);
}

describe("InsightResultView", () => {
  it("renders a plain string with its line breaks", () => {
    const html = render("第一条\n第二条");
    expect(html).toContain("第一条\n第二条");
  });

  it("renders an executor's object shape as labeled values", () => {
    const html = render({
      summary: "本周完成了洞察契约后端",
      highlights: ["schema", "状态机"],
    });
    expect(html).toContain("summary");
    expect(html).toContain("本周完成了洞察契约后端");
    expect(html).toContain("highlights");
    expect(html).toContain("schema");
    expect(html).toContain("<li>");
  });

  it("handles primitives and null-ish values", () => {
    expect(render(42)).toContain("42");
    expect(render(true)).toContain("true");
    expect(render(null)).toBe("");
  });

  it("falls back to pretty JSON past the nesting cap", () => {
    const deep = { a: { b: { c: { d: "too deep" } } } };
    const html = render(deep);
    expect(html).toContain("&quot;d&quot;: &quot;too deep&quot;");
    expect(html).toContain("<pre");
  });

  it("clips long arrays instead of flooding the page", () => {
    const html = render(
      Array.from({ length: 40 }, (_, index) => `item-${index}`),
    );
    expect(html).toContain("item-0");
    expect(html).not.toContain("item-39");
    expect(html).toContain("…");
  });

  it("drops the outer empty case when the executor returned nothing", () => {
    expect(renderInsightValue(null)).toBeTruthy();
  });
});
