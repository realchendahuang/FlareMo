import { parseMemoSearchQuery } from "@flaremo/contracts/search-query";

/**
 * Returns only the terms that can match memo content. Search operators are
 * intentionally removed so the result preview explains text matches rather
 * than highlighting the filter syntax itself.
 */
export function getSearchTerms(query: string): string[] {
  const values =
    parseMemoSearchQuery(query)
      .text.match(/[\p{L}\p{N}_-]+/gu)
      ?.map((value) => value.trim())
      .filter(Boolean) ?? [];

  return [...new Set(values.map((value) => value.toLocaleLowerCase()))];
}

export type SearchExcerpt = {
  text: string;
  terms: string[];
};

/**
 * Makes a compact, plain-text result preview around the first matched term.
 * Rendering remains text-only so Markdown from a memo can never become HTML
 * through the search UI.
 */
export function buildSearchExcerpt(
  content: string,
  query: string,
  maxLength = 220,
): SearchExcerpt | undefined {
  const terms = getSearchTerms(query);
  if (terms.length === 0) return undefined;

  const text = content.replaceAll(/\s+/gu, " ").trim();
  const lowerText = text.toLocaleLowerCase();
  const matchIndex = terms.reduce<number | undefined>((nearest, term) => {
    const index = lowerText.indexOf(term);
    if (index < 0) return nearest;
    return nearest === undefined ? index : Math.min(nearest, index);
  }, undefined);

  if (matchIndex === undefined) return undefined;

  const start = Math.max(0, matchIndex - Math.floor(maxLength / 3));
  const end = Math.min(text.length, start + maxLength);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";

  return { text: `${prefix}${text.slice(start, end)}${suffix}`, terms };
}

export function splitHighlightedText(text: string, terms: string[]) {
  if (terms.length === 0) {
    return [{ key: "0", text, highlighted: false }];
  }
  const expression = new RegExp(
    `(${terms.map(escapeRegExp).join("|")})`,
    "giu",
  );
  let offset = 0;

  return text
    .split(expression)
    .filter(Boolean)
    .map((part) => {
      const key = `${offset}-${offset + part.length}`;
      offset += part.length;

      return {
        key,
        text: part,
        highlighted: terms.some(
          (term) => part.toLocaleLowerCase() === term.toLocaleLowerCase(),
        ),
      };
    });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
