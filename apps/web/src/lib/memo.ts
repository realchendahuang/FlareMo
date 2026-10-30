import type { Memo } from "@/api";
import { stripResourceName } from "@/lib/utils";

export function getMemoResourceId(memo: Memo) {
  return stripResourceName(memo.name, "memos");
}

/**
 * Tag syntax mirrors the server-side extractor in
 * `packages/domain/src/tags.ts`. The composer computes `payload.tags` for new
 * memos and the server trusts those values, so both sides must agree on the
 * charset and on what counts as code (issue #152): a `#comment` inside a
 * fenced block or an inline code span is not a tag. Keep the two in sync.
 */
const TAG_PATTERN = /(^|[^\p{L}\p{N}_\-/])#([\p{L}\p{N}_\-/]+)/gu;

export function extractTags(content: string) {
  const tags = new Set<string>();
  for (const match of maskMarkdownLiteralCode(content).matchAll(TAG_PATTERN)) {
    const raw = match[2];
    if (raw) tags.add(raw);
  }
  return [...tags];
}

/**
 * Replace fenced code blocks and inline code spans with spaces (newlines are
 * kept) so tag boundaries match on the prose that remains. Mirrors the
 * literal-segment rules in `packages/domain/src/tags.ts`.
 */
function maskMarkdownLiteralCode(content: string) {
  const masked: string[] = [];
  let inFence = false;
  let fenceChar = "";
  let fenceLength = 0;
  for (const line of content.split(/(?<=\n)/)) {
    if (inFence) {
      masked.push(maskLine(line));
      // Closing fence: same character, at least as long, nothing after it.
      const marker = line.trimEnd().match(/^[ \t]*(~{3,}|`{3,})[ \t]*$/)?.[1];
      if (marker && marker[0] === fenceChar && marker.length >= fenceLength) {
        inFence = false;
        fenceChar = "";
        fenceLength = 0;
      }
      continue;
    }
    const opening = line.match(/^[ \t]*(~{3,}|`{3,})/)?.[1];
    if (opening) {
      inFence = true;
      fenceChar = opening[0] ?? "";
      fenceLength = opening.length;
      masked.push(maskLine(line));
      continue;
    }
    masked.push(maskInlineCode(line));
  }
  return masked.join("");
}

function maskLine(line: string) {
  return line.replace(/[^\n]/g, " ");
}

function maskInlineCode(line: string) {
  let masked = "";
  let cursor = 0;
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "`") {
      index += 1;
      continue;
    }
    let run = 0;
    while (line[index + run] === "`") run += 1;
    const close = line.indexOf("`".repeat(run), index + run);
    if (close === -1) {
      index += run;
      continue;
    }
    masked += maskLine(line.slice(cursor, index));
    masked += maskLine(line.slice(index, close + run));
    cursor = close + run;
    index = cursor;
  }
  return masked + line.slice(cursor);
}

/**
 * Formatter caches. Constructing `Intl` objects is one of the more expensive
 * things a render can do — a timeline card formats its timestamp twice, and
 * a hundred cards re-rendering meant hundreds of constructions per frame.
 * Keyed by locale plus the variant flags, so switching language still works.
 */
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();

function getDateTimeFormatter(locale: string | undefined, withYear: boolean) {
  const key = `${locale ?? ""}|${withYear ? "y" : "n"}`;
  let formatter = dateTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      ...(withYear ? { year: "numeric" } : {}),
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    dateTimeFormatters.set(key, formatter);
  }
  return formatter;
}

function getRelativeTimeFormatter(locale: string | undefined) {
  const key = locale ?? "";
  let formatter = relativeTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeTimeFormatters.set(key, formatter);
  }
  return formatter;
}

/**
 * Absolute timestamp for a memo. The year is only spelled out when it differs
 * from the current one: imported backfills routinely span many years (issue
 * #143), and two memos from the same month/day in different years used to be
 * indistinguishable in the timeline. Future-dated rows (clock skew, dirty
 * imports) take the same branch, so a future year is never shown year-less.
 */
export function formatMemoTime(value: string, locale?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return getDateTimeFormatter(locale, !sameYear).format(date);
}

/**
 * A one-line human handle for a memo, used where the row's identity must be
 * readable rather than machine-parseable (the detail page header). Drops the
 * markdown syntax that would render as noise in a single truncated line —
 * heading hashes, list bullets, task checkboxes, quote marks, emphasis
 * markers — and the trailing tag run, which the card below already shows as
 * chips. Returns "" for a memo with no prose, so callers can fall back to a
 * timestamp instead of rendering an empty heading.
 */
export function memoTitle(content: string, maxLength = 80) {
  for (const prose of memoProseLines(content)) {
    return truncateProse(prose, maxLength);
  }
  return "";
}

/**
 * A memo's prose as one plain-text run, for previews that show more than the
 * first line (related notes on the detail page). Same stripping as
 * `memoTitle`, so a preview never shows `- [ ]`, `**` or a code fence.
 */
export function memoExcerpt(content: string, maxLength = 160) {
  let text = "";
  for (const prose of memoProseLines(content)) {
    text = text ? `${text} ${prose}` : prose;
    if (text.length > maxLength) break;
  }
  return truncateProse(text, maxLength);
}

function truncateProse(prose: string, maxLength: number) {
  return prose.length > maxLength
    ? `${prose.slice(0, maxLength).trimEnd()}…`
    : prose;
}

function* memoProseLines(content: string) {
  const lines = content.split("\n");
  const isTagLine = (line: string) =>
    /^\s*(#[^\s#]+[\s,，、]*)+$/.test(line) && !/^\s*#\s/.test(line);
  // Fenced code is skipped whole: the opening fence would otherwise be
  // stripped as noise and leave the code's first line masquerading as prose.
  let inFence = false;
  let fenceMarker = "";
  for (const raw of lines) {
    const fence = raw.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[0];
      } else if (fence[0] === fenceMarker) {
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }
    if (inFence) continue;
    const line = stripInlineMarkdown(
      raw
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, "")
        .replace(/^\s*[-*+]\s+/, "")
        .replace(/^\s*\d+\.\s+/, "")
        .trim(),
    );
    if (!line) continue;
    if (isTagLine(line)) continue;
    // Inline tags are filing, not prose: a title reads without them.
    const prose = line
      .replace(new RegExp(TAG_PATTERN.source, "gu"), "$1")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!prose) continue;
    yield prose;
  }
}

/**
 * Removes the inline syntax that only reads as syntax when it is *rendered*:
 * emphasis, strikethrough and inline code. A header is a plain string, so
 * `**bold**` and `` `code` `` arrive with their delimiters intact and look
 * like typos. Link text is kept, its URL dropped — the URL is never the
 * sentence.
 */
function stripInlineMarkdown(line: string) {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+([^`]+)`+/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .trim();
}

/**
 * Timeline timestamps read as relative time ("3 hours ago" / "3 小时前")
 * for the past week and fall back to an absolute date beyond that.
 */
export function formatMemoRelativeTime(value: string, locale?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  if (absSeconds >= 7 * 86_400) return formatMemoTime(value, locale);
  const rtf = getRelativeTimeFormatter(locale);
  if (absSeconds < 45) return rtf.format(0, "second");
  if (absSeconds < 3_600)
    return rtf.format(Math.round(diffSeconds / 60), "minute");
  if (absSeconds < 86_400)
    return rtf.format(Math.round(diffSeconds / 3_600), "hour");
  return rtf.format(Math.round(diffSeconds / 86_400), "day");
}
