import type { AnyExtension } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";
import { FormatBubbleMenu } from "@/components/composer/format-bubble-menu";
import { TagHighlight } from "@/components/tag-highlight-extension";
import { UploadPlaceholder } from "@/components/upload-placeholder-extension";
import { focusEditorOnNextFrame } from "@/lib/editor-autofocus";
import { extractImageFiles } from "@/lib/image-insert";
import { extractActiveMentionToken } from "@/lib/mention-autocomplete";
import { extractActiveTagToken } from "@/lib/tag-autocomplete";
import { extractActiveWikiLinkToken } from "@/lib/wikilink-autocomplete";

/**
 * The element whitelist mirrors what the card renderer supports. Only
 * underline is dropped: it has no markdown representation, so anything
 * written with it would be silently unstyled on send. Exported verbatim for
 * the round-trip test, so the test exercises exactly what ships.
 */
export function buildComposerExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      underline: false,
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false },
    }),
    TaskList,
    TaskItem.configure({ nested: false }),
    // Body images: `![alt](/file/attachments/…)` references render in place.
    // Inline so a marked image token can live inside its paragraph.
    Image.configure({ inline: true }),
    Placeholder.configure({ placeholder }),
    Markdown,
    TagHighlight,
    UploadPlaceholder,
  ];
}

export type RichComposerEditorProps = {
  /** Markdown source of truth; only reapplied when it changed upstream. */
  content: string;
  placeholder: string;
  ariaLabel: string;
  disabled: boolean;
  /** Markdown out. Every editor transaction funnels through here. */
  onContentChange: (markdown: string) => void;
  /** Image files pasted/dropped; the caller owns upload orchestration. */
  onImageFiles: (files: File[], position: number) => void;
  /** Enter without IME composition. */
  onSubmitRequest: () => void;
  /**
   * The in-progress "#tag" under the caret, if any. `from` is the ProseMirror
   * position of the leading "#", so the caller can replace the run with a
   * picked tag. Emitted once per token change (including → null).
   */
  onTagTokenChange?: (token: { from: number; text: string } | null) => void;
  /** The in-progress "@name" under the caret, for the mention autocomplete. */
  onMentionTokenChange?: (token: { from: number; text: string } | null) => void;
  /**
   * The in-progress "[[" under the caret, if any. `from` is the ProseMirror
   * position of the leading "[[".
   */
  onWikiLinkTokenChange?: (
    token: { from: number; query: string } | null,
  ) => void;
  /**
   * Keyboard hook for an open autocomplete list. Runs before every other key
   * binding; return true to consume the key (↑/↓/Enter/Tab/Esc while a list
   * is open), false to let the editor handle it.
   */
  onSuggestionKeyDown?: (event: KeyboardEvent) => boolean;
  /** Escape exits editing (card inline editor). */
  onEscape?: () => void;
  /** Move the caret to the end right after mount. */
  autoFocus?: boolean;
  /**
   * DOM id of the editable element. The composer's id is load-bearing (global
   * "c" shortcut and PWA compose focus); other surfaces must pass their own.
   */
  inputId?: string;
  /** Shared ref so the toolbar and the upload chain can drive the editor. */
  editorRef: React.RefObject<Editor | null>;
  /**
   * Extension override for other surfaces (article editor). Must include the
   * Markdown extension — the in/out contract depends on it.
   */
  extensions?: AnyExtension[];
  /** CSS applied to the contenteditable body (composer box by default). */
  contentClassName?: string;
  /** Emitted whenever the editor view undergoes a transaction/selection update. */
  onTransaction?: (editor: Editor) => void;
  /**
   * Floating format bar over a text selection. On by default for every
   * surface; the markdown it writes is the same GFM the toolbar writes.
   * `"note"` shows the short-note set (bold, strike, link) only.
   */
  formatMenu?: boolean | "note";
  /** Emitted when Backspace is pressed at the start of the document (pos 1). */
  onBackspaceAtStart?: () => boolean | undefined;
};

/**
 * Bear-style WYSIWYG body of the memo composer. Storage stays plain markdown:
 * the official Markdown extension parses it on the way in and serializes on
 * the way out, so cards, the API, and MCP all keep seeing ordinary GFM text.
 * Loaded through the lazy wrapper (`rich-composer-editor-lazy`) so TipTap
 * stays out of the startup bundle.
 */
