/**
 * Timestamp support for audio transcript memos.
 *
 * A transcript pairs one audio attachment with the memo body. When the body
 * carries clock markers (`[00:12:30]`, `(12:30)`, a bare `12:30`), the reading
 * view turns them into anchors that seek the player. Rewriting happens before
 * Markdown parsing so the markers become ordinary links; the renderer only has
 * to intercept the `#flaremo-t=` fragment.
 */

/** Fragment prefix that marks a link as a player seek target. */
export const TRANSCRIPT_TIME_HREF_PREFIX = "#flaremo-t=";

/** Link text carries the original clock so the anchor still reads naturally. */
export function timestampHref(seconds: number) {
  return `${TRANSCRIPT_TIME_HREF_PREFIX}${Math.floor(seconds)}`;
}

export function isTimestampHref(href: string | undefined) {
  return (
    typeof href === "string" && href.startsWith(TRANSCRIPT_TIME_HREF_PREFIX)
  );
}

/** Reads the seek target out of a timestamp href; null when malformed. */
export function parseTimestampHref(href: string): number | null {
  if (!isTimestampHref(href)) return null;
  const raw = href.slice(TRANSCRIPT_TIME_HREF_PREFIX.length);
  if (!/^\d+$/.test(raw)) return null;
  const seconds = Number(raw);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

/**
 * Parses `HH:MM:SS`, `MM:SS` or `SS` into seconds. Returns null for anything
 * that is not a valid clock, so callers never turn prose like `1:99` into a
 * seek target.
 */
export function parseClock(text: string): number | null {
  const match = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;

  const [first, second, third] = [match[1], match[2], match[3]];
  const hours = third === undefined ? 0 : Number(first);
  const minutes = third === undefined ? Number(first) : Number(second);
  const seconds = third === undefined ? Number(second) : Number(third);

  if (minutes > 59 || seconds > 59) return null;
  if (third !== undefined && hours > 99) return null;

  return hours * 3600 + minutes * 60 + seconds;
}

/** Formats seconds as `HH:MM:SS`, or `MM:SS` under an hour. */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(remainder)}`
    : `${pad(minutes)}:${pad(remainder)}`;
}

/**
 * A leading clock marker, in the forms transcripts actually use:
 * `[00:12:30]`, `(12:30)`, `12:30 -`, or a bare `12:30` at line start.
 * The value group is captured so the rewrite can validate it.
 */
const LEADING_TIME =
  /^(\s*(?:[-*>]\s+)?)(?:\[|\()?\s*(\d{1,2}:\d{1,2}(?::\d{1,2})?)\s*(?:\]|\))?(\s*[-–—:]?\s*)/;

/**
 * True when the body contains at least one line-leading clock marker. Used to
 * skip the rewrite entirely for prose that never mentions times.
 */
export function detectTimestamps(content: string): boolean {
  let inFence = false;
  for (const line of content.split("\n")) {
    if (isFence(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || isQuotedLine(line)) continue;
    const match = LEADING_TIME.exec(line);
    if (match && parseClock(match[2]) !== null) return true;
  }
  return false;
}

/**
 * Rewrites line-leading clock markers into seekable Markdown links. Fenced code
 * and blockquotes are left untouched: a `12:30` in a code sample or a quoted
 * passage is content, not a cue. Bodies without markers come back unchanged.
 */
export function toTimestampHrefMarkdown(content: string): string {
  if (!detectTimestamps(content)) return content;

  let inFence = false;
  return content
    .split("\n")
    .map((line) => {
      if (isFence(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence || isQuotedLine(line)) return line;

      const match = LEADING_TIME.exec(line);
      if (!match) return line;

      const seconds = parseClock(match[2]);
      if (seconds === null) return line;

      const rest = line.slice(match[0].length);
      return `${match[1]}[${match[2]}](${timestampHref(seconds)}) ${rest}`;
    })
    .join("\n");
}

function isFence(line: string) {
  return /^\s*(```|~~~)/.test(line);
}

function isQuotedLine(line: string) {
  return /^\s*>/.test(line);
}
