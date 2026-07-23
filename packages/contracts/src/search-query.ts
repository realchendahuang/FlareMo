export const memoSearchScopes = ["timeline", "archive", "trash"] as const;

export type MemoSearchScope = (typeof memoSearchScopes)[number];

export type MemoSearchFilters = {
  hasAttachment: boolean;
  isPinned: boolean;
  before?: string;
  after?: string;
  scope?: MemoSearchScope;
};

export type ParsedMemoSearchQuery = MemoSearchFilters & {
  text: string;
};

/**
 * Separates supported, whitespace-delimited filters from the text portion of
 * a memo search. Filter-shaped terms only become filters when they are valid;
 * all other terms remain searchable text for backwards compatibility.
 */
export function parseMemoSearchQuery(
  value: string | undefined,
): ParsedMemoSearchQuery {
  const filters: MemoSearchFilters = {
    hasAttachment: false,
    isPinned: false,
  };
  const text: string[] = [];

  for (const term of value?.trim().split(/\s+/u) ?? []) {
    const normalized = term.toLowerCase();
    if (normalized === "has:attachment") {
      filters.hasAttachment = true;
      continue;
    }
    if (normalized === "is:pinned") {
      filters.isPinned = true;
      continue;
    }
    if (normalized.startsWith("before:")) {
      const date = parseMemoSearchDate(term.slice("before:".length));
      if (date) {
        filters.before = date;
        continue;
      }
    }
    if (normalized.startsWith("after:")) {
      const date = parseMemoSearchDate(term.slice("after:".length));
      if (date) {
        filters.after = date;
        continue;
      }
    }
    if (normalized.startsWith("in:")) {
      const scope = normalized.slice("in:".length);
      if (isMemoSearchScope(scope)) {
        filters.scope = scope;
        continue;
      }
    }
    text.push(term);
  }

  return { ...filters, text: text.join(" ") };
}

function isMemoSearchScope(value: string): value is MemoSearchScope {
  return (memoSearchScopes as readonly string[]).includes(value);
}

function parseMemoSearchDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}
