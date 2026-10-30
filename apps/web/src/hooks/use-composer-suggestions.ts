import { useQuery } from "@tanstack/react-query";
import type { Editor } from "@tiptap/react";
import { type RefObject, useEffect, useState } from "react";
import { listMemos, listMentionableUsers, type Memo } from "@/api";
import { memoTitle } from "@/lib/memo";
import {
  filterMentionSuggestions,
  type MentionCandidate,
} from "@/lib/mention-autocomplete";
import {
  filterTagSuggestions,
  type TagSuggestion,
} from "@/lib/tag-autocomplete";

/**
 * Where a suggestion list sits, in px relative to the positioned container
 * that renders it. "below" hangs the list under the caret line; "above"
 * lifts it over the line when the viewport has no room underneath.
 */
export type SuggestionAnchor = {
  top: number;
  left: number;
  placement: "below" | "above";
};

type UseComposerSuggestionsOptions = {
  editorRef: RefObject<Editor | null>;
  /**
   * The positioned (`relative`) element the lists render inside. The caret's
   * viewport coordinates are translated into this element's box.
   */
  containerRef: RefObject<HTMLElement | null>;
  isPending: boolean;
  /** Known tags with usage counts, powering the "#" autocomplete. */
  tags?: TagSuggestion[];
  /** Offer "@name" completion (only where a mention can reach someone). */
  mentions?: boolean;
};

export type UseComposerSuggestionsResult = {
  /** Token under the caret, fed straight back into the editor prop. */
  setActiveTagToken: (token: { from: number; text: string } | null) => void;
  /** Token under the caret, fed straight back into the editor prop. */
  setActiveWikiToken: (token: { from: number; query: string } | null) => void;
  /**
   * Keyboard routing for an open list: ↑/↓ move, Enter/Tab accept, Esc
   * dismisses. Returns true when the key was consumed, so the editor must
   * not also act on it (Enter would otherwise split the paragraph).
   */
  handleSuggestionKeyDown: (event: KeyboardEvent) => boolean;
  tagSuggestions: TagSuggestion[];
  showTagSuggestions: boolean;
  acceptTagSuggestion: (name: string) => void;
  wikiSuggestions: Memo[];
  showWikiSuggestions: boolean;
  acceptWikiSuggestion: (targetMemo: Memo) => void;
  setActiveMentionToken: (token: { from: number; text: string } | null) => void;
  mentionSuggestions: MentionCandidate[];
  showMentionSuggestions: boolean;
  acceptMentionSuggestion: (username: string) => void;
  /** Highlighted row of whichever list is open. */
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  /** Caret-relative position for the open list; null falls back to the rail. */
  anchor: SuggestionAnchor | null;
};

/** Rough list height used to decide whether it fits below the caret. */
const LIST_ROOM_PX = 240;
/** Matches the lists' `w-72`; keeps the list inside the container. */
const LIST_WIDTH_PX = 288;
const GAP_PX = 6;

/**
 * Wikilink title for a memo: its readable first line, falling back to the id
 * for a memo that is only attachments or tags.
 */
