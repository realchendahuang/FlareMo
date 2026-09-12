/**
 * Heading outline extraction for the reading view.
 *
 * The renderer and the table of contents must agree on heading ids, so both
 * sides derive them from the same slug rules here. Ids are generated locally
 * rather than through rehype-slug: the dependency is not available offline and
 * the rule set we need is small.
 */

export type OutlineEntry = {
  depth: number;
  text: string;
  id: string;
};

/**
 * GitHub-style slugger with de-duplication. Repeated headings get a `-1`, `-2`
 * suffix so every id in a document stays unique.
 */
export function createSlugger() {
  const seen = new Map<string, number>();

  return function slug(text: string) {
    const base =
      text
        .trim()
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}\s-]/gu, "")
        .replaceAll(/\s+/gu, "-") || "section";

    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

/** Slugifies a single heading with no de-duplication context. */
export function slugifyHeading(text: string) {
  return createSlugger()(text);
}

/** Strips inline Markdown so a heading's outline label reads as plain text. */
export function headingText(raw: string) {
  return raw
    .replaceAll(/`([^`]*)`/gu, "$1")
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replaceAll(/[*_~]/gu, "")
    .trim();
}

/**
 * Extracts ATX headings in document order, skipping fenced code and blockquotes
 * so a `#` inside a code sample never becomes a section. Ids follow the same
 * slugger the renderer uses, so anchors and the outline point at one target.
 */
export function extractOutline(content: string): OutlineEntry[] {
  const slug = createSlugger();
  const entries: OutlineEntry[] = [];
  let inFence = false;

  for (const line of content.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || /^\s*>/.test(line)) continue;

    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!match) continue;

    const text = headingText(match[2]);
    if (!text) continue;

    entries.push({ depth: match[1].length, text, id: slug(text) });
  }

  return entries;
}
