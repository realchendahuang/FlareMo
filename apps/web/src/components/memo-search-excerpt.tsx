import { buildSearchExcerpt, splitHighlightedText } from "@/lib/search";

export function MemoSearchExcerpt({
  content,
  query,
}: {
  content: string;
  query: string;
}) {
  const excerpt = buildSearchExcerpt(content, query);
  if (!excerpt) return null;

  return (
    <p
      className="mt-2 rounded-md bg-muted/70 px-2.5 py-1.5 text-xs leading-5 text-muted-foreground"
      data-testid="memo-search-excerpt"
    >
      {splitHighlightedText(excerpt.text, excerpt.terms).map(
        ({ key, text, highlighted }) =>
          highlighted ? (
            <mark
              className="rounded-sm bg-primary/20 px-0.5 font-medium text-foreground"
              key={key}
            >
              {text}
            </mark>
          ) : (
            <span key={key}>{text}</span>
          ),
      )}
    </p>
  );
}