export function wikiLinkTitle(memo: Memo): string {
  // Inline "#tag" runs are dropped: inside the new memo's link text they
  // would be re-extracted as that memo's own tags.
  const title = memoTitle(memo.content, 40)
    .replace(/(^|\s)#[^\s#]+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return title || memo.id;
}

function measureAnchor(
  editor: Editor | null,
  container: HTMLElement | null,
  from: number,
): SuggestionAnchor | null {
  if (!editor || !container) return null;
  try {
    const caret = editor.view.coordsAtPos(from);
    const box = container.getBoundingClientRect();
    // jsdom and detached views report an all-zero rect; the caller falls
    // back to the static rail position rather than pinning to the corner.
    if (box.width === 0 && box.height === 0) return null;
    const roomBelow = window.innerHeight - caret.bottom;
    const placement =
      roomBelow < LIST_ROOM_PX && caret.top > LIST_ROOM_PX ? "above" : "below";
    const maxLeft = Math.max(8, box.width - LIST_WIDTH_PX - 8);
    const left = Math.min(Math.max(8, caret.left - box.left - 12), maxLeft);
    const top =
      placement === "below"
        ? caret.bottom - box.top + GAP_PX
        : caret.top - box.top - GAP_PX;
    return { top, left, placement };
  } catch {
    // coordsAtPos throws for a position the view no longer holds.
    return null;
  }
}

/**
 * The composer's two inline autocompletes. "#" matches the instance's known
 * tags locally; "[[" asks the memo list (5s stale time) for the highlighted
 * note. Both rewrite the in-progress token in place and each keeps its own
 * token state, since only one of them can be under the caret at a time.
 *
 * The open list follows the caret, answers to the keyboard the way any
 * editor autocomplete does, and stays closed after Esc until the token
 * under the caret changes.
 */
export function useComposerSuggestions({
  editorRef,
  containerRef,
  isPending,
  tags,
  mentions = false,
}: UseComposerSuggestionsOptions): UseComposerSuggestionsResult {
  const [activeMentionToken, setActiveMentionToken] = useState<{
    from: number;
    text: string;
  } | null>(null);
  const [activeTagToken, setActiveTagToken] = useState<{
    from: number;
    text: string;
  } | null>(null);
  const [activeWikiToken, setActiveWikiToken] = useState<{
    from: number;
    query: string;
  } | null>(null);
  // The token key the user dismissed with Esc; a different key reopens.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  // Highlight is scoped to a token key so typing another character resets it.
  const [highlight, setHighlight] = useState<{ key: string; index: number }>({
    key: "",
    index: 0,
  });
  const [anchor, setAnchor] = useState<SuggestionAnchor | null>(null);

  const wikiSuggestionsQuery = useQuery({
    queryKey: ["composer-wiki-suggestions", activeWikiToken?.query],
    queryFn: ({ signal }) =>
      listMemos(
        { q: activeWikiToken?.query?.trim() || undefined, page_size: 5 },
        signal,
      ),
    enabled: Boolean(activeWikiToken),
    staleTime: 5000,
  });

  const peopleQuery = useQuery({
    queryKey: ["mentionable-users"],
    queryFn: listMentionableUsers,
    enabled: mentions && Boolean(activeMentionToken),
    staleTime: 5 * 60_000,
  });
  const mentionKey = activeMentionToken
    ? `mention:${activeMentionToken.from}:${activeMentionToken.text}`
    : null;
  const mentionSuggestions =
    mentions && activeMentionToken
      ? filterMentionSuggestions(
          peopleQuery.data?.members ?? [],
          activeMentionToken.text,
        )
      : [];
  const showMentionSuggestions =
    mentionSuggestions.length > 0 && !isPending && mentionKey !== dismissedKey;

  const tagKey = activeTagToken
    ? `tag:${activeTagToken.from}:${activeTagToken.text}`
    : null;
  const wikiKey = activeWikiToken
    ? `wiki:${activeWikiToken.from}:${activeWikiToken.query}`
    : null;

  const tagSuggestions =
    tags && activeTagToken
      ? filterTagSuggestions(tags, activeTagToken.text)
      : [];
  const showTagSuggestions =
    tagSuggestions.length > 0 && !isPending && tagKey !== dismissedKey;

  const wikiSuggestions = wikiSuggestionsQuery.data?.memos ?? [];
  const showWikiSuggestions =
    Boolean(activeWikiToken) &&
    wikiSuggestions.length > 0 &&
    !isPending &&
    wikiKey !== dismissedKey;

  // Wiki wins when both somehow match: "[[#" is a link query, not a tag.
  const openKey = showWikiSuggestions
    ? wikiKey
    : showMentionSuggestions
      ? mentionKey
      : showTagSuggestions
        ? tagKey
        : null;
  const openCount = showWikiSuggestions
    ? wikiSuggestions.length
    : showMentionSuggestions
      ? mentionSuggestions.length
      : showTagSuggestions
        ? tagSuggestions.length
        : 0;
  const activeIndex =
    openKey && highlight.key === openKey
      ? Math.min(highlight.index, openCount - 1)
      : 0;
  const setActiveIndex = (index: number) => {
    if (openKey) setHighlight({ key: openKey, index });
  };

  const anchorFrom = showWikiSuggestions
    ? activeWikiToken?.from
    : showMentionSuggestions
      ? activeMentionToken?.from
      : showTagSuggestions
        ? activeTagToken?.from
        : undefined;

  // Re-measure when the list opens or its token moves, and keep it glued to
  // the caret while the page or the editor's own scroll box moves.
  useEffect(() => {
    if (anchorFrom === undefined) {
      setAnchor(null);
      return;
    }
    const update = () =>
      setAnchor(
        measureAnchor(editorRef.current, containerRef.current, anchorFrom),
      );
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchorFrom, editorRef, containerRef]);

  const acceptTagSuggestion = (name: string) => {
    if (!activeTagToken) return;
    const editor = editorRef.current;
    if (!editor) return;
    const caret = activeTagToken.from + 1 + activeTagToken.text.length;
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from: activeTagToken.from, to: caret },
        { type: "text", text: `#${name} ` },
      )
      .run();
  };

  const acceptMentionSuggestion = (username: string) => {
    if (!activeMentionToken) return;
    const editor = editorRef.current;
    if (!editor) return;
    const caret = activeMentionToken.from + 1 + activeMentionToken.text.length;
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from: activeMentionToken.from, to: caret },
        { type: "text", text: `@${username} ` },
      )
      .run();
    setActiveMentionToken(null);
  };

  const acceptWikiSuggestion = (targetMemo: Memo) => {
    if (!activeWikiToken) return;
    const editor = editorRef.current;
    if (!editor) return;
    const caret = activeWikiToken.from + 2 + activeWikiToken.query.length;
    // A real link mark, not literal "[title](…)" text: the editor would
    // serialize literal brackets escaped (`\[title\]`), saving a dead link.
    // The trailing space is unmarked so typing on does not extend the link.
    editor
      .chain()
      .focus()
      .insertContentAt({ from: activeWikiToken.from, to: caret }, [
        {
          type: "text",
          text: wikiLinkTitle(targetMemo),
          marks: [{ type: "link", attrs: { href: `/memo/${targetMemo.id}` } }],
        },
        { type: "text", text: " " },
      ])
      .unsetMark("link")
      .run();
    setActiveWikiToken(null);
  };

  const handleSuggestionKeyDown = (event: KeyboardEvent): boolean => {
    if (!openKey || openCount === 0) return false;
    if (event.isComposing || event.keyCode === 229) return false;
    if (event.altKey || event.metaKey || event.ctrlKey) return false;
    switch (event.key) {
      case "ArrowDown":
        setHighlight({ key: openKey, index: (activeIndex + 1) % openCount });
        return true;
      case "ArrowUp":
        setHighlight({
          key: openKey,
          index: (activeIndex - 1 + openCount) % openCount,
        });
        return true;
      case "Enter":
      case "Tab": {
        if (event.shiftKey) return false;
        if (showWikiSuggestions) {
          const memo = wikiSuggestions[activeIndex];
          if (memo) acceptWikiSuggestion(memo);
        } else if (showMentionSuggestions) {
          const person = mentionSuggestions[activeIndex];
          if (person) acceptMentionSuggestion(person.username);
        } else {
          const tag = tagSuggestions[activeIndex];
          if (tag) acceptTagSuggestion(tag.name);
        }
        return true;
      }
      case "Escape":
        setDismissedKey(openKey);
        return true;
      default:
        return false;
    }
  };

  return {
    setActiveTagToken,
    setActiveWikiToken,
    handleSuggestionKeyDown,
    tagSuggestions,
    showTagSuggestions:
      showTagSuggestions && !showWikiSuggestions && !showMentionSuggestions,
    setActiveMentionToken,
    mentionSuggestions,
    showMentionSuggestions: showMentionSuggestions && !showWikiSuggestions,
    acceptMentionSuggestion,
    acceptTagSuggestion,
    wikiSuggestions,
    showWikiSuggestions,
    acceptWikiSuggestion,
    activeIndex,
    setActiveIndex,
    anchor,
  };
}
