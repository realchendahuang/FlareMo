/**
 * Tag parsing shared by the server and the composer.
 *
 * This used to exist twice (domain + apps/web/src/lib/memo.ts) with a "keep in
 * sync" comment, and the copies had already drifted: the web version skipped
 * code but not URLs, and never lowercased or trimmed segments. The parser is
 * pure, so it lives in contracts where both sides can import it.
 */

/**
 * Normalize one raw tag value into a canonical tag path.
 *
 * Rules:
 * - Strip a single leading `#`.
 * - Lowercase for consistent matching.
 * - Trim each path segment so `父/ 子` becomes `父/子`.
 * - Collapse duplicate separators and drop trailing separators.
 * - Reject empty results and values longer than 100 chars.
 */
export function normalizeTag(value: string): string | undefined {
  const raw = value.trim().replace(/^#/, "");
  const segments = raw
    .split("/")
    .map((segment) => segment.trim().toLocaleLowerCase())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return undefined;
  const tag = segments.join("/");
  if (tag.length > 100) return undefined;
  return tag;
}

/**
 * Maximum tags accepted for a single memo. The write path inserts one row per
 * tag with four bound columns, and D1 rejects any statement past 100
 * parameters — so this ceiling is what keeps a single memo's tag insert
 * inside one statement. It also bounds what a client can make us write.
 */
export const MAX_MEMO_TAGS = 20;

/**
 * Normalize an array of raw tag values into a sorted, de-duplicated list of
 * canonical tag paths. Values that fail normalization are dropped.
 */
export function normalizeMemoTags(values: string[]) {
  const tags = new Set<string>();
  for (const value of values) {
    const tag = normalizeTag(value);
    if (tag) tags.add(tag);
    if (tags.size >= MAX_MEMO_TAGS) break;
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

/** The token shape shared by extraction and title cleanup. */
export const TAG_PATTERN = /(^|[^\p{L}\p{N}_\-/])#([\p{L}\p{N}_\-/]+)/gu;

/**
 * Extract `#tag` tokens from memo content. Supports hierarchical tags using
 * `/` as the path separator (`#工作/项目A`). Stops at whitespace or
 * punctuation so `#tag，` still yields `tag`.
 *
 * Code is not prose: fenced code blocks and inline code spans are skipped, so
 * a `#comment` or `#include` inside a snippet never becomes a tag (issue #152).
 */
export function extractTags(content: string) {
  const tags = new Set<string>();
  for (const { text, literal } of splitMarkdownLiteralSegments(content)) {
    if (literal) continue;
    for (const match of text.matchAll(TAG_PATTERN)) {
      const raw = match[2];
      if (!raw) continue;
      const tag = normalizeTag(raw);
      if (tag) tags.add(tag);
    }
  }
  return [...tags];
}

/**
 * Split content into segments, marking fenced code blocks, inline code spans,
 * and URLs as literal (untouched). Returns the pieces in order.
 *
 * Fence bookkeeping: prose before the opening fence stays ordinary so tags
 * sitting right before a code block remain rewritable; the opening fence line,
 * the code body, and the closing fence are all literal so samples are never
 * rewritten or mined for tags. An unclosed fence runs literal to the end.
 */
export function splitMarkdownLiteralSegments(
  content: string,
): { text: string; literal: boolean }[] {
  const pieces: { text: string; literal: boolean }[] = [];
  const push = (text: string, literal: boolean) => {
    if (text) pieces.push({ text, literal });
  };
  const lines = content.split(/(?<=\n)/);
  let inFence = false;
  let fenceChar = "";
  let fenceLength = 0;
  let code = "";
  let plain = "";
  for (const line of lines) {
    if (inFence) {
      code += line;
      // Closing fence: same character, at least as long, nothing after it.
      const marker = line.trimEnd().match(/^[ \t]*(~{3,}|`{3,})[ \t]*$/)?.[1];
      if (marker && marker[0] === fenceChar && marker.length >= fenceLength) {
        // The whole block — body, closing fence included — is literal.
        push(code, true);
        code = "";
        inFence = false;
        fenceChar = "";
        fenceLength = 0;
      }
      continue;
    }
    const opening = line.match(/^[ \t]*(~{3,}|`{3,})/)?.[1];
    if (opening) {
      // Flush prose collected before the fence as ordinary text, then mark
      // only the fence line itself (and everything after it) literal.
      push(plain, false);
      plain = "";
      push(line, true);
      inFence = true;
      fenceChar = opening[0] ?? "";
      fenceLength = opening.length;
      continue;
    }
    // Split inline code spans and URLs out of ordinary lines.
    let cursor = 0;
    let index = 0;
    while (index < line.length) {
      const character = line[index];
      if (character === "`") {
        let run = 0;
        while (line[index + run] === "`") run += 1;
        const close = line.indexOf("`".repeat(run), index + run);
        if (close !== -1) {
          // Flush the prose before the span first: pieces are concatenated in
          // order, so a buffered `plain` must not overtake this literal.
          plain += line.slice(cursor, index);
          push(plain, false);
          plain = "";
          pieces.push({
            text: line.slice(index, close + run),
            literal: true,
          });
          cursor = close + run;
          index = cursor;
          continue;
        }
        index += run;
        continue;
      }
      if (
        (character === "h" && line.startsWith("https://", index)) ||
        (character === "h" && line.startsWith("http://", index))
      ) {
        let end = index;
        while (end < line.length && !/\s/.test(line[end] as string)) end += 1;
        plain += line.slice(cursor, index);
        push(plain, false);
        plain = "";
        pieces.push({ text: line.slice(index, end), literal: true });
        cursor = end;
        index = end;
        continue;
      }
      index += 1;
    }
    plain += line.slice(cursor);
  }
  if (inFence) {
    // An unclosed fence swallows everything up to the end of the content.
    push(code, true);
  } else {
    push(plain, false);
  }
  return pieces;
}
