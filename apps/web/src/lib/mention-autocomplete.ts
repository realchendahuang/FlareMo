/**
 * "@name" mentions. The charset and boundary match the server's mention
 * extractor (`findMentionedUsers`): a username starts with a letter or digit
 * and continues with letters, digits, dot, underscore or dash, and the "@"
 * may not follow a letter or digit (so an email address is not a mention).
 */

export type MentionCandidate = {
  username: string;
  displayName: string;
};

export type ActiveMentionToken = {
  /** Index of the "@" in the text. */
  start: number;
  /** Text typed after the "@". */
  token: string;
};

const MENTION_TOKEN_RE = /^[A-Za-z0-9._-]*$/;

/** The in-progress "@name" ending at the caret, if any. */
export function extractActiveMentionToken(
  content: string,
  caret: number,
): ActiveMentionToken | null {
  let runStart = caret;
  while (runStart > 0 && !/\s/.test(content[runStart - 1] ?? "")) {
    runStart -= 1;
  }
  const run = content.slice(runStart, caret);
  if (!run.startsWith("@")) return null;
  const token = run.slice(1);
  if (!MENTION_TOKEN_RE.test(token)) return null;
  return { start: runStart, token };
}

/** Prefix matches on username or display name first, then substrings. */
export function filterMentionSuggestions(
  people: MentionCandidate[],
  token: string,
  limit = 6,
): MentionCandidate[] {
  const query = token.toLocaleLowerCase();
  const starts: MentionCandidate[] = [];
  const includes: MentionCandidate[] = [];
  for (const person of people) {
    const username = person.username.toLocaleLowerCase();
    const display = person.displayName.toLocaleLowerCase();
    if (!query || username.startsWith(query) || display.startsWith(query)) {
      starts.push(person);
    } else if (username.includes(query) || display.includes(query)) {
      includes.push(person);
    }
  }
  return [...starts, ...includes].slice(0, limit);
}
