import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { type Editor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  BoldIcon,
  CheckIcon,
  CodeIcon,
  ExternalLinkIcon,
  Heading2Icon,
  ItalicIcon,
  Link2Icon,
  PencilIcon,
  QuoteIcon,
  StrikethroughIcon,
  UnlinkIcon,
} from "lucide-react";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import {
  FORMAT_SHORTCUTS,
  type FormatId,
  NO_ACTIVE_FORMATS,
  normalizeHref,
  readActiveFormats,
  toggleFormat,
} from "@/components/composer/format-actions";
import { ToolButton, ToolDivider } from "@/components/composer/tool-button";
import { type TranslationKey, useI18n } from "@/i18n";

type Mode = "format" | "link";

const INLINE_TOOLS: {
  id: Exclude<
    FormatId,
    | "link"
    | "heading"
    | "quote"
    | "codeBlock"
    | "bulletList"
    | "orderedList"
    | "taskList"
  >;
  label: TranslationKey;
  icon: typeof BoldIcon;
}[] = [
  { id: "bold", label: "article.toolBold", icon: BoldIcon },
  { id: "italic", label: "article.toolItalic", icon: ItalicIcon },
  { id: "strike", label: "article.toolStrike", icon: StrikethroughIcon },
  { id: "code", label: "article.toolCode", icon: CodeIcon },
];

const BLOCK_TOOLS: {
  id: "heading" | "quote";
  label: TranslationKey;
  icon: typeof BoldIcon;
}[] = [
  { id: "heading", label: "composer.heading", icon: Heading2Icon },
  { id: "quote", label: "article.toolQuote", icon: QuoteIcon },
];

/** A note keeps to bold and strike; the rest of the marks belong to articles. */
const NOTE_INLINE_TOOLS = new Set<FormatId>(["bold", "strike"]);

/** Buttons must not take focus: the editor selection is what they act on. */
const keepSelection = (event: MouseEvent) => event.preventDefault();

/**
 * Floating format bar for a text selection (Bear/Notion style), mounted on
 * every rich editor surface. It also appears with a collapsed caret inside a
 * link, offering open / edit / remove. Hidden in code blocks (marks do not
 * apply there), on node selections such as images, and while the editor is
 * read-only. On touch screens it sits under the selection so it does not
 * collide with the native copy/paste callout.
 */
