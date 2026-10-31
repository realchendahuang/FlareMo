import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { Editor } from "@tiptap/react";
import { Suspense, useMemo, useRef, useState } from "react";
import type { MemoVisibility } from "@/api";
import { buildArticleExtensions } from "@/components/article-editor";
import { ComposerCanvasActions } from "@/components/composer/composer-canvas-actions";
import { ComposerCanvasHeader } from "@/components/composer/composer-canvas-header";
import {
  type CanvasActiveFormats,
  ComposerCanvasToolbar,
} from "@/components/composer/composer-canvas-toolbar";
import { ComposerFileChips } from "@/components/composer/composer-file-chips";
import {
  ComposerTagSuggestions,
  ComposerWikiSuggestions,
} from "@/components/composer/composer-suggestion-lists";
import { VoiceCaptureBar } from "@/components/composer/voice-capture-bar";
import { RichComposerEditor } from "@/components/rich-composer-editor";
import { Dialog, DialogPortal } from "@/components/ui/dialog";
import { useComposerSuggestions } from "@/hooks/use-composer-suggestions";
import { useComposerVoice } from "@/hooks/use-composer-voice";
import { useInlineImageUploads } from "@/hooks/use-inline-image-uploads";
import { useI18n } from "@/i18n";
import type { MemoCaptureInput } from "@/lib/local-memo-capture";
import { extractTags } from "@/lib/memo";
import type { TagSuggestion } from "@/lib/tag-autocomplete";

export type ComposerFocusCanvasProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: MemoCaptureInput;
  isPending: boolean;
  showVisibility?: boolean;
  tags?: TagSuggestion[];
  captureAvailable?: boolean;
  onDraftChange: (draft: MemoCaptureInput) => void;
  onSubmitMemo: (input: MemoCaptureInput) => Promise<void>;
  onVisibilityChange?: (visibility: MemoVisibility) => void;
};

/**
 * Focus canvas: the inline composer opened to the full viewport, for a note
 * that needs room (headings, tables, code). It sends a note to the timeline
 * like the inline box does; articles are started from the Articles page,
 * so the canvas has one destination and no title field.
 */
