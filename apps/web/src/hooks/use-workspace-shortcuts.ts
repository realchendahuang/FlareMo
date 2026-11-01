import { useEffect, useRef, useState } from "react";
import type { Memo } from "@/api";
import { focusComposerInput } from "@/lib/composer-focus";

/**
 * The workspace-wide keyboard flow (⌘K, /, c, ?, j/k/e/p, Esc) and the three
 * pieces of state it drives: the queued memos the j/k walk steps through, the
 * shortcut cheat sheet, and the spotlight overlay.
 *
 * The document listener reads the memo list it walks and the card handlers it
 * triggers through refs the render body keeps current, so the effect
 * re-subscribes only when the focused id changes. The refs are returned for
 * that assignment.
 */
const memoKey = (memo: Memo) => memo.id || memo.name;

export function useWorkspaceShortcuts() {
  // Track the id, not the array position: a filter/view change swaps the
  // list underneath the cursor, and an index would silently point at a
  // different memo (so `e` could archive the wrong record).
  const [focusedMemoId, setFocusedMemoId] = useState<string | null>(null);
  const [shortcutsOpen, setShowShortcutsOpen] = useState(false);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const displayedMemosRef = useRef<Memo[]>([]);
  const handleArchiveRef = useRef<(id: string) => void>(() => {});
  const handlePinRef = useRef<(id: string, pinned: boolean) => void>(() => {});

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      // Chorded shortcuts (⌘C copy, ⌘V paste) and shortcuts while a dialog
      // owns the focus must not steal focus back to the composer/search.
      // Base UI renders `data-open`, not Radix's `data-state`, and an
      // AlertDialog's role is `alertdialog`.
      const modalOpen =
        document.querySelector(
          '[role="dialog"][data-open], [role="alertdialog"][data-open]',
        ) !== null;
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLocaleLowerCase() === "k"
      ) {
        event.preventDefault();
        setSpotlightOpen(true);
        return;
      }
      if (event.key === "/" && !editable && !modalOpen) {
        event.preventDefault();
        setSpotlightOpen(true);
        return;
      }
      // "c" jumps straight into the composer for quick capture.
      if (
        event.key.toLocaleLowerCase() === "c" &&
        !editable &&
        !modalOpen &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        if (document.getElementById("flaremo-composer-input")) {
          event.preventDefault();
          focusComposerInput();
        }
      }
      // "?" lists the available keyboard shortcuts.
      if (event.key === "?" && !editable && !modalOpen) {
        event.preventDefault();
        setShowShortcutsOpen(true);
      }

      // J/K card keyboard flow when browsing timeline
      if (
        !editable &&
        !modalOpen &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        const memosList = displayedMemosRef.current;
        const currentIndex =
          focusedMemoId === null
            ? -1
            : memosList.findIndex((memo) => memoKey(memo) === focusedMemoId);
        const focusAt = (index: number) => {
          const memoItem = memosList[index];
          if (!memoItem) return;
          setFocusedMemoId(memoKey(memoItem));
          document
            .querySelector(`[data-memo-id="${memoKey(memoItem)}"]`)
            ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        };
        if (event.key === "j" || event.key === "ArrowDown") {
          if (memosList.length === 0) return;
          event.preventDefault();
          focusAt(
            currentIndex < 0
              ? 0
              : Math.min(memosList.length - 1, currentIndex + 1),
          );
          return;
        }
        if (event.key === "k" || event.key === "ArrowUp") {
          if (memosList.length === 0) return;
          event.preventDefault();
          focusAt(currentIndex < 0 ? 0 : Math.max(0, currentIndex - 1));
          return;
        }
        if (event.key === "e" && currentIndex >= 0) {
          const current = memosList[currentIndex];
          if (current) {
            event.preventDefault();
            handleArchiveRef.current(memoKey(current));
          }
          return;
        }
        if (event.key === "p" && currentIndex >= 0) {
          const current = memosList[currentIndex];
          if (current) {
            event.preventDefault();
            handlePinRef.current(memoKey(current), !current.pinned);
          }
          return;
        }
        if (event.key === "Escape" && focusedMemoId !== null) {
          event.preventDefault();
          setFocusedMemoId(null);
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusedMemoId]);

  return {
    displayedMemosRef,
    focusedMemoId,
    handleArchiveRef,
    handlePinRef,
    setShowShortcutsOpen,
    setSpotlightOpen,
    shortcutsOpen,
    spotlightOpen,
  };
}