export function FormatBubbleMenu({
  editor,
  variant = "full",
}: {
  editor: Editor;
  /**
   * `note` is the short-note composer's reduced set: bold, strike, link.
   * Headings, quotes and code are article tools.
   */
  variant?: "full" | "note";
}) {
  const isNote = variant === "note";
  const inlineTools = isNote
    ? INLINE_TOOLS.filter((tool) => NOTE_INLINE_TOOLS.has(tool.id))
    : INLINE_TOOLS;
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("format");
  const [href, setHref] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) {
        return { formats: NO_ACTIVE_FORMATS, empty: true, href: "", key: "" };
      }
      const { from, to, empty } = current.state.selection;
      return {
        formats: readActiveFormats(current),
        empty,
        href: (current.getAttributes("link").href as string | undefined) ?? "",
        key: `${from}:${to}`,
      };
    },
  });

  // A new selection starts back on the format row, unless the author is
  // typing a URL (the input owns focus, the selection is parked).
  const selectionKey = state?.key;
  useEffect(() => {
    if (selectionKey === undefined) return;
    if (inputRef.current && document.activeElement === inputRef.current) {
      return;
    }
    setMode("format");
  }, [selectionKey]);

  // The plugin only listens to window scroll; editors that scroll inside
  // their own box (the composer caps its height) need a nudge to follow.
  // Tiptap throws on `editor.view.dom` while the view is not mounted (first
  // paint, a reload's remount, or after destroy), so the listener attaches
  // once the view exists and detaches from the element it attached to.
  useEffect(() => {
    let frame = 0;
    let dom: HTMLElement | null = null;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (editor.isDestroyed) return;
        try {
          editor.view.dispatch(
            editor.state.tr.setMeta("formatBubbleMenu", "updatePosition"),
          );
        } catch {
          // The view went away between the scroll and this frame.
        }
      });
    };
    const attach = () => {
      if (dom || editor.isDestroyed) return;
      try {
        dom = editor.view.dom;
      } catch {
        return;
      }
      dom.addEventListener("scroll", onScroll, { passive: true });
    };
    attach();
    editor.on("mount", attach);
    return () => {
      editor.off("mount", attach);
      dom?.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [editor]);

  const formats = state?.formats ?? NO_ACTIVE_FORMATS;
  const currentHref = state?.href ?? "";
  const collapsedInLink = Boolean(state?.empty && formats.link);

  const openLinkEditor = () => {
    setHref(currentHref);
    setMode("link");
  };

  // Focus once the field exists; the click that opened it kept focus in the
  // editor, so the selection the link will wrap is still intact.
  useEffect(() => {
    if (mode !== "link") return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [mode]);

  const backToEditor = () => {
    setMode("format");
    editor.commands.focus();
  };

  const applyLink = () => {
    const next = normalizeHref(href);
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!next) {
      chain.unsetLink().run();
      setMode("format");
      return;
    }
    // Land the caret after the link with the mark dropped, so typing on
    // neither replaces the linked words nor stretches the link.
    chain
      .setLink({ href: next })
      .command(({ tr }) => {
        tr.setSelection(TextSelection.create(tr.doc, tr.selection.to));
        return true;
      })
      .unsetMark("link")
      .run();
    setMode("format");
  };

  const removeLink = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setMode("format");
  };

  const coarsePointer =
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches;

  return (
    <BubbleMenu
      className="z-40"
      editor={editor}
      options={{
        placement: coarsePointer ? "bottom" : "top",
        offset: 8,
        flip: true,
        shift: { padding: 8 },
        hide: true,
      }}
      pluginKey="formatBubbleMenu"
      shouldShow={({ editor: current, view, state: editorState, element }) => {
        if (!current.isEditable) return false;
        const focused =
          view.hasFocus() || element.contains(document.activeElement);
        if (!focused) return false;
        const { selection } = editorState;
        if (selection instanceof NodeSelection) return false;
        if (current.isActive("codeBlock")) return false;
        if (selection.empty) return current.isActive("link");
        return (
          editorState.doc.textBetween(selection.from, selection.to).length > 0
        );
      }}
      updateDelay={120}
    >
      <div
        aria-label={t("composer.formatMenu")}
        className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-popover p-1 text-popover-foreground shadow-lg"
        data-testid="format-bubble-menu"
        role="toolbar"
      >
        {mode === "link" ? (
          <div className="flex items-center gap-0.5">
            <input
              aria-label={t("composer.link")}
              autoCapitalize="off"
              autoComplete="off"
              className="h-7 w-56 rounded-md bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
              inputMode="url"
              placeholder={t("composer.linkPlaceholder")}
              ref={inputRef}
              spellCheck={false}
              type="text"
              value={href}
              onChange={(event) => setHref(event.target.value)}
              onKeyDown={(event) => {
                // The menu lives inside the composer form: Enter must apply
                // the link, never submit the memo.
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.stopPropagation();
                  applyLink();
                  return;
                }
                if (event.key === "Escape") {
                  // Close the link field, not the dialog around the editor.
                  event.preventDefault();
                  event.stopPropagation();
                  backToEditor();
                }
              }}
            />
            <ToolButton
              label={t("composer.linkApply")}
              onClick={applyLink}
              onMouseDown={keepSelection}
            >
              <CheckIcon />
            </ToolButton>
            {formats.link && (
              <ToolButton
                label={t("composer.linkRemove")}
                onClick={removeLink}
                onMouseDown={keepSelection}
              >
                <UnlinkIcon />
              </ToolButton>
            )}
          </div>
        ) : collapsedInLink ? (
          <>
            <a
              className="max-w-56 truncate px-2 text-sm text-brand-600 underline decoration-brand-400/40 underline-offset-4 dark:text-brand-300"
              href={currentHref}
              rel="noopener noreferrer"
              target="_blank"
              title={currentHref}
            >
              {currentHref}
            </a>
            <ToolDivider />
            <ToolButton
              label={t("composer.linkOpen")}
              render={
                <a
                  aria-label={t("composer.linkOpen")}
                  href={currentHref}
                  rel="noopener noreferrer"
                  target="_blank"
                />
              }
            >
              <ExternalLinkIcon />
            </ToolButton>
            <ToolButton
              label={t("composer.linkEdit")}
              onClick={openLinkEditor}
              onMouseDown={keepSelection}
            >
              <PencilIcon />
            </ToolButton>
            <ToolButton
              label={t("composer.linkRemove")}
              onClick={removeLink}
              onMouseDown={keepSelection}
            >
              <UnlinkIcon />
            </ToolButton>
          </>
        ) : (
          <>
            {inlineTools.map(({ id, label, icon: Icon }) => (
              <ToolButton
                active={formats[id]}
                key={id}
                label={t(label)}
                shortcut={FORMAT_SHORTCUTS[id]}
                onClick={() => toggleFormat(editor, id)}
                onMouseDown={keepSelection}
              >
                <Icon />
              </ToolButton>
            ))}
            <ToolButton
              active={formats.link}
              label={t("composer.link")}
              onClick={openLinkEditor}
              onMouseDown={keepSelection}
            >
              <Link2Icon />
            </ToolButton>
            {!isNote && <ToolDivider />}
            {!isNote &&
              BLOCK_TOOLS.map(({ id, label, icon: Icon }) => (
                <ToolButton
                  active={formats[id]}
                  key={id}
                  label={t(label)}
                  shortcut={FORMAT_SHORTCUTS[id]}
                  onClick={() => toggleFormat(editor, id)}
                  onMouseDown={keepSelection}
                >
                  <Icon />
                </ToolButton>
              ))}
          </>
        )}
      </div>
    </BubbleMenu>
  );
}
