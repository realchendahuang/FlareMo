import { Extension } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { findTagRanges } from "@/lib/tag-highlight";

const tagHighlightPluginKey = new PluginKey("tagHighlight");

/**
 * Highlights `#tag` occurrences as brand-colored chips while typing. Purely
 * decorative (an inline Decoration): the document keeps plain `#tag` text, so
 * what the user sends is still ordinary markdown that the card renderer and
 * the API both understand.
 */
export const TagHighlight = Extension.create({
  name: "tagHighlight",

  addProseMirrorPlugins() {
    const plugin = new Plugin({
      key: tagHighlightPluginKey,
      props: {
        decorations(state: EditorState) {
          const { doc } = state;
          const decorations: Decoration[] = [];

          doc.descendants((node, pos, parent) => {
            if (node.type.name !== "text") return;
            // Code is not prose (issue #152): never decorate fenced code
            // blocks or inline code spans as tags, even though the document
            // keeps the plain `#` text for the markdown renderer.
            if (parent?.type.name === "codeBlock") return;
            if (node.marks.some((mark) => mark.type.name === "code")) return;
            // Tags never span lines, so each text node is scanned on its own.
            for (const [start, end] of findTagRanges(node.text ?? "")) {
              decorations.push(
                Decoration.inline(pos + start, pos + end, {
                  class: "composer-tag",
                }),
              );
            }
          });

          return DecorationSet.create(doc, decorations);
        },
      },
    });
    return [plugin];
  },
});
