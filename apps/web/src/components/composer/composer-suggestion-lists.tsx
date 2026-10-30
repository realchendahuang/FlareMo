import { Link2Icon } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import type { Memo } from "@/api";
import type { SuggestionAnchor } from "@/hooks/use-composer-suggestions";
import { wikiLinkTitle } from "@/hooks/use-composer-suggestions";
import { useI18n } from "@/i18n";
import type { MentionCandidate } from "@/lib/mention-autocomplete";
import type { TagSuggestion } from "@/lib/tag-autocomplete";
import { cn } from "@/lib/utils";

type ListShellProps = {
  anchor: SuggestionAnchor | null;
  testId: string;
  label: string;
  activeIndex: number;
  children: ReactNode;
};

/**
 * Shared frame of both autocompletes: a non-focusable listbox hung under (or
 * over) the caret. Focus never leaves the editor, so the keyboard drives the
 * highlight through the editor's key handler, and the highlighted row is
 * scrolled into view as it moves. Without a caret anchor (first frame, or a
 * view that cannot measure) the list docks above the composer's bottom rail.
 */
function SuggestionListShell({
  anchor,
  testId,
  label,
  activeIndex,
  children,
}: ListShellProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    row?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);
  const style: CSSProperties | undefined = anchor
    ? {
        top: anchor.top,
        left: anchor.left,
        transform:
          anchor.placement === "above" ? "translateY(-100%)" : undefined,
      }
    : undefined;
  return (
    <div
      aria-label={label}
      className={cn(
        "absolute z-30 max-h-56 w-72 max-w-[calc(100%-1rem)] overflow-y-auto rounded-lg border border-border/60 bg-popover p-1 shadow-lg motion-safe:animate-rise",
        !anchor && "inset-x-4 bottom-12 w-auto max-w-none",
      )}
      data-testid={testId}
      ref={listRef}
      role="listbox"
      style={style}
    >
      {children}
    </div>
  );
}

function rowClassName(active: boolean) {
  return cn(
    "flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm text-muted-foreground motion-safe:transition-colors",
    active && "bg-muted text-foreground",
  );
}

/**
 * "#tag" autocomplete rows. Rows keep the editor selection on mousedown so
 * the picked tag rewrites the token that opened the list.
 */
export function ComposerTagSuggestions({
  visible,
  suggestions,
  activeIndex,
  anchor,
  onAccept,
  onHighlight,
}: {
  visible: boolean;
  suggestions: TagSuggestion[];
  activeIndex: number;
  anchor: SuggestionAnchor | null;
  onAccept: (name: string) => void;
  onHighlight: (index: number) => void;
}) {
  const { t } = useI18n();
  if (!visible) return null;
  return (
    <SuggestionListShell
      activeIndex={activeIndex}
      anchor={anchor}
      label={t("composer.addTag")}
      testId="composer-tag-suggestions"
    >
      {suggestions.map((suggestion, index) => (
        <div
          aria-selected={index === activeIndex}
          className={rowClassName(index === activeIndex)}
          data-index={index}
          key={suggestion.name}
          role="option"
          tabIndex={-1}
          onMouseDown={(event) => {
            // Keep editor focus/selection so the rewritten caret lands.
            event.preventDefault();
            onAccept(suggestion.name);
          }}
          onMouseMove={() => {
            if (index !== activeIndex) onHighlight(index);
          }}
        >
          <span className="truncate">
            <span className="text-muted-foreground">#</span>
            {suggestion.name}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {suggestion.count}
          </span>
        </div>
      ))}
    </SuggestionListShell>
  );
}

/**
 * "[[" wikilink autocomplete rows: the note's readable first line as the link
 * title, with its date on the right. Same mousedown contract as the tag list.
 */
export function ComposerWikiSuggestions({
  visible,
  suggestions,
  activeIndex,
  anchor,
  onAccept,
  onHighlight,
}: {
  visible: boolean;
  suggestions: Memo[];
  activeIndex: number;
  anchor: SuggestionAnchor | null;
  onAccept: (memo: Memo) => void;
  onHighlight: (index: number) => void;
}) {
  const { t } = useI18n();
  if (!visible) return null;
  return (
    <SuggestionListShell
      activeIndex={activeIndex}
      anchor={anchor}
      label={t("composer.wikiLink")}
      testId="composer-wikilink-suggestions"
    >
      {suggestions.map((memo, index) => (
        <div
          aria-selected={index === activeIndex}
          className={rowClassName(index === activeIndex)}
          data-index={index}
          key={memo.name}
          role="option"
          tabIndex={-1}
          onMouseDown={(event) => {
            event.preventDefault();
            onAccept(memo);
          }}
          onMouseMove={() => {
            if (index !== activeIndex) onHighlight(index);
          }}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Link2Icon className="size-3.5 shrink-0 text-primary" />
            <span className="truncate text-foreground">
              {wikiLinkTitle(memo)}
            </span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {(memo.display_time ?? memo.create_time)?.slice(0, 10)}
          </span>
        </div>
      ))}
    </SuggestionListShell>
  );
}

/** "@name" rows: display name with the username beside it. */
export function ComposerMentionSuggestions({
  visible,
  suggestions,
  activeIndex,
  anchor,
  onAccept,
  onHighlight,
}: {
  visible: boolean;
  suggestions: MentionCandidate[];
  activeIndex: number;
  anchor: SuggestionAnchor | null;
  onAccept: (username: string) => void;
  onHighlight: (index: number) => void;
}) {
  const { t } = useI18n();
  if (!visible) return null;
  return (
    <SuggestionListShell
      activeIndex={activeIndex}
      anchor={anchor}
      label={t("composer.mention")}
      testId="composer-mention-suggestions"
    >
      {suggestions.map((person, index) => (
        <div
          aria-selected={index === activeIndex}
          className={rowClassName(index === activeIndex)}
          data-index={index}
          key={person.username}
          role="option"
          tabIndex={-1}
          onMouseDown={(event) => {
            event.preventDefault();
            onAccept(person.username);
          }}
          onMouseMove={() => {
            if (index !== activeIndex) onHighlight(index);
          }}
        >
          <span className="truncate text-foreground">{person.displayName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            @{person.username}
          </span>
        </div>
      ))}
    </SuggestionListShell>
  );
}