export function ComposerFocusCanvas({
  open,
  onOpenChange,
  draft,
  isPending,
  showVisibility = false,
  tags,
  captureAvailable = false,
  onDraftChange,
  onSubmitMemo,
  onVisibilityChange,
}: ComposerFocusCanvasProps) {
  const { t } = useI18n();
  const canvasEditorRef = useRef<Editor | null>(null);
  const editorBoxRef = useRef<HTMLDivElement | null>(null);
  const [activeFormats, setActiveFormats] = useState<CanvasActiveFormats>({
    h2: false,
    h3: false,
    bold: false,
    italic: false,
    strike: false,
    code: false,
    quote: false,
    bulletList: false,
    orderedList: false,
    taskList: false,
  });

  // Every transaction (selection moves included) reports the marks under the
  // caret. Bail out when nothing changed: a fresh object per transaction
  // re-renders the canvas, which re-runs the editor's option sync, which
  // fires another transaction, a render loop React aborts after 50 rounds.
  const handleTransaction = (editor: Editor) => {
    const next: CanvasActiveFormats = {
      h2: editor.isActive("heading", { level: 2 }),
      h3: editor.isActive("heading", { level: 3 }),
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      strike: editor.isActive("strike"),
      code: editor.isActive("code"),
      quote: editor.isActive("blockquote"),
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
      taskList: editor.isActive("taskList"),
    };
    setActiveFormats((prev) =>
      (Object.keys(next) as (keyof CanvasActiveFormats)[]).every(
        (key) => prev[key] === next[key],
      )
        ? prev
        : next,
    );
  };

  const placeholder = t("composer.placeholder");
  const extensions = useMemo(
    () => buildArticleExtensions(placeholder),
    [placeholder],
  );

  const canSubmit = Boolean(draft.content.trim() || draft.files.length > 0);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const commitDraft = (patch: Partial<MemoCaptureInput>) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    onDraftChange(next);
  };

  const { isUploadingImages, enqueueInlineUploads, preuploadMarkdownRef } =
    useInlineImageUploads({
      editorRef: canvasEditorRef,
      draftRef,
      commitDraft,
    });

  const updateContent = (content: string) => {
    const kept = draftRef.current.preuploadedAttachmentNames?.filter((name) => {
      const markdown = preuploadMarkdownRef.current.get(name);
      return !markdown || content.includes(markdown);
    });
    commitDraft({
      content,
      tags: extractTags(content),
      preuploadedAttachmentNames: kept,
    });
  };

  const updateContentRef = useRef(updateContent);
  updateContentRef.current = updateContent;

  const {
    setActiveTagToken,
    setActiveWikiToken,
    handleSuggestionKeyDown,
    activeIndex: suggestionIndex,
    setActiveIndex: setSuggestionIndex,
    anchor: suggestionAnchor,
    tagSuggestions,
    showTagSuggestions,
    acceptTagSuggestion,
    wikiSuggestions,
    showWikiSuggestions,
    acceptWikiSuggestion,
  } = useComposerSuggestions({
    editorRef: canvasEditorRef,
    containerRef: editorBoxRef,
    isPending,
    tags,
  });

  const { capture, captureController, voiceActive, now } = useComposerVoice({
    draftRef,
    updateContentRef,
  });

  const submit = async () => {
    if (isPending || isUploadingImages || voiceActive) return;

    if (!canSubmit) return;
    // A draft saved while the canvas still had a title field keeps it; it
    // goes out as the note's heading instead of being silently dropped.
    const current = draftRef.current;
    const title = current.title?.trim();
    const input = title
      ? {
          ...current,
          title: undefined,
          content: `# ${title}\n\n${current.content}`,
        }
      : current;
    try {
      await onSubmitMemo(input);
      onOpenChange(false);
    } catch {
      // Mutation handles error feedback
    }
  };

  const withEditor = (action: (editor: Editor) => void) => {
    if (isPending) return;
    const editor = canvasEditorRef.current;
    if (!editor) return;
    action(editor);
  };

  const charCount = draft.content.trim().length;
  const readingTimeMinutes = Math.max(1, Math.ceil(charCount / 350));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogPrimitive.Backdrop
          data-slot="composer-canvas-backdrop"
          className="fixed inset-0 isolate z-50 bg-background/80 duration-200 ease-signal supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 data-closed:fill-mode-forwards"
        />
        <DialogPrimitive.Popup
          data-slot="composer-canvas-popup"
          className="fixed inset-0 isolate z-50 flex flex-col bg-background text-foreground outline-none will-change-transform will-change-opacity duration-200 ease-signal data-open:animate-in data-open:fade-in-0 data-open:zoom-in-98 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-98 data-closed:fill-mode-forwards"
        >
          <form
            className="flex h-full flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {/* Header: Title accessibility, Save status, Word count, Reading time & minimize */}
            <ComposerCanvasHeader
              charCount={charCount}
              readingTimeMinutes={readingTimeMinutes}
            />

            {/* Main Canvas Area */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: Focus editor when clicking blank paper area */}
            <div
              className="relative mx-auto flex w-full max-w-2xl flex-1 cursor-text flex-col min-h-0 overflow-y-auto px-5 pt-8 pb-5 sm:px-8 sm:pt-14"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  event.preventDefault();
                  canvasEditorRef.current?.commands.focus("end");
                }
              }}
            >
              {/* TipTap Fullscreen Editor */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: Focus editor when clicking blank paper area */}
              <div
                className="relative flex flex-1 cursor-text flex-col min-h-0"
                ref={editorBoxRef}
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) {
                    event.preventDefault();
                    canvasEditorRef.current?.commands.focus("end");
                  }
                }}
              >
                <Suspense
                  fallback={<div className="flex-1 rounded-lg bg-muted/20" />}
                >
                  <RichComposerEditor
                    ariaLabel={t("composer.ariaLabel")}
                    content={draft.content}
                    disabled={isPending}
                    editorRef={canvasEditorRef}
                    extensions={extensions}
                    inputId="flaremo-fullscreen-composer-input"
                    onContentChange={updateContent}
                    onImageFiles={enqueueInlineUploads}
                    onTagTokenChange={tags ? setActiveTagToken : undefined}
                    onWikiLinkTokenChange={setActiveWikiToken}
                    onSuggestionKeyDown={handleSuggestionKeyDown}
                    onSubmitRequest={() => {
                      if (!isUploadingImages && !voiceActive) void submit();
                    }}
                    onTransaction={handleTransaction}
                    placeholder={t("composer.placeholder")}
                    autoFocus={true}
                    contentClassName="article-editor-content flex-1 outline-none text-base leading-[1.85] py-0"
                  />
                </Suspense>
                {voiceActive && (
                  <VoiceCaptureBar
                    capture={capture}
                    now={now}
                    onCancel={() => captureController.reset()}
                    onStop={() => void captureController.stop()}
                  />
                )}
                <ComposerTagSuggestions
                  visible={showTagSuggestions}
                  suggestions={tagSuggestions}
                  activeIndex={suggestionIndex}
                  anchor={suggestionAnchor}
                  onAccept={acceptTagSuggestion}
                  onHighlight={setSuggestionIndex}
                />
                <ComposerWikiSuggestions
                  visible={showWikiSuggestions}
                  suggestions={wikiSuggestions}
                  activeIndex={suggestionIndex}
                  anchor={suggestionAnchor}
                  onAccept={acceptWikiSuggestion}
                  onHighlight={setSuggestionIndex}
                />
                {/* Pending attachments sit at the foot of the paper, a tray
                    above the toolbar, aligned with the text column. */}
                <ComposerFileChips
                  className="mt-auto px-1 pt-3"
                  files={draft.files}
                  isPending={isPending}
                  onRemoveFile={(file) =>
                    commitDraft({
                      files: draftRef.current.files.filter(
                        (item) => item !== file,
                      ),
                    })
                  }
                />
              </div>
            </div>

            {/* Bottom bar: the tools and the send control sit on the text
                column's edges, so the eye never leaves the measure. */}
            <div className="shrink-0 border-t border-border/50 bg-card/60 pb-[env(safe-area-inset-bottom,0px)]">
              <div className="mx-auto flex min-h-12 w-full max-w-2xl items-center justify-between gap-2 px-3 py-2 sm:px-6">
                <ComposerCanvasToolbar
                  activeFormats={activeFormats}
                  captureAvailable={captureAvailable}
                  isPending={isPending}
                  voiceActive={voiceActive}
                  withEditor={withEditor}
                  onAddFiles={(files) =>
                    commitDraft({
                      files: [...draftRef.current.files, ...files],
                    })
                  }
                  onStartVoice={() => void captureController.start()}
                />
                <ComposerCanvasActions
                  canSubmit={canSubmit}
                  isPending={isPending}
                  isUploadingImages={isUploadingImages}
                  showVisibility={Boolean(showVisibility)}
                  voiceActive={voiceActive}
                  visibility={draft.visibility}
                  onVisibilityChange={(visibility) => {
                    commitDraft({ visibility });
                    onVisibilityChange?.(visibility);
                  }}
                />
              </div>
            </div>
          </form>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}
