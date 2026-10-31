// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { buildComposerExtensions } from "./rich-composer-editor";

/**
 * Markdown round-trip idempotence for the composer whitelist. The storage
 * format is plain GFM text, so the hard requirement is: whatever the editor
 * serializes must re-parse to itself — a memo saved once and reopened must
 * not drift. Fresh input is allowed to normalize (e.g. spacing); the second
 * pass may not change anything.
 */
describe("composer markdown round-trip", () => {
  const editor = new Editor({
    extensions: buildComposerExtensions(""),
    content: "",
    contentType: "markdown",
  });

  const round = (markdown: string) => {
    editor.commands.setContent(markdown, { contentType: "markdown" });
    return editor.getMarkdown();
  };

  // The "[[" autocomplete inserts a link mark. Inserting the markdown as
  // literal text instead used to save `\[title\](/memo/id)`: a dead link.
  it("stores an accepted wikilink as a real markdown link", () => {
    editor.commands.setContent("看 [[周", { contentType: "markdown" });
    const end = editor.state.doc.content.size - 1;
    editor
      .chain()
      .insertContentAt({ from: end - 3, to: end }, [
        {
          type: "text",
          text: "周报",
          marks: [{ type: "link", attrs: { href: "/memo/abc" } }],
        },
        { type: "text", text: " " },
      ])
      .unsetMark("link")
      .insertContent("续写")
      .run();
    expect(editor.getMarkdown()).toBe("看 [周报](/memo/abc) 续写");
  });

  // Every element on the composer whitelist, plus the classic stress cases
  // (nested quotes, CJK, hard breaks, characters markdown likes to escape).
  const samples: string[] = [
    "",
    "只有一段话的旧笔记。",
    "# 一级标题\n\n正文带 **加粗**、*斜体*、~~删除线~~ 和 `行内代码`。",
    "## Heading two\n\n### Heading three\n\nSome prose.",
    "> 引用第一层\n>\n> > 引用第二层",
    "- 无序一\n- 无序二\n  - 嵌套项",
    "1. 第一\n2. 第二\n3. 第三",
    "- [ ] 未完成任务\n- [x] 已完成任务",
    "```js\nconst x = 1;\n```",
    "---",
    "段落前\n\n---\n\n段落后",
    "![附件图](/file/attachments/0000-aa/shot.png)",
    "链接到 [FlareMo](https://flaremo.app) 的正文。",
    "#生活 #workout 混排标签",
    "行尾两个空格是硬换行  \n下一行接续",
    "星号 * 与下划线 _ 与反引号 ` 的字面量",
    "2 * 3 * 4 和 snake_case_word",
    "emoji 🎉 与日文 千字あ与韩文 한글 混排",
    "表格之外先不进白名单：| 井号 | 普通文字 |",
  ];

  it.each(samples)("stays stable after the first serialization: %s", (md) => {
    const once = round(md);
    const twice = round(once);
    expect(twice).toBe(once);
  });

  it("keeps the whitelist semantics on the way out", () => {
    expect(round("# 标题\n\n**粗** *斜* ~~删~~ `码`")).toContain("# 标题");
    expect(round("- [ ] 待办")).toContain("- [ ] 待办");
    expect(round("- [x] 完成")).toContain("- [x] 完成");
    expect(round("![图](/file/attachments/x/y.png)")).toContain(
      "![图](/file/attachments/x/y.png)",
    );
    expect(round("看 #标签")).toContain("#标签");
    expect(round("```\nconst x = 1;\n```")).toContain("const x = 1;");
  });

  it("keeps runs of spaces and hash marks through a round trip", () => {
    // What the card shows is rendered from this stored text, so the editor
    // must not eat the spaces or the `#` someone typed.
    for (const sample of [
      "hello  world",
      "a    b",
      "#tag",
      "text #tag",
      "C# 语言",
      "价格是 #1 元",
    ]) {
      expect(round(sample)).toBe(sample);
    }
  });

  it("does not resurrect underline or introduce HTML", () => {
    const once = round("正文 <u>下划线</u> 不放行");
    const twice = round(once);
    expect(twice).toBe(once);
    // Inline HTML stays literal text in storage; the card renderer never sees
    // a raw <u> element from the editor's own output.
    expect(once).not.toMatch(/<u>/i);
  });
});