export function RichComposerEditor({
  content,
  placeholder,
  ariaLabel,
  disabled,
  onContentChange,
  onImageFiles,
  onSubmitRequest,
  onTagTokenChange,
  onMentionTokenChange,
  onWikiLinkTokenChange,
  onSuggestionKeyDown,
  onEscape,
  autoFocus = false,
  editorRef,
  inputId = "flaremo-composer-input",
  extensions,
  contentClassName = "composer-editor-content",
  onTransaction,
  onBackspaceAtStart,
  formatMenu = true,
}: RichComposerEditorProps) {
  // Callbacks are read through refs: TipTap captures the options object once,
  // so prop closures would go stale across renders.
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;
  const onImageFilesRef = useRef(onImageFiles);
  onImageFilesRef.current = onImageFiles;
  const onSubmitRequestRef = useRef(onSubmitRequest);
  onSubmitRequestRef.current = onSubmitRequest;
  const onSuggestionKeyDownRef = useRef(onSuggestionKeyDown);
  onSuggestionKeyDownRef.current = onSuggestionKeyDown;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  const onTagTokenChangeRef = useRef(onTagTokenChange);
  onTagTokenChangeRef.current = onTagTokenChange;
  const lastTagTokenRef = useRef<string | null>(null);
  const onMentionTokenChangeRef = useRef(onMentionTokenChange);
  onMentionTokenChangeRef.current = onMentionTokenChange;
  const lastMentionTokenRef = useRef<string | null>(null);
  const onWikiLinkTokenChangeRef = useRef(onWikiLinkTokenChange);
  onWikiLinkTokenChangeRef.current = onWikiLinkTokenChange;
  const lastWikiTokenRef = useRef<string | null>(null);
  const onTransactionRef = useRef(onTransaction);
  onTransactionRef.current = onTransaction;
  const onBackspaceAtStartRef = useRef(onBackspaceAtStart);
  onBackspaceAtStartRef.current = onBackspaceAtStart;
  // The markdown last pushed downstream. Guards the restore effect against
  // re-parsing the editor's own output (which would fight the update loop).
  const lastEmittedRef = useRef(content);

  const editor = useEditor({
    contentType: "markdown",
    content,
    editable: !disabled,
    extensions: extensions ?? buildComposerExtensions(placeholder),
    editorProps: {
      attributes: {
        id: inputId,
        "aria-label": ariaLabel,
        // A contenteditable div no longer gets an implicit textbox role in
        // recent Chromium builds (153+), so assistive tech and
        // getByRole("textbox") would lose the composer. Declare it and its
        // multiline nature explicitly, per ARIA practice for rich editors.
        role: "textbox",
        "aria-multiline": "true",
        class: contentClassName,
      },
      handleKeyDown: (view, event) => {
        // Keyboard contract, the same on every surface:
        //   Enter            new paragraph (or next list item)
        //   Shift+Enter      soft line break (HardBreak's own binding)
        //   Cmd/Ctrl+Enter   send / save
        // An open autocomplete gets first claim on navigation keys, and IME
        // composition never triggers anything.
        if (event.isComposing || event.keyCode === 229) return false;
        if (onSuggestionKeyDownRef.current?.(event)) {
          // Stop here too: an Esc that closes the list must not also close
          // the dialog the editor lives in (dismiss listens on document).
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
        if (event.key === "Backspace") {
          const { from, to } = view.state.selection;
          if (from === 1 && to === 1 && onBackspaceAtStartRef.current) {
            const handled = onBackspaceAtStartRef.current();
            if (handled !== false) return true;
          }
          return false;
        }
        if (event.key === "Escape") {
          if (onEscapeRef.current) {
            onEscapeRef.current();
            return true;
          }
          return false;
        }
        if (
          event.key === "Enter" &&
          (event.metaKey || event.ctrlKey) &&
          !event.altKey
        ) {
          event.preventDefault();
          onSubmitRequestRef.current();
          return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        const files = extractImageFiles(event.clipboardData?.files ?? []);
        if (files.length === 0) return false;
        event.preventDefault();
        onImageFilesRef.current(files, view.state.selection.to);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = extractImageFiles(event.dataTransfer?.files ?? []);
        if (files.length === 0) return false;
        event.preventDefault();
        onImageFilesRef.current(files, view.state.selection.to);
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      const markdown = current.getMarkdown();
      lastEmittedRef.current = markdown;
      onContentChangeRef.current(markdown);
    },
    onTransaction: ({ editor: current }) => {
      const { state } = current.view;
      const { $from } = state.selection;

      if (onTagTokenChangeRef.current) {
        let token: { from: number; text: string } | null = null;
        if ($from.parent.inlineContent && $from.parentOffset > 0) {
          const before = $from.parent.textBetween(
            0,
            $from.parentOffset,
            undefined,
            "\ufffc",
          );
          const active = extractActiveTagToken(before, before.length);
          if (active) {
            token = { from: $from.start() + active.start, text: active.token };
          }
        }
        const key = token ? `${token.from}:${token.text}` : null;
        if (key !== lastTagTokenRef.current) {
          lastTagTokenRef.current = key;
          onTagTokenChangeRef.current(token);
        }
      }

      if (onMentionTokenChangeRef.current) {
        let mention: { from: number; text: string } | null = null;
        if ($from.parent.inlineContent && $from.parentOffset > 0) {
          const before = $from.parent.textBetween(
            0,
            $from.parentOffset,
            undefined,
            "\ufffc",
          );
          const active = extractActiveMentionToken(before, before.length);
          if (active) {
            mention = {
              from: $from.start() + active.start,
              text: active.token,
            };
          }
        }
        const key = mention ? `${mention.from}:${mention.text}` : null;
        if (key !== lastMentionTokenRef.current) {
          lastMentionTokenRef.current = key;
          onMentionTokenChangeRef.current(mention);
        }
      }

      if (onWikiLinkTokenChangeRef.current) {
        let wikiToken: { from: number; query: string } | null = null;
        if ($from.parent.inlineContent && $from.parentOffset >= 2) {
          const before = $from.parent.textBetween(
            0,
            $from.parentOffset,
            undefined,
            "\ufffc",
          );
          const active = extractActiveWikiLinkToken(before, before.length);
          if (active) {
            wikiToken = {
              from: $from.start() + active.start,
              query: active.query,
            };
          }
        }
        const key = wikiToken ? `${wikiToken.from}:${wikiToken.query}` : null;
        if (key !== lastWikiTokenRef.current) {
          lastWikiTokenRef.current = key;
          onWikiLinkTokenChangeRef.current(wikiToken);
        }
      }

      onTransactionRef.current?.(current);
    },
  });

  useEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);

  // `setEditable` emits an `update` by default, which re-serialized the
  // current document through onContentChange. Run before a loaded draft
  // reached the editor, it pushed "" upstream and the article page saved
  // that over the article. Toggling editability never changes content.
  useEffect(() => {
    if (editor) editor.setEditable(!disabled, false);
  }, [editor, disabled]);

  useEffect(() => {
    if (!autoFocus) return;
    return focusEditorOnNextFrame(editor);
  }, [editor, autoFocus]);

  // Upstream draft restores (queued capture replay, persisted draft) push
  // markdown in; the editor re-parses only when the change did not originate
  // from its own keystrokes.
  //
  // A fresh editor instance is a second case. useEditor rebuilds the editor
  // (React StrictMode remounts, option changes) from the options it captured
  // at first render, which predate content that loaded later. Without this,
  // the article editor came up empty after its draft loaded and then
  // autosaved the empty document over the article.
  const syncedEditorRef = useRef<Editor | null>(null);
  useEffect(() => {
    if (!editor) return;
    const freshInstance = syncedEditorRef.current !== editor;
    syncedEditorRef.current = editor;
    if (content === lastEmittedRef.current) {
      if (!freshInstance || !content.trim() || !editor.isEmpty) return;
    }
    lastEmittedRef.current = content;
    editor.commands.setContent(content, { contentType: "markdown" });
  }, [content, editor]);

  // The placeholder is captured at editor creation; a locale switch mid-session
  // is rare enough that the fresh wording lands on the next composer mount.
  return (
    <>
      <EditorContent editor={editor} />
      {editor && formatMenu && (
        <FormatBubbleMenu
          editor={editor}
          variant={formatMenu === "note" ? "note" : "full"}
        />
      )}
    </>
  );
}
