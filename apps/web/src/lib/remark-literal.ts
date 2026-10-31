/**
 * Keeps a note looking like what was written.
 *
 * Markdown collapses a run of blank lines into one paragraph break, drops
 * indentation, and reads a line of only `#` as an empty heading — so a note
 * saved with breathing room comes back flat, and a lone `#` vanishes. A note
 * is a record of what someone typed, so the card shows those literally while
 * real structure (lists, tasks, quotes, code, links, actual headings) stays
 * Markdown. Articles opt out: they are typeset documents, not notes.
 */

type MdNode = {
  type: string;
  value?: string;
  depth?: number;
  children?: MdNode[];
};

const LEADING_INDENT = /^(?:[ ]{2,}|\t+)/;

/** A blank line kept on purpose. `§` is reserved here, so a note that
 *  consists of exactly this never collides; the plugin removes the marker. */
const GAP_MARK = "> §";

/**
 * One blank line already separates paragraphs, so each extra blank line in
 * the source is one empty paragraph. Indentation CommonMark would strip is
 * pinned with a zero-width word joiner, which keeps it from becoming a code
 * block while still rendering as the spaces that were typed.
 */
export function protectLiteralLayout(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inFence = false;
  let blanks = 0;
  const flushBlanks = () => {
    if (blanks === 0) return;
    // One blank line ends a paragraph. Each further blank line would be
    // discarded, so it is marked and turned into a real break by
    // remarkLiteralBreaks, which runs before remark-breaks can fold it away.
    out.push("");
    // A blank line on each side keeps the marker its own block. Without it,
    // remark-breaks glues the marker to the next line and the mark shows.
    for (let i = 1; i < blanks; i++) out.push("", GAP_MARK, "");
    blanks = 0;
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) {
      flushBlanks();
      out.push(line);
      continue;
    }
    if (line.trim() === "") {
      blanks += 1;
      continue;
    }
    flushBlanks();
    out.push(
      LEADING_INDENT.test(line)
        ? line.replace(LEADING_INDENT, "$&\u2060")
        : line,
    );
  }
  flushBlanks();
  return out.join("\n");
}

/**
 * Each gap marker stands for one blank line the author typed beyond the
 * paragraph break. It becomes a hard break, which renders as a line of its own.
 */
export function remarkLiteralBreaks() {
  return (tree: MdNode) => {
    if (!tree.children) return;
    tree.children = tree.children.flatMap((node) => {
      if (node.type !== "blockquote" || node.children?.length !== 1) {
        return [node];
      }
      const inner = node.children[0];
      const only = inner?.children?.length === 1 ? inner.children[0] : null;
      if (only?.type !== "text" || only.value !== "§") return [node];
      // A paragraph holding one hard break. A bare break has no line box, so
      // the blank line would still take no space.
      return [{ type: "paragraph", children: [{ type: "break" }] }];
    });
  };
}

/**
 * A heading whose text is only `#` characters was never a heading — `#`
 * alone, or `## #`, is something someone typed. Put the markers back as text.
 */
export function remarkLiteralHashes() {
  return (tree: MdNode) => {
    if (!tree.children) return;
    tree.children = tree.children.flatMap((node) => {
      if (node.type !== "heading" || !node.children) return [node];
      if (node.children.some((child) => child.type !== "text")) return [node];
      const text = node.children.map((child) => child.value ?? "").join("");
      if (!/^#*$/.test(text.trim())) return [node];
      const marks = `${"#".repeat(node.depth ?? 1)} ${text}`.trim();
      return [
        { type: "paragraph", children: [{ type: "text", value: marks }] },
      ];
    });
  };
}
