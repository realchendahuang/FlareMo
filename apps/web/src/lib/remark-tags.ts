/**
 * Turns `#tag` tokens in memo prose into link nodes (`?tag=<name>`) so the
 * renderer can draw them as tag chips in place, the way the text was
 * written. Code and existing links are left alone, matching the extractor
 * in `lib/memo.ts` (a `#comment` inside code is not a tag). The relative
 * `?tag=` href survives react-markdown's URL sanitizer unchanged.
 */

type MdNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
};

// Same charset and boundary rule as TAG_PATTERN in lib/memo.ts.
const TAG_IN_TEXT = /(^|[^\p{L}\p{N}_\-/])#([\p{L}\p{N}_\-/]+)/gu;

export const TAG_HREF_PREFIX = "?tag=";
export const MENTION_HREF_PREFIX = "?mention=";

// Same boundary and charset as the server's mention extractor.
const MENTION_IN_TEXT =
  /(^|[^\p{L}\p{N}_])@([A-Za-z0-9][A-Za-z0-9._-]{0,63})/gu;

export function mentionFromHref(href: string | undefined): string | null {
  if (!href?.startsWith(MENTION_HREF_PREFIX)) return null;
  return href.slice(MENTION_HREF_PREFIX.length) || null;
}

export function tagFromHref(href: string | undefined): string | null {
  if (!href?.startsWith(TAG_HREF_PREFIX)) return null;
  try {
    return decodeURIComponent(href.slice(TAG_HREF_PREFIX.length));
  } catch {
    return null;
  }
}

function splitMentions(value: string): MdNode[] | null {
  const parts: MdNode[] = [];
  let last = 0;
  for (const match of value.matchAll(MENTION_IN_TEXT)) {
    // A trailing dot is sentence punctuation, not part of the name.
    const name = (match[2] ?? "").replace(/[._-]+$/, "");
    if (!name) continue;
    const start = (match.index ?? 0) + (match[1]?.length ?? 0);
    if (start > last)
      parts.push({ type: "text", value: value.slice(last, start) });
    parts.push({
      type: "link",
      url: `${MENTION_HREF_PREFIX}${name}`,
      children: [{ type: "text", value: `@${name}` }],
    });
    last = start + 1 + name.length;
  }
  if (parts.length === 0) return null;
  if (last < value.length)
    parts.push({ type: "text", value: value.slice(last) });
  return parts;
}

function splitText(value: string): MdNode[] | null {
  const parts: MdNode[] = [];
  let last = 0;
  for (const match of value.matchAll(TAG_IN_TEXT)) {
    const tag = match[2];
    if (!tag) continue;
    // A trailing slash is punctuation, not part of the tag path.
    const name = tag.replace(/\/+$/, "");
    if (!name) continue;
    const start = (match.index ?? 0) + (match[1]?.length ?? 0);
    if (start > last)
      parts.push({ type: "text", value: value.slice(last, start) });
    parts.push({
      type: "link",
      url: `${TAG_HREF_PREFIX}${encodeURIComponent(name)}`,
      children: [{ type: "text", value: `#${name}` }],
    });
    last = start + 1 + name.length;
  }
  if (parts.length === 0) return null;
  if (last < value.length)
    parts.push({ type: "text", value: value.slice(last) });
  return parts;
}

const SKIP = new Set(["link", "linkReference", "inlineCode", "code", "html"]);

function walk(node: MdNode) {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value) {
      const split = splitText(child.value);
      const pieces = split ?? [child];
      let changed = Boolean(split);
      for (const piece of pieces) {
        const mentions =
          piece.type === "text" && piece.value
            ? splitMentions(piece.value)
            : null;
        if (mentions) {
          next.push(...mentions);
          changed = true;
        } else if (changed) {
          next.push(piece);
        }
      }
      if (changed) continue;
    } else if (!SKIP.has(child.type)) {
      walk(child);
    }
    next.push(child);
  }
  node.children = next;
}

export function remarkTags() {
  return (tree: MdNode) => {
    walk(tree);
  };
}
