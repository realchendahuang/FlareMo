// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLinkMetadataCache,
  extractPreviewableUrls,
  MemoContent,
} from "./memo-content";

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  apiRequest: apiRequestMock,
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Array<{
  root: ReturnType<typeof createRoot>;
  container: HTMLDivElement;
}> = [];

beforeEach(() => {
  clearLinkMetadataCache();
  apiRequestMock.mockReset();
});

afterEach(() => {
  for (const { root, container } of roots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

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
    expect(html.match(/<p dir="auto"><br\/>/g)).toHaveLength(2);
    expect(html).toContain('<p dir="auto">212</p>');
    expect(html).toContain('<p dir="auto">hh</p>');
  });

  it("does not invent blank lines inside a code block", () => {
    const html = renderToStaticMarkup(
      <MemoContent content={"```\n212\n\n\nhh\n```"} />,
    );
    expect(html).toContain("<pre>");
    expect(html).not.toContain('<p dir="auto"><br');
  });

  it("leaves a real blockquote untouched with BiDi auto direction", () => {
    const html = renderToStaticMarkup(<MemoContent content={"> 原文引用"} />);
    expect(html).toContain('<blockquote dir="auto">');
    expect(html).toContain("原文引用");
  });

  it("shows a lone hash instead of swallowing it as an empty heading", () => {
    const html = renderToStaticMarkup(<MemoContent content={"#\n\n212"} />);
    expect(html).toContain('<p dir="auto">#</p>');
    expect(html).not.toContain("<h1");
    expect(html).toContain('<p dir="auto">212</p>');
  });

  it("keeps indentation and runs of spaces", () => {
    const html = renderToStaticMarkup(
      <MemoContent content={"a  b\n    indented"} />,
    );
    expect(html).toContain("a  b");
    expect(html).toContain("indented");
    expect(html).not.toContain("<pre>");
  });

  it('isolates #tags and @mentions with <bdi dir="auto"> so RTL UI never flips the leading sigil', () => {
    const html = renderToStaticMarkup(
      <MemoContent content={"# 标题\n\n#产品设计 @kim"} />,
    );
    expect(html).toContain("<h1");
    expect(html).toContain('dir="auto"');
    expect(html).toContain("标题");
    expect(html).toContain('<bdi class="memo-tag" dir="auto">#产品设计</bdi>');
    expect(html).toContain('<bdi class="memo-mention" dir="auto">@kim</bdi>');
  });

  it("renders two newlines as distinct paragraphs", () => {
    const raw = "第一段\n\n第二段";
    const html = renderToStaticMarkup(<MemoContent content={raw} />);
    expect(html).toContain(
      '<p dir="auto">第一段</p>\n<p dir="auto">第二段</p>',
    );
  });

  it("extracts standalone URLs while skipping code spans, images and custom-labelled links", () => {
    const markdown = [
      "看看这条推文：https://x.com/alice/status/1234567890。",
      "参考 [设计规范](https://example.com/ignored-prose-link)",
      "![pic](https://example.com/ignored-image.png)",
      "`https://example.com/ignored-inline-code`",
      "```",
      "https://example.com/ignored-code-block",
      "```",
      "https://en.wikipedia.org/wiki/Closure_(computer_programming))",
    ].join("\n");

    expect(extractPreviewableUrls(markdown)).toEqual([
      "https://x.com/alice/status/1234567890",
      "https://en.wikipedia.org/wiki/Closure_(computer_programming)",
    ]);
  });

  it("hydrates an X/Twitter link preview card and degrades silently on fetch failure", async () => {
    apiRequestMock.mockImplementation(
      async (_path: string, init?: RequestInit) => {
        const { url } = JSON.parse(String(init?.body ?? "{}")) as {
          url: string;
        };
        if (url.includes("x.com")) {
          return {
            url,
            title: "Alice (@alice) on X",
            description: "Ember 3 keeps the surface calm and paper-warm.",
            image: "",
          };
        }
        throw new Error("404");
      },
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push({ root, container });

    await act(async () => {
      root.render(
        <MemoContent
          content={
            "https://x.com/alice/status/99\nhttps://dead.example.com/missing"
          }
        />,
      );
    });

    // Wait one microtask tick for the metadata promise chain to settle.
    await act(async () => {
      await Promise.resolve();
    });

    const cards = container.querySelectorAll(
      '[data-testid="memo-link-preview"]',
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]?.getAttribute("href")).toBe(
      "https://x.com/alice/status/99",
    );
    expect(cards[0]?.textContent).toContain("x.com");
    expect(cards[0]?.textContent).toContain("Alice (@alice) on X");
    expect(cards[0]?.textContent).toContain(
      "Ember 3 keeps the surface calm and paper-warm.",
    );
  });

  it("opens the lightbox when clicking an inline markdown image without wrapping it in a button", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push({ root, container });

    await act(async () => {
      root.render(
        <MemoContent content="![inline-shot](/file/attachments/att-1/shot.png)" />,
      );
    });

    // Keep bare <img> (no <button> wrapper) so gallery dedup role queries stay exact.
    expect(container.querySelector("button")).toBeNull();
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img).toBeTruthy();

    await act(async () => {
      img.click();
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
  });
});
